/**
 * Relay — dispatch and observation.
 *
 * Moved verbatim out of runtime.ts (step 2 of the four-module split). It holds
 * the part of the round trip that talks to a page: open a tab, send a prompt,
 * settle the answer, emit the stream events. It does not decide *who* speaks or
 * whether a round is over — that is the scheduler's job, and it is not written
 * yet.
 *
 * The collaborators arrive through RelayContext rather than being reached for
 * off the runtime, which is what makes this file testable without a BridgeRuntime
 * and is the seam the debate path will use: one relay, one participant, one turn.
 *
 * Deliberately NOT moved: prompt()'s provider chain walk. That policy changes at
 * the participant boundary (a debate participant must not silently become a
 * different model), so it stays in the facade until the scheduler replaces it.
 */

import type {
  Adapter,
  Page,
  ControlEventKind,
  PromptResult,
} from '@ai-bridge/shared';
import type { CdpController } from '../cdp/controller';
import type { AdapterRegistry } from '../adapters/registry';
import type { Router } from '../router/router';
import {
  ChallengeError,
  attemptFast,
  replayInPage,
  renderTemplate,
  type FastPathTemplate,
  type Rung,
  type RungPolicy,
} from '../fastpath';
import { isStreamingAdapter } from '../adapters/types';
import type { FetchLike } from '../api';
import type { Logger } from '../logger';

/** One provider switch, recorded so the panel can show what failover did. */
export interface SwitchRecord {
  from: string;
  to: string;
  reason: 'limit' | 'switch';
}

/** Everything the relay needs, and nothing more. */
export interface RelayContext {
  controller: CdpController;
  adapters: AdapterRegistry;
  log: Logger;
  rungs: RungPolicy;
  router: Router;
  fastFetch: FetchLike;
}

export class Relay {
  constructor(private readonly ctx: RelayContext) {}

  /** §4 `navigate`: put the owned tab on the adapter's site. */
  async navigate(msg: { adapterId: string; url: string }): Promise<{ url: string }> {
    const page = this.requirePage();
    await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    this.ctx.log.info('navigated', { adapterId: msg.adapterId, url: page.url() });
    return { url: page.url() };
  }

  /** §4 `send`: write the prompt into the composer and submit. */
  async send(msg: { adapterId: string; text: string }): Promise<{ sent: true; chars: number }> {
    const page = this.requirePage();
    const adapter = await this.ctx.adapters.get(msg.adapterId);
    if (!(await adapter.isReady(page))) await adapter.connect(page);
    const limit = await adapter.detectLimit(page);
    if (limit.limited) throw new Error(this.limitMessage(msg.adapterId, limit));
    await adapter.sendPrompt(page, msg.text);
    return { sent: true, chars: msg.text.length };
  }

  /** §4 `observe`: wait for the settled answer (no deltas). */
  async observe(msg: { adapterId: string; debounceMs: number }): Promise<{ text: string }> {
    const page = this.requirePage();
    const adapter = await this.ctx.adapters.get(msg.adapterId);
    const text = await adapter.observeResponse(page, { debounceMs: msg.debounceMs });
    return { text };
  }

