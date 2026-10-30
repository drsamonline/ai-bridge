/**
 * Generic DOM adapter — one implementation, many providers.
 *
 * Claude and Gemini differ from ChatGPT only in their selectors and their limit
 * banner, so they share this class and supply a `SelectorMap`. (chatgpt.ts
 * predates this and keeps its bespoke version; migrating it is a 7.x tidy-up, and
 * its 21 contract checks are the reason not to churn it mid-batch.)
 *
 * Same guarantees as the ChatGPT adapter: lazy resolution primary → fallbacks →
 * ARIA, the match is logged, and the response observer owns the settle policy.
 */

import type { Page } from 'playwright-core';
import type { Adapter, Delta, ModelInfo, SelectorConfig } from '@ai-bridge/shared';
import type { Logger } from '../logger';
import { ResponseObserver, type ObserveSelectors } from './observer';
import type { AdapterHealth, ObserveStreamOptions, ObserveStreamResult, SelectorMatch } from './types';
import { MODEL_PICKER_SELECTORS, scrapeModels } from './models';

export interface SelectorRole {
  primary: string;
  fallbacks: string[];
  accessibility: string | null;
}

export type SelectorMap = Record<
  'composer' | 'send' | 'stop' | 'assistantTurn' | 'markdown' | 'copySentinel' | 'streamingFlag' | 'limitBanner',
  SelectorRole
>;

export interface DomAdapterConfig {
  id: string;
  label: string;
  url: string;
  selectors: SelectorMap;
  /** Banner text must match this to count as a limit. */
  limitPattern?: RegExp;
}

export class DomAdapter implements Adapter {
  readonly id: string;
  readonly url: string;
  readonly selectors: SelectorConfig;
  private readonly observer: ResponseObserver;
  private readonly matches = new Map<string, SelectorMatch>();
  private lastLimitKey: string | null = null;
  private lastModels: ModelInfo[] = [];

  constructor(
    private readonly cfg: DomAdapterConfig,
    private readonly log: Logger,
  ) {
    this.id = cfg.id;
    this.url = cfg.url;
    this.observer = new ResponseObserver(log.child('observe'));
    this.selectors = {
      primary: cfg.selectors.composer.primary,
      fallbacks: cfg.selectors.composer.fallbacks,
      accessibility: cfg.selectors.composer.accessibility,
    };
  }

  health(): AdapterHealth {
    return {
      ready: [...this.matches.values()].some((m) => m.via !== 'none'),
      matches: [...this.matches.values()],
    };
  }

  async probe(page: Page): Promise<SelectorMatch[]> {
    this.matches.clear();
    const roles = Object.keys(this.cfg.selectors) as Array<keyof SelectorMap>;
    for (const role of roles) {
      const loc = await this.tryResolve(page, role, { timeoutMs: 200, quiet: true });
      if (!loc) this.matches.set(role, { role, matched: '', via: 'none' });
    }
    return [...this.matches.values()];
  }

