/**
 * The sign-in wait — SPEC v6 §9's AWAITING_LOGIN, as timing rather than I/O.
 *
 * Chrome 136 made this load-bearing: a debugging profile starts signed out, so a
 * participant can be sitting on a login page on its first turn. The spec's shape is
 * a 3s→15s backoff with a five-minute ceiling, and everything about that is a
 * schedule — which is why it lives here, pure, and the polling lives in the caller.
 *
 * The ceiling is a judgement, not a law: five minutes is long enough to type a
 * password and short enough that a forgotten window does not hold a session open
 * all afternoon.
 */

export const FIRST_DELAY_MS = 3_000;
export const MAX_DELAY_MS = 15_000;
export const CEILING_MS = 5 * 60 * 1000;

export interface LoginWaitOptions {
  firstDelayMs?: number;
  maxDelayMs?: number;
  ceilingMs?: number;
  now?: () => number;
}

/**
 * Backoff state. `nextDelayMs()` is the wait *before* the next check, so a caller
 * loops: sleep, check, sleep, check — and stops when `expired()` says so.
 */
export class LoginWait {
  private readonly startedAt: number;
  private delay: number;
  private readonly firstDelay: number;
  private readonly maxDelay: number;
  private readonly ceiling: number;
  private readonly now: () => number;

  constructor(opts: LoginWaitOptions = {}) {
    this.firstDelay = opts.firstDelayMs ?? FIRST_DELAY_MS;
    this.maxDelay = opts.maxDelayMs ?? MAX_DELAY_MS;
    this.ceiling = opts.ceilingMs ?? CEILING_MS;
    this.now = opts.now ?? (() => Date.now());
    this.delay = this.firstDelay;
    this.startedAt = this.now();
  }

  /** The delay to wait before the next readiness check, then grow it. */
  nextDelayMs(): number {
    const current = this.delay;
    // ×1.5 to the cap: 3s, 4.5s, 6.75s, 10.1s, 15s, 15s…
    this.delay = Math.min(this.maxDelay, Math.round(this.delay * 1.5));
    return current;
  }

  expired(): boolean {
    return this.now() - this.startedAt >= this.ceiling;
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  ceilingMs(): number {
    return this.ceiling;
  }
}
