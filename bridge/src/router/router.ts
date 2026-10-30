/**
 * Router + breaker — spec §5.9.
 *
 * Priority chain · per-provider cooldown · exponential backoff with jitter ·
 * pre-warm at 80% cooldown · failover order.
 *
 * Pure policy: it decides *who* runs next and *when* a provider comes back. It
 * never touches a page. That keeps it testable against a fake clock, which is the
 * only way to test a cooldown without waiting five minutes.
 */

export interface ProviderSpec {
  id: string;
  label: string;
  enabled: boolean;
  /** 1 runs first. */
  priority: number;
  cooldownMs: number;
}

export type ProviderState = 'ready' | 'cooling' | 'disabled';

export interface ProviderRuntime {
  id: string;
  label: string;
  priority: number;
  state: ProviderState;
  /** Wall-clock when the cooldown expires; 0 when not cooling. */
  cooldownUntil: number;
  failures: number;
  lastUsed: number;
  limitedKind?: 'quota' | 'rate' | 'error' | string;
  /** 0–1 progress through the cooldown, for the pre-warm rule. */
  cooldownProgress: number;
}

export interface RouterOptions {
  providers: ProviderSpec[];
  strategy?: 'priority' | 'round-robin';
  retries?: number;
  backoff?: 'exponential' | 'linear';
  /** Injected for deterministic tests. */
  now?: () => number;
  jitter?: () => number;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** §5.9: pre-warm once the cooldown is this far through. */
  prewarmRatio?: number;
}

interface Entry {
  spec: ProviderSpec;
  cooldownUntil: number;
  failures: number;
  lastUsed: number;
  limitedKind?: string;
  /** Backoff deadline — a failure pushes the provider out beyond its cooldown. */
  backoffUntil: number;
}

export interface FailureOutcome {
  attempt: number;
  retryAfterMs: number;
  exhausted: boolean;
}

export class Router {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly jitter: () => number;
  private roundRobinCursor = 0;
  /** §6.2: is the provider's *current* model free? Feeds the ordering. */
  private readonly modelFree = new Map<string, boolean>();

  constructor(private readonly opts: RouterOptions) {
    this.now = opts.now ?? Date.now;
    // ±20% jitter by default: a fleet of identical retry timers is a thundering herd.
    this.jitter = opts.jitter ?? (() => 0.8 + Math.random() * 0.4);
    for (const spec of opts.providers) {
      this.entries.set(spec.id, {
        spec,
        cooldownUntil: 0,
        failures: 0,
        lastUsed: 0,
        backoffUntil: 0,
      });
    }
  }

  private get strategy(): 'priority' | 'round-robin' {
    return this.opts.strategy ?? 'priority';
  }

  private get maxRetries(): number {
    return Math.max(0, this.opts.retries ?? 2);
  }