  async tryRungs(
    adapterId: string,
    template: FastPathTemplate,
    msg: { text: string },
    push: (kind: ControlEventKind, data: unknown) => void,
    exhausted: Set<string>,
  ): Promise<(PromptResult & { switched: SwitchRecord[] }) | null> {
    const log = this.ctx.log;
    const page = this.ctx.controller.activePage;
    const candidates: Rung[] = page ? ['fast', 'replay', 'dom'] : ['fast', 'dom'];
    const available = candidates.filter((rung) => !exhausted.has(`${adapterId}:${rung}`));
    const preferred = this.ctx.rungs.choose(adapterId, available);
    if (!preferred) return null;

    // The remembered rung first, then the rest in cost order.
    const order = [preferred, ...available.filter((rung) => rung !== preferred)];
    const startedAt = Date.now();
    let firstTokenMs: number | null = null;

    for (const rung of order) {
      if (rung === 'dom') return null;

      const parts: string[] = [];
      push('stream.start', {
        adapterId,
        phase: 'prompt',
        rung,
        prompt: msg.text.slice(0, 200),
      });

      try {
        const source =
          rung === 'fast'
            ? attemptFast(template, { prompt: msg.text }, { fetchImpl: this.ctx.fastFetch })
            : replayInPage(page as never, {
                url: template.url,
                method: template.method ?? 'POST',
                headers: { 'Content-Type': 'application/json', ...(template.headers ?? {}) },
                body: renderTemplate(template.bodyTemplate, { prompt: msg.text }),
              });

        for await (const chunk of source) {
          if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
          parts.push(chunk);
          push('stream.delta', {
            adapterId,
            rung,
            text: chunk,
            elapsedMs: Date.now() - startedAt,
          });
        }

        const text = parts.join('');
        if (!text.trim()) throw new Error('EFAST: the fast path returned nothing');

        const totalMs = Date.now() - startedAt;
        this.ctx.rungs.record(adapterId, rung);
        this.ctx.router.markSuccess(adapterId);
        push('stream.end', {
          adapterId,
          rung,
          totalMs,
          firstTokenMs,
          chars: text.length,
        });
        log.info(`fastpath: ${adapterId} answered on the ${rung} rung`, {
          firstTokenMs,
          totalMs,
          chars: text.length,
        });

        return {
          adapterId,
          text,
          firstTokenMs,
          totalMs,
          // The stream's own terminator settled it, which is what 'sentinel'
          // means everywhere else in this file.
          settledBy: 'sentinel',
          tabId: null,
          turns: this.ctx.controller.status().turns,
          // Nothing was switched away from: this provider answered.
          switched: [],
        };
      } catch (err) {
        // A challenge is a reason to move down a rung, not a failure of the
        // provider — and not something the user should see.
        const challenge = err instanceof ChallengeError ? err.detection.verdict : null;
        const error = err instanceof Error ? err : new Error(String(err));
        this.ctx.rungs.recordFallThrough(adapterId, rung);
        exhausted.add(`${adapterId}:${rung}`);
        push('stream.end', { adapterId, rung, failed: error.name });
        log.warn(
          `fastpath: ${adapterId} ${rung} did not answer${challenge ? ` (${challenge})` : ''} — ${error.message}`,
        );
      }
    }

    return null;
  }

  /** Send one message and observe the settled answer, emitting stream events. */
  async sendAndObserve(
    adapter: Adapter,
    page: Page,
    text: string,
    opts: {
      debounceMs?: number;
      timeoutMs?: number;
      push: (kind: ControlEventKind, data: unknown) => void;
      adapterId: string;
      phase: 'boot' | 'prompt';
    },
  ): Promise<{ text: string; firstTokenMs: number | null; totalMs: number; settledBy: string }> {
    const startedAt = Date.now();
    const tabId = this.ctx.controller.status().tabs.slice(-1)[0]?.id ?? null;
    opts.push('stream.start', {
      adapterId: opts.adapterId,
      tabId,
      phase: opts.phase,
      prompt: text.slice(0, 200),
    });

    await adapter.sendPrompt(page, text);

    let lastEmit = 0;
    const onDelta = (partial: string, meta: { elapsedMs: number; streaming: boolean }) => {
      const now = Date.now();
      if (now - lastEmit < 50 && meta.streaming) return;
      lastEmit = now;
      opts.push('stream.delta', {
        adapterId: opts.adapterId,
        tabId,
        phase: opts.phase,
        text: partial,
        elapsedMs: meta.elapsedMs,
      });
    };

    if (isStreamingAdapter(adapter)) {
      return adapter.observeStreaming(page, {
        debounceMs: opts.debounceMs,
        timeoutMs: opts.timeoutMs,
        onDelta,
      });
    }
    const settled = await adapter.observeResponse(page, { debounceMs: opts.debounceMs ?? 900 });
    onDelta(settled, { elapsedMs: Date.now() - startedAt, streaming: false });
    return {
      text: settled,
      firstTokenMs: settled ? Date.now() - startedAt : null,
      totalMs: Date.now() - startedAt,
      settledBy: 'no-stream',
    };
  }

  /** Open a fresh owned tab on a provider's site and make it ready. */
  async openProviderPage(adapterId: string, adapter: Adapter) {
    const entry = this.ctx.adapters.list().find((e) => e.id === adapterId);
    const url = entry?.url ?? 'about:blank';
    await this.ctx.controller.newTab(url);
    const page = this.ctx.controller.activePage;
    if (!page) throw new Error(`ENOPAGE: could not open a tab for ${adapterId}`);
    await adapter.connect(page);
    return page;
  }

  limitMessage(adapterId: string, limit: { kind?: string; resetAt?: number }): string {
    const when = limit.resetAt
      ? ` (resets in ${Math.max(1, Math.round((limit.resetAt - Date.now()) / 60000))} min)`
      : '';
    return `ELIMIT: ${adapterId} is ${limit.kind ?? 'limited'}${when} — failover lands in batch 5.1/6.1`;
  }

  requirePage() {
    const page = this.ctx.controller.activePage;
    if (!page) {
      throw new Error('ENOTAB: no owned tab — attach and open a tab first');
    }
    return page;
  }
}
