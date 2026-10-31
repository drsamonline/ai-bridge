/**
 * Bridge runtime — the seam between the wire protocol and the browser.
 *
 * Owns the controller, the RAM monitor and the watchdog, translates §4 and
 * `ctl.*` messages into calls, and republishes every domain event as a
 * `{ op:'ctl.event' }` push so the extension has something to render for each
 * one (spec: "no silent operations").
 */

import { EventEmitter } from 'node:events';
import type {
  Adapter,
  Page,
  AdapterHealthReport,
  ControlEvent,
  ControlEventKind,
  ControlMsg,
  PromptResult,
  RamLevel,
} from '@ai-bridge/shared';
import { CdpController } from './cdp/controller';
import { DEFAULT_PORTS } from './cdp/discovery';
import { RamMonitor } from './ram/monitor';
import { Watchdog } from './watchdog';
import { AdapterRegistry } from './adapters/registry';
import { Router, type ProviderSpec } from './router/router';
import {
  ApiRegistry,
  AuthExpiredError,
  RateLimitError,
  isAbortError,
  type ApiMessage,
  type FetchLike,
} from './api';
import {
  assembleNative,
  buildToolsSystemPrompt,
  type ResponseSink,
} from './protocol';
import {
  ChallengeError,
  RungPolicy,
  attemptFast,
  renderTemplate,
  replayInPage,
  validateTemplate,
  type FastPathTemplate,
  type Rung,
} from './fastpath';
import { composeBoot, deltaLineCount } from './bootTransport';
import { DOM_SHAPE_SNIPPET } from '@ai-bridge/shared';
import { isStreamingAdapter } from './adapters/types';
import { looksLikeSignIn, signInError } from './adapters/signin';
import type { Logger } from './logger';

export interface SwitchRecord {
  from: string;
  to: string;
  reason: 'limit' | 'switch';
}

export interface RuntimeOptions {
  log: Logger;
  /** When the bridge started, for the ready-time budget (§8). */
  startedAt?: number;
  providers?: unknown;
  routerStrategy?: 'priority' | 'round-robin';
  routerRetries?: number;
  routerBackoff?: 'exponential' | 'linear';
  ports?: number[];
  ramCapBytes?: number;
  pollMs?: number;
  warnRatio?: number;
  blockRatio?: number;
  maxTurns?: number;
  idleMs?: number;
  /**
   * Batch 8.1 — the transport's `fetch`, injectable. A host may want to wrap it
   * (a proxy, a retry policy), and the acceptance harness needs to drive it
   * without depending on undici's WASM support.
   */
  apiFetchImpl?: FetchLike;
}

export class BridgeRuntime {
  readonly controller: CdpController;
  readonly monitor: RamMonitor;
  readonly watchdog: Watchdog;
  /**
   * Batch 8.0 — OpenAI-compatible endpoints. A sibling of the DOM adapters, not
   * a replacement: nothing here launches a browser or touches a page.
   */
  readonly api: ApiRegistry;
  /**
   * Batch 8.4 — cooldowns for API endpoints, kept separate from the DOM chain.
   * Sharing one router would put `api:*` ids into `prompt()`'s chain, where
   * `adapters.get()` would throw. Same class, separate state, same policy.
   */
  readonly apiRouter: Router;
  /** In-flight endpoint requests, so one can be cancelled by id. */
  private readonly apiInFlight = new Map<string, AbortController>();
  /** Last 20 endpoint requests, for the breakage report. */
  private readonly apiRecent: Array<{
    t: number;
    model: string;
    ok: boolean;
    ms: number;
    code?: string;
    status?: number;
    retryAfterMs?: number;
  }> = [];
  private apiSeq = 0;
  /**
   * Batch 9.0 — which rung last worked per provider, and the templates that make
   * the fast rung possible. Empty by default: no provider template ships here.
   */
  readonly rungs = new RungPolicy();
  private readonly fastpath = new Map<string, FastPathTemplate>();
  /** Batch 9.0b — the same injectable fetch the API transport uses. */
  private readonly fastFetch: FetchLike;
  readonly adapters: AdapterRegistry;
  readonly router: Router;
  readonly bus = new EventEmitter();

