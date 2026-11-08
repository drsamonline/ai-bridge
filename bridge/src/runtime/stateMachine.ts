/**
 * Session state machine — SPEC v6 §9, as a pure function.
 *
 * No timers, no disk, no bus, no CDP. `transition` takes a state and an event and
 * returns the next state or a rejection. Everything that *causes* an event (a
 * settle timeout, a lease expiry, a user click) lives in session.ts and calls in
 * here, which is what makes the table testable one row at a time.
 *
 * Ambiguities in the spec are resolved here rather than at the call sites,
 * because a call site that resolves them differently is how two implementations
 * of one rule appear. Each is marked DECISION below.
 */

/** Session-level states. Per-participant sub-states are separate (see SubState). */
export type SessionState =
  | 'IDLE'
  | 'INITIALIZING'
  | 'HANDSHAKE_PENDING'
  | 'AWAITING_LOGIN'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'NEEDS_USER'
  | 'STALLED'
  | 'WALL_CLOCK'
  | 'BUDGET_EXHAUSTED'
  | 'CONSENSUS'
  | 'AWAITING_HANDOFF_CONFIRM'
  | 'HANDED_OFF'
  | 'ABORTED';

/**
 * A participant's own state. The session keeps its session state while one of
 * these changes, which is the whole point: a blocked participant must not stop
 * dispatch to the others.
 */
export type SubState =
  | 'HANDSHAKE_PENDING'
  | 'AWAITING_LOGIN'
  | 'BLOCKED'
  | 'DEGRADED'
  | 'REATTACHING';

export type Role = 'planner' | 'auditor' | 'debater';

/** Every reason a session can stop, carried rather than inferred from the state. */
export type HaltReason =
  | 'CONSENSUS'
  | 'NEEDS_USER'
  | 'BUDGET_EXHAUSTED'
  | 'STALLED'
  | 'WALL_CLOCK'
  | 'HANDSHAKE_FAILED'
  | 'AUTH_BLOCKED'
  | 'STORAGE_FULL'
  | 'RAM_INSUFFICIENT'
  | 'PLANNER_DEGRADED'
  | 'AUDITOR_DEGRADED'
  | 'STREAM_TIMEOUT'
  | 'GUARD_TRIPPED'
  | 'HANDED_OFF';

/**
 * The four classes from §16. Kept as data so a caller cannot invent a fifth and
 * so the UI can group them without a second switch.
 */
export const HALT_CLASS: Record<HaltReason, 'terminal' | 'transient' | 'configuration' | 'user-gated'> = {
  CONSENSUS: 'user-gated',
  NEEDS_USER: 'user-gated',
  BUDGET_EXHAUSTED: 'user-gated',
  STALLED: 'user-gated',
  WALL_CLOCK: 'user-gated',
  STREAM_TIMEOUT: 'user-gated',
  GUARD_TRIPPED: 'user-gated',
  HANDSHAKE_FAILED: 'terminal',
  AUTH_BLOCKED: 'terminal',
  STORAGE_FULL: 'terminal',
  RAM_INSUFFICIENT: 'terminal',
  PLANNER_DEGRADED: 'user-gated',
  AUDITOR_DEGRADED: 'user-gated',
  HANDED_OFF: 'terminal',
};

export type HaltClass = 'terminal' | 'transient' | 'configuration' | 'user-gated';

/**
 * §16's other two classes are not halt *reasons*, which is why the reason map
 * above cannot express them. A transient stop is a participant sub-state; a
 * configuration rejection is a refusal at session create that changes no state.
 * Both are named here so `classOf` is total over everything that can stop a
 * session, and so nothing can be filed under the wrong class by omission.
 */
export const CONFIGURATION_REJECTIONS = ['PARTICIPANT_LIMIT', 'VISIBLE_LIMIT', 'PROFILE_CONTENTION'] as const;
export type ConfigurationRejection = (typeof CONFIGURATION_REJECTIONS)[number];

