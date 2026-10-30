/**
 * Locked decisions — §5.8's guard, §2.3's "locked edit held + banner + approval
 * flow".
 *
 * Batch 1.2 shipped the guard against an interim `workspaceState` store. From
 * 2.3 the source of truth is `ProjectState.decisions`, which is what §4's
 * contract names and what the boot prompt carries. The interim store is migrated
 * once and then left empty; nothing is silently dropped.
 */

import type { ProjectState } from '@ai-bridge/shared';
import type { LockedDecisionLite } from '../repo/applier';

export interface MigrationResult {
  migrated: number;
  kept: number;
  /** True when the memento had entries and the state had none. */
  ran: boolean;
}

/** Copy legacy decisions into the state exactly once, then clear the store. */
export async function migrateDecisions(
  legacy: LockedDecisionLite[],
  state: ProjectState,
  clearLegacy: () => Promise<void>,
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void,
): Promise<MigrationResult> {
  if (legacy.length === 0) return { migrated: 0, kept: state.decisions.length, ran: false };

  let migrated = 0;
  for (const d of legacy) {
    const exists = state.decisions.some((x) => x.id === d.id || x.what === d.what);
    if (exists) continue;
    state.decisions.push({
      id: d.id || `d${Date.now().toString(36)}`,
      what: d.what,
      why: d.why ?? 'locked before 2.3',
      locked: true,
    });
    migrated += 1;
  }
  await clearLegacy();
  log?.(
    'info',
    migrated > 0
      ? `migrated ${migrated} locked decision(s) from the interim store into the project state`
      : 'interim decision store was already represented in the state',
  );
  return { migrated, kept: state.decisions.length, ran: true };
}

/** The guard's source of truth: §4 decisions, verbatim. */
export function decisionsFromState(state: ProjectState): LockedDecisionLite[] {
  return state.decisions.map((d) => ({
    id: d.id,
    what: d.what,
    why: d.why,
    locked: true,
    // §4 has no `paths` field; a decision applies to every file unless the user
    // scopes it by putting the path in `why` as `path:<glob>`.
    ...(pathScope(d.why) ? { paths: pathScope(d.why)! } : {}),
  }));
}

/** `why` may carry `path:src/a.ts,src/b.ts` to scope a decision. */
export function pathScope(why: string): string[] | null {
  const m = why.match(/path:([^\s]+(?:,[^\s]+)*)/);
  if (!m) return null;
  return m[1]!.split(',').map((p) => p.trim()).filter(Boolean);
}

export function lockDecision(
  state: ProjectState,
  what: string,
  why: string,
  paths: string[] = [],
): ProjectState['decisions'][number] {
  const scope = paths.length ? `path:${paths.join(',')}` : '';
  const decision = {
    id: `d${Date.now().toString(36)}`,
    what: what.trim(),
    why: [why.trim(), scope].filter(Boolean).join(' '),
    locked: true as const,
  };
  state.decisions.push(decision);
  return decision;
}

export function unlockDecision(state: ProjectState, id: string): boolean {
  const before = state.decisions.length;
  state.decisions = state.decisions.filter((d) => d.id !== id);
  return state.decisions.length !== before;
}

/**
 * Record that a held edit was approved over a locked decision. The decision stays
 * locked; the override is an auditable event, not a quiet unlock.
 */
export function recordOverride(
  state: ProjectState,
  decision: { id: string; what: string },
  files: string[],
  by = 'user',
): void {
  state.deltas.push({
    t: Date.now(),
    op: 'decide',
    summary: `override approved by ${by}: locked decision "${decision.what}" [${decision.id}] touched in ${files.join(', ')}`,
  });
  if (state.deltas.length > 200) state.deltas.splice(0, state.deltas.length - 200);
  state.meta.updatedAt = Date.now();
}