  isCooling(id: string, at = this.now()): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    return Math.max(e.cooldownUntil, e.backoffUntil) > at;
  }

  /** §5.9 Router tab: reorder (priority), cooldown and enable/disable. */
  updateProvider(id: string, patch: { priority?: number; cooldownMs?: number; enabled?: boolean }): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    if (typeof patch.priority === 'number' && patch.priority >= 1) e.spec.priority = Math.round(patch.priority);
    if (typeof patch.cooldownMs === 'number' && patch.cooldownMs >= 0) e.spec.cooldownMs = Math.round(patch.cooldownMs);
    if (typeof patch.enabled === 'boolean') e.spec.enabled = patch.enabled;
    this.opts.log?.('info', `router: ${id} updated ${JSON.stringify(patch)}`);
    return true;
  }

  /** Register a provider discovered from configuration (§1). */
  addProvider(spec: ProviderSpec): void {
    if (this.entries.has(spec.id)) {
      this.entries.get(spec.id)!.spec = spec;
      return;
    }
    this.entries.set(spec.id, {
      spec,
      cooldownUntil: 0,
      failures: 0,
      lastUsed: 0,
      backoffUntil: 0,
    });
    this.opts.log?.('info', `router: provider "${spec.id}" added (priority ${spec.priority})`);
  }

  /** Record whether a provider's current model is free (from fetchModels). */
  setModelFree(id: string, isFree: boolean): void {
    this.modelFree.set(id, isFree);
    this.opts.log?.('info', `router: ${id} current model is ${isFree ? 'free' : 'paid'}`);
  }

  modelIsFree(id: string): boolean | undefined {
    return this.modelFree.get(id);
  }

  /** Providers that could run right now, in the order they should be tried. */
  order(at = this.now()): ProviderSpec[] {
    const freeScore = (id: string) => (this.modelFree.get(id) === true ? 0 : 1);
    const usable = [...this.entries.values()]
      .filter((e) => e.spec.enabled && !this.isCooling(e.spec.id, at))
      .sort(
        (a, b) =>
          a.spec.priority - b.spec.priority ||
          // Within the same priority, a free model is preferred (§6.2).
          freeScore(a.spec.id) - freeScore(b.spec.id) ||
          a.spec.id.localeCompare(b.spec.id),
      )
      .map((e) => e.spec);

    if (this.strategy === 'priority' || usable.length <= 1) return usable;

    // Round-robin: rotate the list so the last-used provider goes to the back.
    const cursor = this.roundRobinCursor % usable.length;
    this.roundRobinCursor = (this.roundRobinCursor + 1) % Math.max(1, usable.length);
    return [...usable.slice(cursor), ...usable.slice(0, cursor)];
  }

  next(at = this.now()): ProviderSpec | null {
    return this.order(at)[0] ?? null;
  }

  /** The whole chain to try, in order (failover walks it). */
  chain(at = this.now()): ProviderSpec[] {
    return this.order(at);
  }

  markSuccess(id: string, at = this.now()): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.failures = 0;
    e.cooldownUntil = 0;
    e.backoffUntil = 0;
    e.limitedKind = undefined;
    e.lastUsed = at;
  }

  /** A detected limit: cool the provider for its configured window. */
  markLimited(
    id: string,
    kind: 'quota' | 'rate' | 'error' | string = 'quota',
    resetAt?: number,
    at = this.now(),
  ): number {
    const e = this.entries.get(id);
    if (!e) return 0;
    const until = resetAt && resetAt > at ? resetAt : at + e.spec.cooldownMs;
    e.cooldownUntil = until;
    e.limitedKind = kind;
    e.failures += 1;
    this.opts.log?.('warn', `router: ${id} limited (${kind}) — cooling until ${new Date(until).toISOString()}`);
    return until - at;
  }

  /**
   * A failure that is not a limit: retry with backoff, and after `retries`
   * attempts treat it as a cooldown so the chain moves on.
   */
  markFailure(id: string, at = this.now()): FailureOutcome {
    const e = this.entries.get(id);
    if (!e) return { attempt: 0, retryAfterMs: 0, exhausted: true };
    e.failures += 1;
    const attempt = e.failures;

    const base = 1000;
    const raw = this.opts.backoff === 'linear' ? base * attempt : base * 2 ** (attempt - 1);
    const delay = Math.round(Math.min(e.spec.cooldownMs, raw) * this.jitter());

    if (attempt > this.maxRetries) {
      // Out of retries: cool it like a limit so failover can proceed.
      e.cooldownUntil = at + e.spec.cooldownMs;
      e.limitedKind = 'error';
      this.opts.log?.(
        'warn',
        `router: ${id} failed ${attempt} time(s) — cooling for ${e.spec.cooldownMs} ms and failing over`,
      );
      return { attempt, retryAfterMs: e.spec.cooldownMs, exhausted: true };
    }

    e.backoffUntil = at + delay;
    this.opts.log?.('info', `router: ${id} failed (attempt ${attempt}) — retry in ${delay} ms`);
    return { attempt, retryAfterMs: delay, exhausted: false };
  }

  /**
   * §5.9 pre-warm: providers whose cooldown is at least `prewarmRatio` (80%)
   * through. The caller opens their page early so the switch is instant.
   */
  prewarmCandidates(at = this.now(), ratio = this.opts.prewarmRatio ?? 0.8): ProviderSpec[] {
    const out: ProviderSpec[] = [];
    for (const e of this.entries.values()) {
      if (!e.spec.enabled || e.cooldownUntil === 0) continue;
      const total = e.cooldownUntil - (e.cooldownUntil - e.spec.cooldownMs);
      const elapsed = at - (e.cooldownUntil - e.spec.cooldownMs);
      const progress = total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 1;
      if (progress >= ratio && progress < 1) out.push(e.spec);
    }
    return out;
  }

  status(at = this.now()): ProviderRuntime[] {
    return [...this.entries.values()]
      .sort((a, b) => a.spec.priority - b.spec.priority || a.spec.id.localeCompare(b.spec.id))
      .map((e) => {
        const start = e.cooldownUntil - e.spec.cooldownMs;
        const progress =
          e.cooldownUntil > 0 && e.cooldownUntil > start
            ? Math.max(0, Math.min(1, (at - start) / (e.cooldownUntil - start)))
            : 0;
        return {
          id: e.spec.id,
          label: e.spec.label,
          priority: e.spec.priority,
          state: !e.spec.enabled ? 'disabled' : this.isCooling(e.spec.id, at) ? 'cooling' : 'ready',
          cooldownUntil: e.cooldownUntil,
          failures: e.failures,
          lastUsed: e.lastUsed,
          ...(e.limitedKind ? { limitedKind: e.limitedKind } : {}),
          cooldownProgress: progress,
        };
      });
  }

  /** Reset a cooldown by hand (the Router tab's "cooldowns" control). */
  clearCooldown(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    e.cooldownUntil = 0;
    e.backoffUntil = 0;
    e.failures = 0;
    e.limitedKind = undefined;
    return true;
  }
}