export const TRANSIENT_SUB_STATES: readonly SubState[] = [
  'HANDSHAKE_PENDING',
  'AWAITING_LOGIN',
  'BLOCKED',
  'DEGRADED',
  'REATTACHING',
];

/** The class of anything that can stop or pause a session, in one place. */
export function classOf(thing: HaltReason | SubState | ConfigurationRejection): HaltClass {
  if ((CONFIGURATION_REJECTIONS as readonly string[]).includes(thing)) return 'configuration';
  if ((TRANSIENT_SUB_STATES as readonly string[]).includes(thing)) return 'transient';
  return HALT_CLASS[thing as HaltReason];
}

const TERMINAL: readonly SessionState[] = ['HANDED_OFF', 'ABORTED'];

export const isTerminal = (s: SessionState): boolean => TERMINAL.includes(s);

/** States where the clock is the user's, not ours (§9 per-state timeouts). */
export const isUserGated = (s: SessionState): boolean =>
  s === 'NEEDS_USER' ||
  s === 'STALLED' ||
  s === 'WALL_CLOCK' ||
  s === 'BUDGET_EXHAUSTED' ||
  s === 'CONSENSUS' ||
  s === 'AWAITING_HANDOFF_CONFIRM';

/**
 * The roles the session cannot run without. Both are `required` in §4, and both
 * are load-bearing: the planner is the only writer of the plan artifact, and the
 * auditor is the only participant that may raise an objection (§15). Losing
 * either leaves a session that can reach CONSENSUS over an artifact nobody
 * wrote or nobody checked.
 */
export const isRequiredRole = (role: Role): boolean => role === 'planner' || role === 'auditor';

export type SessionEvent =
  | { type: 'session.create' }
  | { type: 'preamble.sent'; participant: number }
  | { type: 'login.required'; participant: number }
  | { type: 'ram.exceeded' }
  | { type: 'handshake.ready' }
  | { type: 'handshake.failed'; participant: number; role: Role }
  | { type: 'login.succeeded'; participant: number }
  | { type: 'login.ceiling'; participant: number; role: Role }
  | { type: 'storage.failed'; path: string }
  | { type: 'round.reservation' }
  | { type: 'round.exhausted' }
  | { type: 'consensus.unanimous' }
  | { type: 'consensus.unilateral'; participant: number }
  | { type: 'ask.user'; participant: number }
  | { type: 'stall.detected'; participant: number }
  | { type: 'wallclock.exhausted' }
  | { type: 'tab.lost'; participant: number }
  | { type: 'participant.degraded'; participant: number; role: Role; reason: string }
  | { type: 'settle.timeout'; participant: number; role: Role }
  | { type: 'escalate'; participant: number; accepted: boolean }
  | { type: 'user.resume' }
  | { type: 'user.decline.consensus' }
  | { type: 'user.confirm.consensus' }
  | { type: 'user.force.round' }
  | { type: 'user.freeze' }
  | { type: 'user.abort' }
  | { type: 'user.confirm.bundle' }
  | { type: 'handoff.confirmed' }
  | { type: 'handoff.expired' }
  | { type: 'participant.restored'; participant: number }
  | { type: 'block.timeout'; participant: number }
  | { type: 'reattach.passed'; participant: number }
  | { type: 'reattach.failed'; participant: number }
  | { type: 'session.selected' }
  /**
   * A loop guard fired — the runner's turn ceiling. Without it an exhausted
   * guard left the session in ACTIVE, which is a live session that is not
   * running: the worst of both.
   */
  | { type: 'guard.tripped'; reason: string };

export type SessionEventType = SessionEvent['type'];

export type TransitionResult =
  | {
      ok: true;
      state: SessionState;
      /** Set when the transition stops the session or moves it to a user gate. */
      reason?: HaltReason;
      /** Budget deltas, applied by the scheduler, never by this function. */
      budgetDelta?: number;
      escalateDelta?: number;
      /** Which participant the event applies to, when it is per-participant. */
      participant?: number;
      /** Free text for the audit trail. */
      note?: string;
    }
  | { ok: false; rejected: string };

