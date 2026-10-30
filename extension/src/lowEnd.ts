/**
 * Low-end mode — spec §2 ("target 8 GB laptop") and §7.1
 * ("auto-off T1, short boot, fewer files").
 *
 * One resolver, one table of effective settings. Low-end mode is not a flag that
 * gets stored and forgotten: every consumer asks `effective()` for its budget, so
 * turning it on actually shrinks the boot, trims the repo context and closes T1.
 *
 * `auto` treats an 8 GB machine as low-end — the spec's target hardware is the
 * machine where these savings matter most, and 8 GB is where a 500 MB browser cap
 * plus a 1 GB extension cap starts to bite.
 */

export type LowEndMode = 'auto' | 'on' | 'off';

export interface LowEndDecision {
  active: boolean;
  reason: string;
  totalMemBytes: number;
}

export const LOW_END_RAM_BYTES = 8 * 1024 ** 3;

export interface EffectiveSettings {
  /** Boot prompt budget in tokens (§5.5's ≤4k, halved on low-end). */
  bootBudgetTokens: number;
  /** Files the repo reader may include in one bundle. */
  repoMaxFiles: number;
  /** Repo context budget in tokens. */
  repoBudgetTokens: number;
  /** Whether the T1 compressor may run at all. */
  t1Allowed: boolean;
  /** Watchdog poll interval — deliberately NOT reduced (see note). */
  watchdogPollMs: number;
  /** Snapshot interval in turns. */
  snapshotEvery: number;
}

export const NORMAL_SETTINGS: EffectiveSettings = {
  bootBudgetTokens: 4000,
  repoMaxFiles: 12,
  repoBudgetTokens: 3000,
  t1Allowed: true,
  watchdogPollMs: 3000,
  snapshotEvery: 10,
};

export const LOW_END_SETTINGS: EffectiveSettings = {
  bootBudgetTokens: 2000,
  repoMaxFiles: 4,
  repoBudgetTokens: 1200,
  t1Allowed: false,
  // §5.11 pins the poll at 3 s and §7.1's acceptance checks it on an 8 GB laptop.
  // Cutting it would trade the RAM guard for the RAM it guards.
  watchdogPollMs: 3000,
  snapshotEvery: 15,
};

export function resolveLowEnd(
  totalMemBytes: number,
  mode: LowEndMode = 'auto',
  thresholdBytes = LOW_END_RAM_BYTES,
): LowEndDecision {
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (mode === 'off') {
    return { active: false, reason: 'low-end mode disabled by setting', totalMemBytes };
  }
  if (mode === 'on') {
    return { active: true, reason: 'low-end mode forced on by the user', totalMemBytes };
  }
  if (totalMemBytes <= thresholdBytes) {
    return {
      active: true,
      reason: `${gb(totalMemBytes)} ≤ ${gb(thresholdBytes)} — low-end mode on (T1 off, short boot, fewer files)`,
      totalMemBytes,
    };
  }
  return {
    active: false,
    reason: `${gb(totalMemBytes)} > ${gb(thresholdBytes)} — full settings`,
    totalMemBytes,
  };
}

/** The settings a consumer should actually use, given the decision. */
export function effective(decision: LowEndDecision): EffectiveSettings {
  return decision.active ? { ...LOW_END_SETTINGS } : { ...NORMAL_SETTINGS };
}