  constructor(private readonly opts: RuntimeOptions) {
    const log = opts.log;
    this.controller = new CdpController({
      log: log.child('cdp'),
      ports: opts.ports ?? DEFAULT_PORTS,
      maxTurns: opts.maxTurns ?? 50,
      idleMs: opts.idleMs ?? 120_000,
    });
    this.monitor = new RamMonitor({
      controller: this.controller,
      capBytes: opts.ramCapBytes ?? 500 * 1024 * 1024,
      pollMs: opts.pollMs ?? 3000,
      log: log.child('ram'),
    });
    this.adapters = new AdapterRegistry(log.child('adapters'));
    // §5.9: priority chain with per-provider cooldowns. Settings arrive with 4.1;
    // until a Router tab writes them, the defaults below apply.
    this.router = new Router({
      providers: (opts.providers as ProviderSpec[] | undefined) ?? [
        { id: 'chatgpt', label: 'ChatGPT', enabled: true, priority: 1, cooldownMs: 300_000 },
        { id: 'claude', label: 'Claude', enabled: true, priority: 2, cooldownMs: 300_000 },
        { id: 'gemini', label: 'Gemini', enabled: true, priority: 3, cooldownMs: 300_000 },
      ],
      strategy: opts.routerStrategy ?? 'priority',
      retries: opts.routerRetries ?? 2,
      backoff: opts.routerBackoff ?? 'exponential',
      log: (level, msg) => log[level](msg),
    });
    this.watchdog = new Watchdog({
      monitor: this.monitor,
      controller: this.controller,
      log: log.child('watchdog'),
      warnRatio: opts.warnRatio ?? 0.8,
      blockRatio: opts.blockRatio ?? 1.0,
    });

    // Batch 8.0: endpoints arrive over `ctl.api.*`; no launch, no page, no key
    // on disk. Failures are logged, never thrown at the caller of setProviders.
    this.api = new ApiRegistry({
      log: (message) => log.debug?.(message),
      ...(opts.apiFetchImpl ? { fetchImpl: opts.apiFetchImpl } : {}),
    });
    this.apiRouter = new Router({
      providers: [],
      strategy: 'priority',
      retries: 0,
      backoff: 'exponential',
      log: (level, message) => log[level](`api ${message}`),
    });
    this.fastFetch = opts.apiFetchImpl ?? fetch;

    this.wire();
  }

  private wire(): void {
    const push = (kind: ControlEventKind, data: unknown) =>
      this.bus.emit('event', { op: 'ctl.event', kind, t: Date.now(), data } satisfies ControlEvent);

    this.controller.on('attached', (s) => push('attached', s));
    this.controller.on('detached', (d) => push('detached', d));
    this.controller.on('tab.opened', (d) => push('tab.opened', d));
    this.controller.on('tab.closed', (d) => push('tab.closed', d));
    this.controller.on('recycled', (d) => push('recycled', d));
    this.controller.on('gc', (d) => push('gc', d));

    this.monitor.on('sample', (s) => push('ram.sample', s));
    this.watchdog.on('warn', (d) => push('ram.warn', d));
    this.watchdog.on('block', (d) => push('ram.block', d));
    this.watchdog.on('ok', (d) => push('ram.ok', d));
  }

  get blocked(): boolean {
    return this.watchdog.blocked;
  }

  get level(): RamLevel {
    return this.watchdog.level;
  }

  start(): void {
    this.watchdog.start();
    this.monitor.start();
  }

  async stop(): Promise<void> {
    this.monitor.stop();
    if (this.controller.attached) await this.controller.detach();
  }

  /* -------------------------------------------------------------- adapters */

  adapterList(): Array<{ id: string; label: string; url: string; loaded: boolean }> {
    return this.adapters.list();
  }

  /** Health for one adapter: ready, limited, and which selector matched each role. */
  async health(adapterId: string): Promise<AdapterHealthReport> {
    const adapter = await this.adapters.get(adapterId);
    const entry = this.adapters.list().find((e) => e.id === adapterId)!;
    const page = this.controller.activePage;
    if (!page) {
      return {
        id: adapter.id,
        label: entry.label,
        url: entry.url,
        ready: false,
        limited: false,
        matches: [],
      };
    }
    const ready = await adapter.isReady(page).catch(() => false);
    const limit: { limited: boolean; kind?: 'quota' | 'rate' | 'error'; resetAt?: number } =
      await adapter.detectLimit(page).catch(() => ({ limited: false }));
    const matches =
      isStreamingAdapter(adapter) && typeof adapter.probe === 'function'
        ? await adapter.probe(page)
        : isStreamingAdapter(adapter)
          ? adapter.health().matches
          : [];
    return {
      id: adapter.id,
      label: entry.label,
      url: entry.url,
      ready,
      limited: limit.limited,
      limitKind: limit.kind,
      matches,
    };
  }

  /** §4 `navigate`: put the owned tab on the adapter's site. */
  async navigate(msg: { adapterId: string; url: string }): Promise<{ url: string }> {
    const page = this.requirePage();
    await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    this.opts.log.info('navigated', { adapterId: msg.adapterId, url: page.url() });
    return { url: page.url() };
  }

  /** §4 `send`: write the prompt into the composer and submit. */
  async send(msg: { adapterId: string; text: string }): Promise<{ sent: true; chars: number }> {
    const page = this.requirePage();
    const adapter = await this.adapters.get(msg.adapterId);
    if (!(await adapter.isReady(page))) await adapter.connect(page);
    const limit = await adapter.detectLimit(page);
    if (limit.limited) throw new Error(this.limitMessage(msg.adapterId, limit));
    await adapter.sendPrompt(page, msg.text);
    return { sent: true, chars: msg.text.length };
  }