const ok = (
  state: SessionState,
  extra: Omit<Extract<TransitionResult, { ok: true }>, 'ok' | 'state'> = {},
): TransitionResult => ({ ok: true, state, ...extra });

const no = (why: string): TransitionResult => ({ ok: false, rejected: why });

/**
 * A required participant dropping out is not a per-participant degrade: it is the
 * session asking the user what to do. §8 says this for the planner only; the
 * auditor is the same problem for the same reason, so it is the same outcome.
 */
function requiredRoleLost(role: Role, participant: number): TransitionResult {
  return ok('NEEDS_USER', {
    reason: role === 'planner' ? 'PLANNER_DEGRADED' : 'AUDITOR_DEGRADED',
    participant,
    note: `required participant ${participant} (${role}) is no longer dispatchable`,
  });
}

/**
 * The transition table.
 *
 * Total by construction: every (state, event) pair either returns a transition or
 * an explicit rejection. Nothing falls through to "stay where you are", because a
 * silent no-op is how a session hangs without anyone noticing.
 */
export function transition(state: SessionState, event: SessionEvent): TransitionResult {
  // A terminal session accepts nothing. Checked first so the per-state cases
  // below never have to repeat it.
  if (isTerminal(state)) {
    return no(`${state} is terminal; ${event.type} cannot apply`);
  }

  // A storage failure aborts from any live state (§9). One place, not fourteen.
  if (event.type === 'storage.failed') {
    return ok('ABORTED', { reason: 'STORAGE_FULL', note: `storage write failed: ${event.path}` });
  }

  // So does a user abort.
  if (event.type === 'user.abort') {
    return ok('ABORTED', { reason: undefined, note: 'user aborted' });
  }

  switch (event.type) {
    case 'session.create':
      return state === 'IDLE' ? ok('INITIALIZING') : no(`session.create is only valid from IDLE, not ${state}`);

    case 'preamble.sent':
      return state === 'INITIALIZING' || state === 'HANDSHAKE_PENDING'
        ? ok('HANDSHAKE_PENDING', { participant: event.participant })
        : no(`preamble.sent is only valid while initialising, not ${state}`);

    case 'login.required':
      return state === 'INITIALIZING' || state === 'HANDSHAKE_PENDING'
        ? ok('AWAITING_LOGIN', { participant: event.participant })
        : no(`login.required is only valid while initialising, not ${state}`);

    case 'ram.exceeded':
      // Pre-flight only: §18 requires this to be decided before any tab opens.
      return state === 'INITIALIZING'
        ? ok('ABORTED', { reason: 'RAM_INSUFFICIENT', note: 'lease projection exceeds the RAM cap' })
        : no(`ram.exceeded is a session-create rejection, not a ${state} transition`);

    case 'handshake.ready':
      return state === 'HANDSHAKE_PENDING' || state === 'AWAITING_LOGIN'
        ? ok('ACTIVE')
        : no(`handshake.ready is only valid during handshake, not ${state}`);

    case 'handshake.failed':
      if (state !== 'HANDSHAKE_PENDING' && state !== 'AWAITING_LOGIN') {
        return no(`handshake.failed is only valid during handshake, not ${state}`);
      }
      // DECISION: §9 only aborts when *every* participant fails. That leaves a
      // session handshaking forever when the planner is the one that failed, so a
      // required role failing is treated as the required-role loss it is.
      return isRequiredRole(event.role)
        ? requiredRoleLost(event.role, event.participant)
        : ok(state, { participant: event.participant, note: 'participant degraded during handshake' });

    case 'login.succeeded':
      return state === 'AWAITING_LOGIN'
        ? ok('HANDSHAKE_PENDING', { participant: event.participant })
        : no(`login.succeeded is only valid in AWAITING_LOGIN, not ${state}`);

    case 'login.ceiling':
      if (state !== 'AWAITING_LOGIN') {
        return no(`login.ceiling is only valid in AWAITING_LOGIN, not ${state}`);
      }
      // DECISION: §9 has both "degrade (i)" and "abort if planner or auditor" for
      // the same event. The abort wins for a required role, and no DEGRADED
      // sub-state is written, so the two rows cannot both fire.
      return isRequiredRole(event.role)
        ? ok('ABORTED', { reason: 'AUTH_BLOCKED', participant: event.participant, note: `${event.role} never signed in` })
        : ok(state, { participant: event.participant, note: 'participant degraded at the login ceiling' });

    case 'round.reservation':
      // The reserved planner turn runs inside ACTIVE; the halt comes after it.
      return state === 'ACTIVE' ? ok('ACTIVE', { note: 'forced planner turn' }) : no(`round.reservation is only valid in ACTIVE, not ${state}`);

    case 'round.exhausted':
      return state === 'ACTIVE' ? ok('BUDGET_EXHAUSTED', { reason: 'BUDGET_EXHAUSTED' }) : no(`round.exhausted is only valid in ACTIVE, not ${state}`);

    case 'consensus.unanimous':
      return state === 'ACTIVE' ? ok('CONSENSUS', { reason: 'CONSENSUS' }) : no(`consensus.unanimous is only valid in ACTIVE, not ${state}`);

    case 'consensus.unilateral':
      // One participant claiming consensus is a question for the user, never a stop.
      return state === 'ACTIVE'
        ? ok('NEEDS_USER', { reason: 'NEEDS_USER', participant: event.participant, note: 'unilateral consensus claim' })
        : no(`consensus.unilateral is only valid in ACTIVE, not ${state}`);

    case 'ask.user':
      return state === 'ACTIVE' ? ok('NEEDS_USER', { reason: 'NEEDS_USER', participant: event.participant }) : no(`ask.user is only valid in ACTIVE, not ${state}`);

    case 'stall.detected':
      return state === 'ACTIVE' ? ok('STALLED', { reason: 'STALLED', participant: event.participant }) : no(`stall.detected is only valid in ACTIVE, not ${state}`);

    case 'wallclock.exhausted':
      return state === 'ACTIVE' ? ok('WALL_CLOCK', { reason: 'WALL_CLOCK' }) : no(`wallclock.exhausted is only valid in ACTIVE, not ${state}`);

    case 'tab.lost':
      // Sub-state only: the session stays ACTIVE so the other participants run.
      return state === 'ACTIVE' ? ok('ACTIVE', { participant: event.participant, note: 'participant BLOCKED' }) : no(`tab.lost is only valid in ACTIVE, not ${state}`);

    case 'participant.degraded':
      if (state !== 'ACTIVE') return no(`participant.degraded is only valid in ACTIVE, not ${state}`);
      return isRequiredRole(event.role)
        ? requiredRoleLost(event.role, event.participant)
        : ok('ACTIVE', { participant: event.participant, note: `participant DEGRADED: ${event.reason}` });

    case 'settle.timeout':
      if (state !== 'ACTIVE') return no(`settle.timeout is only valid in ACTIVE, not ${state}`);
      // DECISION: §9 degrades the participant and §16 files STREAM_TIMEOUT as a
      // user-gated halt. Both are true only when a required role times out; a
      // debater timing out is a per-participant degrade and the round continues.
      return isRequiredRole(event.role)
        ? ok('NEEDS_USER', { reason: 'STREAM_TIMEOUT', participant: event.participant })
        : ok('ACTIVE', { participant: event.participant, note: 'participant DEGRADED: STREAM_TIMEOUT' });

    case 'escalate':
      // Cap enforcement (3 per session) is the scheduler's, because it owns the
      // counter. This only says which direction the budget moves.
      return state === 'ACTIVE'
        ? ok('ACTIVE', event.accepted
            ? { budgetDelta: 1, participant: event.participant, note: 'escalation accepted' }
            : { escalateDelta: 1, participant: event.participant, note: 'escalation rejected' })
        : no(`escalate is only valid in ACTIVE, not ${state}`);

    case 'user.resume':
      return state === 'NEEDS_USER' || state === 'STALLED' ? ok('ACTIVE') : no(`user.resume is only valid from NEEDS_USER or STALLED, not ${state}`);

    case 'user.decline.consensus':
      return state === 'NEEDS_USER' || state === 'WALL_CLOCK'
        ? ok('ACTIVE', { note: 'consensus declined; expected_next_speaker unchanged' })
        : no(`user.decline.consensus is only valid from NEEDS_USER or WALL_CLOCK, not ${state}`);

    case 'user.confirm.consensus':
      return state === 'NEEDS_USER' || state === 'BUDGET_EXHAUSTED'
        ? ok('CONSENSUS', { reason: 'CONSENSUS', note: 'user confirmed' })
        : no(`user.confirm.consensus is only valid from NEEDS_USER or BUDGET_EXHAUSTED, not ${state}`);

    case 'user.force.round':
      return state === 'STALLED' || state === 'WALL_CLOCK' || state === 'BUDGET_EXHAUSTED'
        ? ok('ACTIVE', { budgetDelta: 1, note: 'user forced a round' })
        : no(`user.force.round is only valid from STALLED, WALL_CLOCK or BUDGET_EXHAUSTED, not ${state}`);

    case 'user.freeze':
      return state === 'WALL_CLOCK' ? ok('CONSENSUS', { reason: 'CONSENSUS', note: 'user froze the plan at the wall clock' }) : no(`user.freeze is only valid from WALL_CLOCK, not ${state}`);

    case 'user.confirm.bundle':
      return state === 'CONSENSUS' ? ok('AWAITING_HANDOFF_CONFIRM') : no(`user.confirm.bundle is only valid from CONSENSUS, not ${state}`);

    case 'handoff.confirmed':
      return state === 'AWAITING_HANDOFF_CONFIRM' ? ok('HANDED_OFF', { reason: 'HANDED_OFF', note: 'user confirmed the build in Sarvam' }) : no(`handoff.confirmed is only valid from AWAITING_HANDOFF_CONFIRM, not ${state}`);

    case 'handoff.expired':
      return state === 'AWAITING_HANDOFF_CONFIRM' ? ok('HANDED_OFF', { reason: 'HANDED_OFF', note: '7 days elapsed without confirmation' }) : no(`handoff.expired is only valid from AWAITING_HANDOFF_CONFIRM, not ${state}`);

    case 'participant.restored':
      return state === 'ACTIVE' ? ok('ACTIVE', { participant: event.participant, note: 'participant REATTACHING' }) : no(`participant.restored is only valid in ACTIVE, not ${state}`);

    case 'block.timeout':
      return state === 'ACTIVE' ? ok('ACTIVE', { participant: event.participant, note: 'participant DEGRADED: block timeout' }) : no(`block.timeout is only valid in ACTIVE, not ${state}`);

    case 'reattach.passed':
    case 'reattach.failed':
      return state === 'ACTIVE' ? ok('ACTIVE', { participant: event.participant }) : no(`${event.type} is only valid in ACTIVE, not ${state}`);

    case 'guard.tripped':
      return state === 'ACTIVE'
        ? ok('NEEDS_USER', { reason: 'GUARD_TRIPPED', note: event.reason })
        : no(`guard.tripped is only valid in ACTIVE, not ${state}`);

    case 'session.selected':
      // DECISION: the spec says "SUSPENDED → REATTACHING per participant", but
      // REATTACHING is a sub-state. The session returns to ACTIVE and every
      // participant starts in REATTACHING, so completion and quorum skip them
      // until each passes.
      return state === 'SUSPENDED'
        ? ok('ACTIVE', { note: 'all participants REATTACHING' })
        : no(`session.selected is only valid from SUSPENDED, not ${state}`);
  }

  // Unreachable while the union is exhaustive; TypeScript proves the switch above
  // covers every member, and this line is what makes that proof load-bearing.
  const unreachable: never = event;
  return no(`unhandled event ${JSON.stringify(unreachable)}`);
}