  async connect(page: Page): Promise<void> {
    const host = new URL(this.url).host;
    if (!page.url().includes(host)) {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    await this.resolve(page, 'composer', { timeoutMs: 20_000 });
  }

  async isReady(page: Page): Promise<boolean> {
    try {
      await this.resolve(page, 'composer', { timeoutMs: 3_000 });
      const limit = await this.detectLimit(page);
      return !limit.limited;
    } catch {
      return false;
    }
  }

  async detectLimit(
    page: Page,
  ): Promise<{ limited: boolean; kind?: 'quota' | 'rate' | 'error'; resetAt?: number }> {
    const sel = this.cfg.selectors.limitBanner;
    const pattern = this.cfg.limitPattern ?? /limit|reached|too many|try again|usage cap|upgrade/i;
    for (const candidate of [sel.primary, ...sel.fallbacks]) {
      const loc = page.locator(candidate).first();
      if ((await loc.count()) === 0) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      const text = (await loc.innerText().catch(() => '')).toLowerCase();
      if (!pattern.test(text)) continue;

      const kind = /too many|rate limit/.test(text) ? 'rate' : 'quota';
      const mins = text.match(/try again in (\d+)\s*(minute|min|hour|h)/);
      let resetAt: number | undefined;
      if (mins) {
        const n = Number.parseInt(mins[1]!, 10);
        resetAt = Date.now() + n * (mins[2]!.startsWith('h') ? 3_600_000 : 60_000);
      }
      const key = `${kind}:${resetAt ?? 'unknown'}`;
      if (key !== this.lastLimitKey) {
        this.lastLimitKey = key;
        this.log.warn(`${this.id}: limit banner detected (${kind})`, { selector: candidate, resetAt });
      }
      return { limited: true, kind, resetAt };
    }
    this.lastLimitKey = null;
    return { limited: false };
  }

  async sendPrompt(page: Page, text: string): Promise<void> {
    const composer = await this.resolve(page, 'composer', { timeoutMs: 10_000 });
    await composer.click({ timeout: 5_000 }).catch(() => undefined);
    await composer.fill(text, { timeout: 10_000 });
    const send = await this.tryResolve(page, 'send');
    if (send) {
      await send.click({ timeout: 10_000 });
      this.log.info(`${this.id}: send clicked`, { via: this.matches.get('send')?.matched });
    } else {
      await composer.press('Enter');
      this.log.info(`${this.id}: send button absent — pressed Enter`);
    }
  }

  async observeResponse(page: Page, opts: { debounceMs: number }): Promise<string> {
    const res = await this.observeStreaming(page, { debounceMs: opts.debounceMs });
    return res.text;
  }

  async observeStreaming(page: Page, opts: ObserveStreamOptions = {}): Promise<ObserveStreamResult> {
    const sel = this.cfg.selectors;
    const observeSelectors: ObserveSelectors = {
      assistantTurn: [sel.assistantTurn.primary, ...sel.assistantTurn.fallbacks],
      markdown: [sel.markdown.primary, ...sel.markdown.fallbacks],
      copySentinel: [sel.copySentinel.primary, ...sel.copySentinel.fallbacks],
      stopButton: [sel.stop.primary, ...sel.stop.fallbacks],
      streamingFlag: [sel.streamingFlag.primary, ...sel.streamingFlag.fallbacks],
    };
    return this.observer.observe(page, observeSelectors, opts);
  }

  async extractContext(_page: Page): Promise<Delta[]> {
    throw new Error('ENOTIMPL: extractContext lands with the state layer');
  }

  async injectContext(_page: Page, _boot: string): Promise<void> {
    throw new Error('ENOTIMPL: injectContext lands with the state layer');
  }

  /** §5.10: on-demand only — no polling, no background refresh. */
  async fetchModels(page: Page): Promise<ModelInfo[]> {
    const models = await scrapeModels(
      page as unknown as Parameters<typeof scrapeModels>[0],
      MODEL_PICKER_SELECTORS,
      (level, msg) => this.log[level](`${this.id}: ${msg}`),
    );
    this.lastModels = models;
    return models;
  }

  /** The models found by the last fetchModels(), for the Providers tab. */
  get models(): ModelInfo[] {
    return this.lastModels;
  }

  /* --------------------------------------------------------------- resolve */

  private async resolve(
    page: Page,
    role: keyof SelectorMap,
    opts: { timeoutMs?: number } = {},
  ): Promise<ReturnType<Page['locator']>> {
    const loc = await this.tryResolve(page, role, opts);
    if (!loc) {
      const spec = this.cfg.selectors[role];
      throw new Error(
        `ENOSELECTOR: no ${role} matched on ${page.url()} — tried ${[spec.primary, ...spec.fallbacks].join(', ')}`,
      );
    }
    return loc;
  }

  private async tryResolve(
    page: Page,
    role: keyof SelectorMap,
    opts: { timeoutMs?: number; quiet?: boolean } = {},
  ): Promise<ReturnType<Page['locator']> | null> {
    const spec = this.cfg.selectors[role];
    const deadline = Date.now() + (opts.timeoutMs ?? 2_000);
    const known = this.matches.get(role);
    const order: Array<[string, SelectorMatch['via']]> = [];
    if (known && known.matched && known.via !== 'accessibility') order.push([known.matched, known.via]);
    if (!known || known.matched !== spec.primary) order.push([spec.primary, 'primary']);
    for (const f of spec.fallbacks) order.push([f, 'fallback']);

    while (Date.now() < deadline) {
      for (const [selector, via] of order) {
        const loc = page.locator(selector).first();
        const count = await loc.count().catch(() => 0);
        if (count > 0 && (await loc.isVisible().catch(() => false))) {
          this.record(role, selector, via, opts.quiet);
          return loc;
        }
      }
      if (spec.accessibility) {
        const m = spec.accessibility.match(/^(\w+)\[name="(.+)"\]$/);
        if (m) {
          const loc = page.getByRole(m[1] as 'textbox', { name: m[2]! }).first();
          if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
            this.record(role, spec.accessibility, 'accessibility', opts.quiet);
            return loc;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!this.matches.has(role)) this.record(role, '', 'none', opts.quiet);
    return null;
  }

  private record(role: string, matched: string, via: SelectorMatch['via'], quiet = false): void {
    const prev = this.matches.get(role);
    this.matches.set(role, { role, matched, via });
    if (quiet) return;
    if (!prev || prev.matched !== matched || prev.via !== via) {
      if (via === 'none') this.log.warn(`${this.id}: selector ${role} matched nothing`);
      else this.log.info(`${this.id}: selector ${role} → ${via}`, { selector: matched });
    }
  }
}