  /** §4 `observe`: wait for the settled answer (no deltas). */
  async observe(msg: { adapterId: string; debounceMs: number }): Promise<{ text: string }> {
    const page = this.requirePage();
    const adapter = await this.adapters.get(msg.adapterId);
    const text = await adapter.observeResponse(page, { debounceMs: msg.debounceMs });
    return { text };
  }

  /**
   * The full prompt round trip the Chat panel drives: ensure ready → send →
   * stream the answer back as `stream.*` events → return the settled text.
   */
  /**
   * The prompt round trip, with §5.9 failover.
   *
   * `adapterId: 'auto'` (or absent) walks the router's chain: on a limit the
   * provider is cooled, the next one is opened, the boot is injected into it, and
   * the prompt is sent there. An explicit adapterId is honoured as-is.
   */
  async prompt(msg: {
    adapterId?: string;
    text: string;
    boot?: string;
    /** §6.2 delta-only transport: what changed since the boot was built. */
    delta?: string;
    debounceMs?: number;
    timeoutMs?: number;
  }): Promise<PromptResult & { switched: SwitchRecord[]; bootChars?: number; bootAnswer?: string }> {
    const log = this.opts.log;
    const requested = msg.adapterId && msg.adapterId !== 'auto' ? msg.adapterId : null;
    const chain = requested
      ? [requested]
      : this.router.chain().map((p) => p.id);

    if (chain.length === 0) {
      throw new Error('ENOPROVIDER: every provider is disabled or cooling down');
    }

    const push = (kind: ControlEventKind, data: unknown) =>
      this.bus.emit('event', { op: 'ctl.event', kind, t: Date.now(), data } satisfies ControlEvent);

    const switched: SwitchRecord[] = [];
    let bootChars: number | undefined;
    let bootAnswer: string | undefined;
    let lastError: Error | null = null;
    let currentId: string | null = null;
    let page = this.controller.activePage;

    // A rung that already fell through for this provider is not re-tried when
    // the router retries the prompt: the endpoint's answer will not have changed
    // in the intervening milliseconds, and each retry would cost a request.
    const exhausted = new Set<string>();

    for (const adapterId of chain) {
      const isSwitch = currentId !== null && currentId !== adapterId;

      // Batch 9.0b: the rungs above the DOM adapter, when this provider has an
      // enabled template. No template means the DOM path exactly as before —
      // which is every provider by default.
      //
      // Tried BEFORE the adapter lookup, because a template can name a provider
      // this build has no adapter for: the template is the definition then.
      const template = this.fastpath.get(adapterId);
      if (template?.enabled) {
        const answered = await this.tryRungs(adapterId, template, msg, push, exhausted);
        if (answered) return answered;
      }

      const adapter = await this.adapters.get(adapterId);

      try {
        if (isSwitch || !page) {
          // A switch means a NEW page: the old one is limit-bound.
          page = await this.openProviderPage(adapterId, adapter);
          const reason = lastError && /ELIMIT/.test(lastError.message) ? 'limit' : 'switch';
          if (currentId) {
            switched.push({ from: currentId, to: adapterId, reason });
            push('provider.switch', { from: currentId, to: adapterId, reason });
            log.warn(`failover: ${currentId} → ${adapterId} (${reason})`);
          }
          // §6.2: learn whether this provider is on a free model, so the next
          // failover decision prefers free ones.
          try {
            const models = await adapter.fetchModels(page);
            const current = models.find((m) => m.current) ?? models[0];
            if (current) this.router.setModelFree(adapterId, current.isFree);
          } catch (err) {
            log.debug?.(`models unavailable on ${adapterId}: ${(err as Error).message}`);
          }

          // §5.9: inject the boot so the new provider inherits the context.
          if (msg.boot && msg.boot.trim()) {
            // §6.2 delta-only: after the boot, only what changed is re-sent.
            const composed = composeBoot(msg.boot, msg.delta);
            bootChars = composed.length;
            const injected = await this.sendAndObserve(adapter, page, composed, {
              debounceMs: msg.debounceMs,
              timeoutMs: msg.timeoutMs,
              push,
              adapterId,
              phase: 'boot',
            });
            bootAnswer = injected.text.slice(0, 2000);
            log.info(`failover: boot injected into ${adapterId}`, {
              chars: injected.text.length,
              bootChars: composed.length,
              withDelta: Boolean(msg.delta && msg.delta.trim()),
            });
            push('boot.injected', {
              adapterId,
              chars: injected.text.length,
              bootChars: composed.length,
              withDelta: Boolean(msg.delta && msg.delta.trim()),
              deltaLines: deltaLineCount(msg.delta),
              answer: bootAnswer,
            });
          }
        } else if (!(await adapter.isReady(page))) {
          // Batch 8.4b: a sign-in page is not a broken selector. Reporting "no
          // answer" here sends the user hunting for a selector instead of a login.
          if (looksLikeSignIn(page.url())) {
            throw new Error(signInError(adapterId, page.url()));
          }
          log.info('adapter not ready — connecting', { adapterId, url: page.url() });
          await adapter.connect(page);
        }

        const limit = await adapter.detectLimit(page);
        if (limit.limited) {
          const cooldown = this.router.markLimited(adapterId, limit.kind, limit.resetAt);
          push('adapter.health', {
            adapterId,
            limited: true,
            kind: limit.kind,
            resetAt: limit.resetAt,
            cooldownMs: cooldown,
          });
          lastError = new Error(this.limitMessage(adapterId, limit));
          currentId = adapterId;
          continue;
        }

        const tabId = this.controller.status().tabs.slice(-1)[0]?.id ?? null;
        const result = await this.sendAndObserve(adapter, page, msg.text, {
          debounceMs: msg.debounceMs,
          timeoutMs: msg.timeoutMs,
          push,
          adapterId,
          phase: 'prompt',
        });

        this.router.markSuccess(adapterId);
        const turns = await this.controller.noteTurn(undefined, 1);
        push('stream.end', {
          adapterId,
          tabId,
          totalMs: result.totalMs,
          firstTokenMs: result.firstTokenMs,
          settledBy: result.settledBy,
          chars: result.text.length,
          switched: switched.length,
        });
        log.info('prompt settled', {
          adapterId,
          firstTokenMs: result.firstTokenMs,
          totalMs: result.totalMs,
          settledBy: result.settledBy,
          chars: result.text.length,
          turns: turns.turns,
          switched: switched.map((s) => `${s.from}→${s.to}`).join(',') || 'none',
        });

        return {
          adapterId,
          text: result.text,
          firstTokenMs: result.firstTokenMs,
          totalMs: result.totalMs,
          settledBy: result.settledBy as PromptResult['settledBy'],
          tabId,
          turns: turns.turns,
          switched,
          ...(bootChars !== undefined ? { bootChars } : {}),
          ...(bootAnswer !== undefined ? { bootAnswer } : {}),
        };
      } catch (err) {
        const error = err as Error;
        lastError = error;
        const outcome = this.router.markFailure(adapterId);
        log.warn(`prompt failed on ${adapterId}: ${error.message}`, { attempt: outcome.attempt });
        currentId = adapterId;
        if (!outcome.exhausted && outcome.retryAfterMs > 0) {
          await new Promise((r) => setTimeout(r, outcome.retryAfterMs));
          chain.splice(chain.indexOf(adapterId) + 1, 0, adapterId);
        }
      }
    }

    throw lastError ?? new Error('ENOANSWER: no provider produced an answer');
  }