/* ------------------------------------------------------------------ *
 * Participant sub-states
 * ------------------------------------------------------------------ */

export type SubStateEvent =
  | { type: 'preamble.sent' }
  | { type: 'ready' }
  | { type: 'login.required' }
  | { type: 'login.succeeded' }
  | { type: 'tab.lost' }
  | { type: 'restored' }
  | { type: 'reattach.passed' }
  | { type: 'reattach.failed' }
  | { type: 'degrade'; reason: string }
  | { type: 'block.timeout' };

/**
 * A participant's own lifecycle. Kept separate from the session table because the
 * two change independently: a tab can vanish and come back while the session sits
 * in ACTIVE the whole time.
 */
export function participantTransition(
  sub: SubState | 'ACTIVE',
  event: SubStateEvent,
): { ok: true; sub: SubState | 'ACTIVE' } | { ok: false; rejected: string } {
  switch (event.type) {
    case 'preamble.sent':
      return sub === 'ACTIVE' ? { ok: true, sub: 'HANDSHAKE_PENDING' } : { ok: false, rejected: `preamble.sent from ${sub}` };
    case 'ready':
      return sub === 'HANDSHAKE_PENDING' || sub === 'REATTACHING'
        ? { ok: true, sub: 'ACTIVE' }
        : { ok: false, rejected: `[[READY]] from ${sub}` };
    case 'login.required':
      return sub === 'HANDSHAKE_PENDING' ? { ok: true, sub: 'AWAITING_LOGIN' } : { ok: false, rejected: `login.required from ${sub}` };
    case 'login.succeeded':
      return sub === 'AWAITING_LOGIN' ? { ok: true, sub: 'HANDSHAKE_PENDING' } : { ok: false, rejected: `login.succeeded from ${sub}` };
    case 'tab.lost':
      return sub === 'ACTIVE' ? { ok: true, sub: 'BLOCKED' } : { ok: false, rejected: `tab.lost from ${sub}` };
    case 'restored':
      return sub === 'BLOCKED' ? { ok: true, sub: 'REATTACHING' } : { ok: false, rejected: `restored from ${sub}` };
    case 'reattach.passed':
      return sub === 'REATTACHING' ? { ok: true, sub: 'ACTIVE' } : { ok: false, rejected: `reattach.passed from ${sub}` };
    case 'reattach.failed':
      return sub === 'REATTACHING' ? { ok: true, sub: 'DEGRADED' } : { ok: false, rejected: `reattach.failed from ${sub}` };
    case 'block.timeout':
      return sub === 'BLOCKED' ? { ok: true, sub: 'DEGRADED' } : { ok: false, rejected: `block.timeout from ${sub}` };
    case 'degrade':
      return sub === 'DEGRADED' ? { ok: false, rejected: 'already DEGRADED' } : { ok: true, sub: 'DEGRADED' };
  }
  const unreachable: never = event;
  return { ok: false, rejected: `unhandled ${JSON.stringify(unreachable)}` };
}

/** Every session state, for the totality test. */
export const ALL_STATES: readonly SessionState[] = [
  'IDLE', 'INITIALIZING', 'HANDSHAKE_PENDING', 'AWAITING_LOGIN', 'ACTIVE',
  'SUSPENDED', 'NEEDS_USER', 'STALLED', 'WALL_CLOCK', 'BUDGET_EXHAUSTED',
  'CONSENSUS', 'AWAITING_HANDOFF_CONFIRM', 'HANDED_OFF', 'ABORTED',
];

/**
 * The consensus floor. §8 says quorum is "active participants only"; a roster
 * reduced to one active participant would otherwise reach "unanimous" consensus
 * on a single vote, which is the failure the rule exists to prevent.
 */
export const MIN_QUORUM = 2;

export function quorumReached(active: number, agreed: number): boolean {
  return active >= MIN_QUORUM && agreed >= active;
}