  /**
   * Batch 9.0b — try the rungs above the DOM adapter for one provider.
   *
   * Returns a result when a rung answered, or `null` when the caller should run
   * the DOM path. The cascade is the point: a challenge on the fast rung is not
   * an error, it is a reason to try the next one.
   */
  private async tryRungs(
    adapterId: string,
    template: FastPathTemplate,
    msg: { text: string },
    push: (kind: ControlEventKind, data: unknown) => void,
    exhausted: Set<string>,
  ): Promise<(PromptResult & { switched: SwitchRecord[] }) | null> {
    const log = this.opts.log;
    const page = this.controller.activePage;
    const candidates: Rung[] = page ? ['fast', 'replay', 'dom'] : ['fast', 'dom'];
    const available = candidates.filter((rung) => !exhausted.has(`${adapterId}:${rung}`));
    const preferred = this.rungs.choose(adapterId, available);
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
            ? attemptFast(template, { prompt: msg.text }, { fetchImpl: this.fastFetch })
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
        this.rungs.record(adapterId, rung);
        this.router.markSuccess(adapterId);
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
          turns: this.controller.status().turns,
          // Nothing was switched away from: this provider answered.
          switched: [],
        };
      } catch (err) {
        // A challenge is a reason to move down a rung, not a failure of the
        // provider — and not something the user should see.
        const challenge = err instanceof ChallengeError ? err.detection.verdict : null;
        const error = err instanceof Error ? err : new Error(String(err));
        this.rungs.recordFallThrough(adapterId, rung);
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
  private async sendAndObserve(
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
    const tabId = this.controller.status().tabs.slice(-1)[0]?.id ?? null;
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
  private async openProviderPage(adapterId: string, adapter: Adapter) {
    const entry = this.adapters.list().find((e) => e.id === adapterId);
    const url = entry?.url ?? 'about:blank';
    await this.controller.newTab(url);
    const page = this.controller.activePage;
    if (!page) throw new Error(`ENOPAGE: could not open a tab for ${adapterId}`);
    await adapter.connect(page);
    return page;
  }

  private limitMessage(adapterId: string, limit: { kind?: string; resetAt?: number }): string {
    const when = limit.resetAt
      ? ` (resets in ${Math.max(1, Math.round((limit.resetAt - Date.now()) / 60000))} min)`
      : '';
    return `ELIMIT: ${adapterId} is ${limit.kind ?? 'limited'}${when} — failover lands in batch 5.1/6.1`;
  }

  private requirePage() {
    const page = this.controller.activePage;
    if (!page) {
      throw new Error('ENOTAB: no owned tab — attach and open a tab first');
    }
    return page;
  }

  /** Full status block for the status bar and the Providers/Performance tabs. */
  status(): unknown {
    return {
      browser: this.controller.status(),
      ram: this.monitor.latest(),
      watchdog: { level: this.watchdog.level, blocked: this.watchdog.blocked },
      caps: { browserBytes: this.monitor.capBytes, pollMs: this.monitor.pollMs },
    };
  }

  /** The templates, with the secret-free shape a status call may return. */
  private fastpathList(): Array<{
    providerId: string;
    url: string;
    method: string;
    enabled: boolean;
    hasHeaders: boolean;
  }> {
    return [...this.fastpath.values()].map((template) => ({
      providerId: template.providerId,
      url: template.url,
      method: template.method ?? 'POST',
      enabled: template.enabled === true,
      hasHeaders: Boolean(template.headers && Object.keys(template.headers).length),
    }));
  }

  /** Batch 8.4: one record per endpoint request, for the breakage report. */
  private recordApi(entry: {
    model: string;
    ok: boolean;
    ms: number;
    code?: string;
    status?: number;
    retryAfterMs?: number;
  }): void {
    this.apiRecent.push({ t: Date.now(), ...entry });
    if (this.apiRecent.length > 20) this.apiRecent.shift();
  }

  /** Dispatch a `ctl.*` message. Every branch returns a JSON-able payload. */
  async control(msg: ControlMsg): Promise<unknown> {
    const log = this.opts.log;
    switch (msg.op) {
      case 'ctl.attach': {
        const status = await this.controller.attach(msg.ports);
        // The first tab is opened eagerly so the status bar has an age to show
        // and adapters in 1.1 have a page waiting.
        if (status.tabs.length === 0) await this.controller.newTab('about:blank');
        return this.status();
      }
      case 'ctl.detach':
        return this.controller.detach();
      case 'ctl.status': {
        const base = this.status() as unknown as Record<string, unknown>;
        return {
          ...base,
          // §5.1's 30–50 MB budget is measured here so a test can assert it.
          process: {
            rssMb: Math.round(process.memoryUsage().rss / 1048576),
            uptimeMs: Date.now() - (this.opts.startedAt ?? Date.now()),
            pid: process.pid,
          },
        };
      }
      case 'ctl.ram':
        return this.monitor.sample();
      case 'ctl.tab.open':
        return this.controller.newTab(msg.url ?? 'about:blank');
      case 'ctl.tab.close':
        return this.controller.closeTab(msg.tabId);
      case 'ctl.turn':
        return this.controller.noteTurn(msg.tabId, msg.n ?? 1);
      case 'ctl.gc':
        return this.controller.gc();
      case 'ctl.adapters':
        return { adapters: this.adapterList() };
      case 'ctl.providers.set': {
        // §1: "any logged-in web chat AI" — providers from configuration.
        const { validateCustomProvider } = await import('./adapters/custom');
        const accepted: string[] = [];
        const rejected: Array<{ id: string; error: string }> = [];
        const valid: unknown[] = [];
        for (const raw of msg.providers ?? []) {
          const v = validateCustomProvider(raw);
          if (v.ok) {
            valid.push(v.config);
            accepted.push(v.config.id);
          } else {
            rejected.push({ id: String((raw as { id?: string })?.id ?? '?'), error: v.error });
          }
        }
        const list = this.adapters.setCustom(valid);
        // Keep the router in step: custom providers join at the end of the chain.
        const base = this.router.status().length;
        (valid as Array<{ id: string; label: string }>).forEach((cfg, i) => {
          this.router.addProvider({
            id: cfg.id,
            label: cfg.label,
            enabled: true,
            priority: base + i + 1,
            cooldownMs: 300_000,
          });
        });
        log.info(`providers: ${accepted.length} custom accepted, ${rejected.length} rejected`, {
          accepted,
        });
        return { accepted, rejected, providers: list };
      }
      case 'ctl.diagnostics': {
        // §7.2: everything a breakage report needs, and nothing a chat contains.
        const adapter = await this.adapters.get(msg.adapterId);
        const page = this.controller.activePage;
        if (!page) throw new Error('ENOTATTACHED: no owned tab to describe');
        const probe = (adapter as unknown as { probe?: (p: unknown) => Promise<unknown> }).probe;
        const matches = probe ? await probe.call(adapter, page) : [];
        // Playwright cannot pass arguments to a string expression, so the
        // selector is inlined into the call.
        const expression = `(${DOM_SHAPE_SNIPPET})(${JSON.stringify(msg.selector ?? 'body')})`;
        const shape = await (page as unknown as { evaluate: (src: string) => Promise<unknown> })
          .evaluate(expression)
          .catch(() => null);
        let host = 'unknown';
        try {
          host = new URL(page.url()).host;
        } catch {
          host = 'unknown';
        }
        return {
          adapterId: msg.adapterId,
          host,
          matches,
          shape,
          bridgeVersion: (this.opts as { version?: string }).version ?? null,
        };
      }
      case 'ctl.models': {
        const adapter = await this.adapters.get(msg.adapterId);
        const page = this.controller.activePage;
        if (!page) throw new Error('ENOTATTACHED: no owned tab to read models from');
        const models = await adapter.fetchModels(page);
        const current = models.find((m) => m.current) ?? models[0];
        if (current) this.router.setModelFree(msg.adapterId, current.isFree);
        log.info(`models for ${msg.adapterId}`, {
          count: models.length,
          current: current?.label,
          free: current?.isFree,
        });
        return { adapterId: msg.adapterId, models, current: current ?? null };
      }
      case 'ctl.router':
        return {
          strategy: this.opts.routerStrategy ?? 'priority',
          retries: this.opts.routerRetries ?? 2,
          backoff: this.opts.routerBackoff ?? 'exponential',
          providers: this.router.status(),
          prewarm: this.router.prewarmCandidates().map((p) => p.id),
        };
      case 'ctl.router.configure': {
        const ok = this.router.updateProvider(msg.adapterId, {
          ...(msg.priority !== undefined ? { priority: msg.priority } : {}),
          ...(msg.cooldownMs !== undefined ? { cooldownMs: msg.cooldownMs } : {}),
          ...(msg.enabled !== undefined ? { enabled: msg.enabled } : {}),
        });
        if (!ok) throw new Error(`ENOPROVIDER: unknown provider "${msg.adapterId}"`);
        return { providers: this.router.status() };
      }
      case 'ctl.router.clear': {
        if (msg.adapterId) {
          const cleared = this.router.clearCooldown(msg.adapterId);
          log.info(`router: cooldown cleared for ${msg.adapterId}`, { cleared });
        } else {
          for (const p of this.router.status()) this.router.clearCooldown(p.id);
          log.info('router: all cooldowns cleared');
        }
        return { providers: this.router.status() };
      }
      case 'ctl.router.prewarm': {
        // §5.9: open the page of a provider whose cooldown is 80% through, so the
        // switch is instant when it expires.
        const candidates = this.router.prewarmCandidates();
        const warmed: string[] = [];
        for (const spec of candidates.slice(0, 1)) {
          try {
            const adapter = await this.adapters.get(spec.id);
            await this.openProviderPage(spec.id, adapter);
            warmed.push(spec.id);
            log.info(`router: pre-warmed ${spec.id}`);
          } catch (err) {
            log.warn(`router: pre-warm of ${spec.id} failed: ${(err as Error).message}`);
          }
        }
        return { warmed, candidates: candidates.map((c) => c.id) };
      }
      /* ------------------------------------------------------- batch 8.0 */
      case 'ctl.api.providers.set': {
        // Endpoints from configuration, validated one by one so a bad entry is
        // reported by id rather than failing the whole set.
        const result = this.api.setProviders(msg.providers ?? [], msg.keys ?? {});
        // Batch 8.4: one router entry per endpoint, so a 429 has somewhere to
        // cool. Priorities start at 101 so an endpoint never outranks a web chat.
        const configured = new Set(result.accepted);
        const names = new Map(this.api.providerList().map((p) => [p.id, p.name]));
        result.accepted.forEach((id, index) => {
          this.apiRouter.addProvider({
            id: `api:${id}`,
            label: names.get(id) ?? id,
            enabled: true,
            priority: 101 + index,
            cooldownMs: 300_000,
          });
        });
        // An endpoint that is no longer configured keeps no router entry.
        for (const entry of this.apiRouter.status()) {
          if (!configured.has(entry.id.replace(/^api:/, ''))) {
            this.apiRouter.updateProvider(entry.id, { enabled: false });
          }
        }
        log.info(
          `api: ${result.accepted.length} endpoint(s) accepted, ${result.rejected.length} rejected`,
          { accepted: result.accepted },
        );
        return {
          ...result,
          providers: this.api.statuses(),
          router: this.apiRouter.status(),
        };
      }
      case 'ctl.api.models': {
        // A pinned catalogue is never fetched; an endpoint that fails keeps its
        // previous models and reports `lastError` on its status instead.
        const models = await this.api.refresh(msg.providerId);
        return { models, providers: this.api.statuses() };
      }
      case 'ctl.api.status':
        return {
          providers: this.api.statuses(),
          models: this.api.modelList(),
          router: this.apiRouter.status(),
          recent: this.apiRecent,
        };
      case 'ctl.api.prompt': {
        // Batch 8.1: one endpoint answer, assembled. The three channels a chat
        // host needs — text, reasoning, tool calls — leave here as events, so a
        // panel never has to know how a call is spelled.
        const startedAt = Date.now();
        const push = (kind: ControlEventKind, data: unknown) =>
          this.bus.emit('event', {
            op: 'ctl.event',
            kind,
            t: Date.now(),
            data,
          } satisfies ControlEvent);

        const model = msg.model;
        const target = this.api.resolve(model);
        if (!target) throw new Error(`ECONFIG: unknown model "${model}"`);

        // Batch 8.4: an endpoint in cooldown fails fast instead of spending a
        // request to learn what the router already knows.
        const providerId = target.config.id;
        const routerId = `api:${providerId}`;
        const routerState = this.apiRouter.status().find((entry) => entry.id === routerId);
        if (routerState?.state === 'cooling') {
          const waitMs = Math.max(0, routerState.cooldownUntil - Date.now());
          throw new Error(
            `ERATELIMIT: ${providerId} is cooling for another ${Math.ceil(waitMs / 1000)}s`,
          );
        }

        const requestId = msg.requestId ?? `api-${(this.apiSeq += 1)}`;
        const controller = new AbortController();
        this.apiInFlight.set(requestId, controller);

        const tools = msg.tools ?? [];
        const promptToolProtocol = msg.promptToolProtocol === true;
        // The protocol is only written into the prompt when the endpoint cannot
        // take tools structurally — otherwise it would duplicate the schema.
        const system =
          promptToolProtocol && tools.length > 0 ? buildToolsSystemPrompt(tools) : '';
        const messages: ApiMessage[] = [
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          ...(msg.messages ?? []).map((message) => ({
            role: message.role as ApiMessage['role'],
            content: message.content,
            ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
            // Batch 8.1b: the assistant's own calls, so a tool result answers a
            // call id the provider actually issued.
            ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
          })),
        ];

        push('stream.start', { model, requestId, phase: 'prompt', promptToolProtocol });

        // `requestId` rides on every delta (batch 8.2), so a second consumer of
        // the same model — Copilot Chat beside our panel — can pick out its own
        // stream instead of rendering someone else's.
        const sink: ResponseSink = {
          text: (part) =>
            push('stream.delta', { model, requestId, text: part, elapsedMs: Date.now() - startedAt }),
          thinking: (part) =>
            push('stream.thinking', { model, requestId, text: part, elapsedMs: Date.now() - startedAt }),
          toolCall: (call) =>
            push('tool.call', { model, requestId, call, elapsedMs: Date.now() - startedAt }),
          usage: (promptTokens, completionTokens) =>
            push('api.usage', { model, requestId, promptTokens, completionTokens }),
        };

        try {
          const assembled = await assembleNative(
            this.api.stream({
              model,
              messages,
              ...(tools.length ? { tools } : {}),
              ...(msg.maxTokens !== undefined ? { maxTokens: msg.maxTokens } : {}),
              ...(msg.temperature !== undefined ? { temperature: msg.temperature } : {}),
              signal: controller.signal,
            }),
            sink,
            {
              tools,
              promptToolProtocol,
              isCancelled: () => controller.signal.aborted,
              onDrop: (reason, chars) =>
                log.debug?.(`api prompt: dropped ${chars} chars of transcript echo (${reason})`),
            },
          );

          const totalMs = Date.now() - startedAt;
          if (controller.signal.aborted) {
            // A cancel is neither a success nor a failure: the endpoint did
            // nothing wrong, the user changed their mind. Marking it either way
            // would penalise the provider for our decision.
            this.recordApi({ model, ok: false, ms: totalMs, code: 'ECANCELLED' });
            push('stream.end', { model, requestId, totalMs, ...assembled, cancelled: true });
            return { model, requestId, totalMs, ...assembled, cancelled: true };
          }

          this.apiRouter.markSuccess(routerId);
          this.recordApi({ model, ok: true, ms: totalMs });
          push('stream.end', { model, requestId, totalMs, ...assembled });
          log.info('api prompt assembled', {
            model,
            textChars: assembled.textChars,
            thinkingChars: assembled.thinkingChars,
            toolCalls: assembled.toolCalls.length,
            totalMs,
          });
          return { model, requestId, totalMs, ...assembled };
        } catch (err) {
          const error = err as Error & {
            code?: string;
            status?: number;
            retryAfterMs?: number;
          };
          const totalMs = Date.now() - startedAt;

          if (isAbortError(err, controller.signal)) {
            this.recordApi({ model, ok: false, ms: totalMs, code: 'ECANCELLED' });
            throw error;
          }

          if (err instanceof RateLimitError) {
            // Cool for exactly as long as the endpoint asked, not our default.
            const cooldownMs = this.apiRouter.markLimited(
              routerId,
              'rate',
              err.retryAfterMs ? Date.now() + err.retryAfterMs : undefined,
            );
            push('api.limited', {
              providerId,
              retryAfterMs: err.retryAfterMs ?? null,
              cooldownMs,
            });
            log.warn(`api: ${providerId} rate limited — cooling ${Math.round(cooldownMs / 1000)}s`);
          } else if (err instanceof AuthExpiredError) {
            // The credential is dead. Forget it, so the next request reports
            // "signed out" instead of replaying it and cooling the chain.
            const forgotten = this.api.forgetRejected(providerId);
            push('api.auth', { providerId, forgotten });
            log.warn(`api: ${providerId} credential refused${forgotten ? ' — forgotten' : ''}`);
          } else {
            this.apiRouter.markFailure(routerId);
          }

          this.recordApi({
            model,
            ok: false,
            ms: totalMs,
            ...(error.code ? { code: error.code } : {}),
            ...(typeof error.status === 'number' && error.status > 0
              ? { status: error.status }
              : {}),
            ...(typeof error.retryAfterMs === 'number'
              ? { retryAfterMs: error.retryAfterMs }
              : {}),
          });
          push('stream.end', { model, requestId, totalMs, failed: error.code ?? 'EUNKNOWN' });
          throw error;
        } finally {
          this.apiInFlight.delete(requestId);
        }
      }
      case 'ctl.api.cancel': {
        const controller = this.apiInFlight.get(msg.requestId);
        if (!controller) return { requestId: msg.requestId, cancelled: false };
        controller.abort();
        log.info(`api: request ${msg.requestId} cancelled`);
        return { requestId: msg.requestId, cancelled: true };
      }
      /* ------------------------------------------------------- batch 9.0 */
      case 'ctl.fastpath.set': {
        const accepted: string[] = [];
        const rejected: Array<{ id: string; error: string }> = [];
        const next = new Map<string, FastPathTemplate>();
        for (const raw of msg.templates ?? []) {
          const verdict = validateTemplate(raw);
          if (!verdict.ok) {
            const id = (raw as { providerId?: unknown } | null)?.providerId;
            rejected.push({ id: typeof id === 'string' ? id : '?', error: verdict.error });
            continue;
          }
          next.set(verdict.config.providerId, verdict.config);
          accepted.push(verdict.config.providerId);
        }
        this.fastpath.clear();
        for (const [id, template] of next) this.fastpath.set(id, template);
        log.info(
          `fastpath: ${accepted.length} template(s) accepted, ${rejected.length} rejected`,
          { accepted },
        );
        return { accepted, rejected, templates: this.fastpathList() };
      }
      case 'ctl.fastpath.status':
        return { templates: this.fastpathList(), rungs: this.rungs.status() };
      case 'ctl.health':
        return this.health(msg.adapterId);
      case 'ctl.limit': {
        // §5.1: the limit probe the rotation flow asks before it gives up a page.
        const adapter = await this.adapters.get(msg.adapterId);
        const page = this.controller.activePage;
        if (!page) return { limited: false, reason: 'no owned tab' };
        const verdict = await adapter.detectLimit(page);
        if (verdict.limited) {
          log.warn(`limit reported for ${msg.adapterId}`, { kind: verdict.kind, resetAt: verdict.resetAt });
        }
        return verdict;
      }
      case 'ctl.prompt':
        return this.prompt(msg);
      case 'ctl.config': {
        if (typeof msg.ramCapBytes === 'number') {
          this.monitor.setCap(msg.ramCapBytes);
          log.info('ram cap updated', { capMB: Math.round(msg.ramCapBytes / 1048576) });
        }
        if (typeof msg.pollMs === 'number') this.monitor.setPoll(msg.pollMs);
        if (typeof msg.warnRatio === 'number' || typeof msg.blockRatio === 'number') {
          this.watchdog.setThresholds(
            msg.warnRatio ?? 0.8,
            msg.blockRatio ?? 1.0,
          );
        }
        return { caps: { browserBytes: this.monitor.capBytes, pollMs: this.monitor.pollMs } };
      }
      default: {
        const never: never = msg;
        throw new Error(`unknown control op: ${JSON.stringify(never)}`);
      }
    }
  }
}
