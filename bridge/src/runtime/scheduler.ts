/**
 * Turn scheduler — SPEC v6 §8, plus the participant-boundary failover policy in §6.
 *
 * Pure: no CDP, no timers, no disk, no relay. It answers three questions and
 * nothing else — who speaks next, whether the round is over, and whether the
 * budget allows another turn. The relay does the talking; the state machine does
 * the stopping; this decides the order.
 *
 * The one rule that matters more than the rest: *every* path into degradation,
 * blocking or restoration re-evaluates completion through `evaluateCompletion()`.
 * The v5 review's central hang was a last speaker that degraded mid-turn — the
 * completion check had already run and nothing fired again, so the round never
 * ended and the session sat in ACTIVE forever. There is exactly one place that
 * decides a round is over, and it is called from all of them.
 */

import { MIN_QUORUM, quorumReached, type Role } from './stateMachine';

export type ParticipantId = number;

export interface SchedulerParticipant {
  index: ParticipantId;
  role: Role;
  /**
   * The declared provider set, primary first (§6). Failover never leaves this
   * set: a participant that was Claude must not answer as GPT, because the roster
   * invariant and the [round n | role] provenance in every context block both
   * depend on it.
   */
  providers: string[];
}

/** A participant's dispatchability. Mirrors SubState, minus the session concerns. */
export type ParticipantStatus = 'active' | 'blocked' | 'degraded' | 'reattaching';

export type TurnToken = 'REPLY' | 'ASK_USER' | 'ESCALATE' | 'OBJECTION' | 'CONSENSUS';

/**
 * Where the budget is. `reservation` is the single forced planner turn §8 buys
 * before the halt, so the artifact shipped cannot predate the last debater.
 */
export type BudgetPhase = 'running' | 'reservation' | 'exhausted';

export interface SchedulerConfig {
  participants: SchedulerParticipant[];
  roundBudget?: number;
  /** Both accepted and rejected escalations count against this (§5). */
  escalateCap?: number;
}

export const DEFAULT_ROUND_BUDGET = 7;
export const DEFAULT_ESCALATE_CAP = 3;

export interface TurnRecord {
  round: number;
  participant: ParticipantId;
  token: TurnToken;
}

export interface SchedulerSnapshot {
  round: number;
  budget: number;
  phase: BudgetPhase;
  escalates: number;
  escalateCap: number;
  reservationUsed: boolean;
  expected: ParticipantId | null;
  statuses: Record<ParticipantId, ParticipantStatus>;
  /** Who has spoken this round, in order. */
  spoken: ParticipantId[];
  /** Who has emitted [[CONSENSUS]] this round. */
  consensus: ParticipantId[];
  activeCount: number;
  history: TurnRecord[];
}

const DEFAULT_STATUS: ParticipantStatus = 'active';

/**
 * How independent a consensus actually is (D11).
 *
 * Same-model agents do not give independent opinions — measured error correlation
 * between homogeneous agents runs 0.86 to 0.93 — so agreement from one provider is one
 * opinion sampled several times. This reports that rather than preventing it: a user
 * with one account cannot do better, and blocking them would make consensus
 * unreachable.
 *
 * The nominal provider is the participant's first, because that is the one it is
 * expected to use. A fallback hop means the report is approximate, which is why it is
 * a report and not a gate.
 */
export function consensusCorrelation(
  consensus: readonly ParticipantId[],
  participants: readonly { index: number; providers: readonly string[] }[],
): { providers: string[]; correlated: boolean } {
  const providers = new Set<string>();
  for (const id of consensus) {
    const participant = participants.find((p) => p.index === id);
    for (const provider of participant?.providers ?? []) providers.add(provider);
  }
  return {
    providers: [...providers],
    correlated: consensus.length >= 2 && providers.size === 1,
  };
}

export class Scheduler {
  private readonly participants: SchedulerParticipant[];
  private readonly escalateCap: number;

  private round = 1;
  private budget: number;
  private phase: BudgetPhase = 'running';
  private escalates = 0;
  private reservationUsed = false;

  private readonly statuses = new Map<ParticipantId, ParticipantStatus>();
  private readonly spoken: ParticipantId[] = [];
  private readonly consensus: ParticipantId[] = [];
  private readonly history: TurnRecord[] = [];

  constructor(cfg: SchedulerConfig) {
    if (!cfg.participants || cfg.participants.length === 0) {
      throw new Error('ESCHED: a scheduler needs at least one participant');
    }
    // Roster order is the speaking order, so sort rather than trusting the caller.
    this.participants = [...cfg.participants].sort((a, b) => a.index - b.index);
    this.budget = cfg.roundBudget ?? DEFAULT_ROUND_BUDGET;
    this.escalateCap = cfg.escalateCap ?? DEFAULT_ESCALATE_CAP;
    for (const p of this.participants) this.statuses.set(p.index, DEFAULT_STATUS);
  }

  /* ---------------------------------------------------------------- roster */

  private status(p: ParticipantId): ParticipantStatus {
    return this.statuses.get(p) ?? 'degraded';
  }

  /** Active, in roster order. This is the set completion and quorum both use. */
  active(): ParticipantId[] {
    return this.participants.filter((p) => this.status(p.index) === 'active').map((p) => p.index);
  }

  /** Active participants that have not yet spoken this round. */
  private yetToSpeak(): ParticipantId[] {
    return this.active().filter((p) => !this.spoken.includes(p));
  }

  /* ------------------------------------------------------------ turn order */

  /**
   * Who speaks next, or null when nobody can. Round-robin in roster order,
   * skipping anyone not dispatchable — the skip is why a blocked participant does
   * not stall the other four.
   */
  nextSpeaker(): ParticipantId | null {
    if (this.phase === 'exhausted') return null;

    if (this.phase === 'reservation') {
      const planner = this.participants.find((p) => p.role === 'planner');
      if (!planner) return null;
      // Exactly one reserved turn. If the planner has already taken it the budget
      // is spent — returning the planner again here is an infinite loop.
      if (this.spoken.includes(planner.index)) return null;
      // A degraded planner is not dispatchable even for the reservation; the
      // caller turns that into PLANNER_DEGRADED rather than looping.
      return this.status(planner.index) === 'active' ? planner.index : null;
    }

    const pending = this.yetToSpeak();
    return pending.length > 0 ? pending[0] ?? null : null;

    // Everyone active has spoken: the round is complete but nobody has called
    // completeTurn for the last one yet. Let the caller finish that turn.
    return null;
  }

  /**
   * Record a completed turn and re-evaluate the round.
   *
   * Returns what the caller should do about the budget, so the facade can raise
   * the matching state-machine event without re-deriving it.
   */
  completeTurn(
    participant: ParticipantId,
    token: TurnToken,
  ): { roundCompleted: boolean; phase: BudgetPhase } {
    // A new round starts clean. Doing it here rather than at completion is what
    // lets the caller read the previous round's consensus before it disappears.
    if (this.spoken.length === 0) this.consensus.length = 0;

    if (this.status(participant) === 'active' && !this.spoken.includes(participant)) {
      this.spoken.push(participant);
    }
    if (token === 'CONSENSUS' && !this.consensus.includes(participant)) {
      this.consensus.push(participant);
    }
    // The reservation is a single planner turn, not a whole round: as soon as the
    // planner has spoken under it, the budget is exhausted.
    if (this.phase === 'reservation' && this.participants.find((p) => p.index === participant)?.role === 'planner') {
      this.phase = 'exhausted';
    }
    this.history.push({ round: this.round, participant, token });

    const roundCompleted = this.evaluateCompletion();
    return { roundCompleted, phase: this.phase };
  }

  /**
   * The single decision point. Called after a turn, after a degrade, after a
   * block, after a restoration, and after a block timeout.
   */
  private evaluateCompletion(): boolean {
    const active = this.active();

    // Nobody left to speak for: that is not a completed round, it is a session
    // with no quorum, and the state machine halts it via the degrade events.
    if (active.length === 0) return false;

    const allSpoken = active.every((p) => this.spoken.includes(p));
    if (!allSpoken) return false;

    // The round is over. Clear who has spoken so the next round can complete, but
    // NOT the consensus tally: the caller evaluates consensus *after* the last
    // turn, and wiping it here made the result unreadable at exactly the moment it
    // mattered. It is cleared instead when the next round's first turn is
    // recorded — see completeTurn.
    this.spoken.length = 0;

    if (this.phase === 'reservation') {
      // The forced planner turn has now run. That is the end of the line.
      this.phase = 'exhausted';
      return true;
    }

    if (this.round >= this.budget) {
      if (!this.reservationUsed) {
        this.reservationUsed = true;
        this.phase = 'reservation';
        return true;
      }
      this.phase = 'exhausted';
      return true;
    }

    this.round += 1;
    return true;
  }

  /* ------------------------------------------------------------- lifecycle */

  /**
   * A participant is no longer dispatchable. Excluded from completion and quorum
   * from here on, and the round is re-evaluated immediately: if this was the last
   * speaker, the round is complete *now*.
   */
  degrade(participant: ParticipantId, _reason: string): { roundCompleted: boolean } {
    this.statuses.set(participant, 'degraded');
    return { roundCompleted: this.evaluateCompletion() };
  }

  block(participant: ParticipantId): { roundCompleted: boolean } {
    this.statuses.set(participant, 'blocked');
    return { roundCompleted: this.evaluateCompletion() };
  }

  /** Restored after a lost tab. Not yet dispatchable — it must reattach first. */
  restore(participant: ParticipantId): void {
    if (this.status(participant) === 'blocked') this.statuses.set(participant, 'reattaching');
  }

  /** Passed the restatement check; back in the rotation. */
  reattached(participant: ParticipantId): { roundCompleted: boolean } {
    if (this.status(participant) !== 'blocked' && this.status(participant) !== 'reattaching') {
      return { roundCompleted: false };
    }
    this.statuses.set(participant, 'active');
    return { roundCompleted: this.evaluateCompletion() };
  }

  /* ---------------------------------------------------------------- budget */

  /**
   * §5: an accepted escalation buys one round; both outcomes count against the
   * cap of three per session. Acceptance is a syntactic test on the caller's
   * side — "non-empty after the colon" — not a judgement made here.
   */
  escalate(accepted: boolean): { applied: boolean; escalates: number } {
    if (this.escalates >= this.escalateCap) {
      return { applied: false, escalates: this.escalates };
    }
    this.escalates += 1;
    if (accepted) this.budget += 1;
    return { applied: true, escalates: this.escalates };
  }

  /** User force-round: unbounded, and it does not consume the escalation cap. */
  forceRound(): void {
    this.budget += 1;
    // A forced round from an exhausted budget puts the session back to work.
    if (this.phase === 'exhausted') {
      this.phase = 'running';
      this.round = Math.max(this.round, this.budget);
    }
  }

  budgetPhase(): BudgetPhase {
    return this.phase;
  }

  /* --------------------------------------------------------------- consensus */

  /**
   * §8: unanimity among *active* participants, in the same round, with a floor of
   * two. Degraded and blocked participants cannot block and cannot confirm — they
   * are not in `active()`. The floor is what stops a roster reduced to one from
   * declaring "unanimous" on a single vote.
   */
  /** Who has claimed consensus in the round just finished. */
  consensusIds(): ParticipantId[] {
    return [...this.consensus];
  }

  consensusReached(): boolean {
    const active = this.active();
    return quorumReached(active.length, this.consensus.length) && active.every((p) => this.consensus.includes(p));
  }

  /** True when someone claimed consensus but the quorum is not met. */
  unilateralClaim(): ParticipantId | null {
    if (this.consensus.length === 0) return null;
    return this.consensusReached() ? null : this.consensus[0] ?? null;
  }

  snapshot(): SchedulerSnapshot {
    return {
      round: this.round,
      budget: this.budget,
      phase: this.phase,
      escalates: this.escalates,
      escalateCap: this.escalateCap,
      reservationUsed: this.reservationUsed,
      expected: this.nextSpeaker(),
      statuses: Object.fromEntries(this.statuses),
      spoken: [...this.spoken],
      consensus: [...this.consensus],
      activeCount: this.active().length,
      history: [...this.history],
    };
  }
}

/* ------------------------------------------------------------------ *
 * Participant-boundary failover (§6)
 * ------------------------------------------------------------------ */

export type FailoverOutcome =
  | { ok: true; provider: string; attempted: string[] }
  | { ok: false; reason: 'PROVIDER_SET_EXHAUSTED'; attempted: string[] };

/**
 * The next provider for a participant, within its declared set only.
 *
 * This is the whole of §6. The runtime's own chain walk answers "which provider
 * is cheapest right now", which is right for a single-user prompt and wrong for a
 * debate: participant 3 hitting a limit must not silently become a different
 * model, because the context blocks, the plan provenance and the roster the user
 * chose all say participant 3 is Claude.
 *
 * `available` reports whether a provider can currently answer — the router's
 * cooldown and the rotator's rate budget both feed it.
 */
export function resolveParticipantProvider(
  participant: SchedulerParticipant,
  available: (provider: string) => boolean,
): FailoverOutcome {
  const attempted: string[] = [];
  for (const provider of participant.providers) {
    attempted.push(provider);
    if (available(provider)) return { ok: true, provider, attempted };
  }
  return { ok: false, reason: 'PROVIDER_SET_EXHAUSTED', attempted };
}

/* ------------------------------------------------------------------ *
 * Context-block drop rotation (§7)
 * ------------------------------------------------------------------ */

export interface ContextMessage {
  participant: ParticipantId;
  round: number;
  chars: number;
  /** Stable tiebreak so the same input always produces the same plan. */
  seq: number;
}

export interface DropPlan {
  keep: ContextMessage[];
  dropped: ContextMessage[];
  /** Everyone whose message was dropped this turn, to skip on the next one. */
  skip: ParticipantId[];
  /** True when the rotation was ignored to reach the budget. */
  rotationIgnored: boolean;
}

const totalChars = (msgs: ContextMessage[]): number => msgs.reduce((n, m) => n + m.chars, 0);

/**
 * Choose which context messages to drop to fit the cap, without systematically
 * excluding one participant.
 *
 * The rule from §7: drop the oldest message from whoever has the most, and skip
 * the participant that lost a message last turn so the same one is not always
 * first. The failsafe matters — if the rotated-out participant is the only one
 * with anything droppable, skipping would fail to reach the budget, so the
 * rotation is abandoned for that turn and the manifest records it.
 */
export function planContextDrops(
  messages: ContextMessage[],
  budgetChars: number,
  previousSkip: ParticipantId[] | null = null,
): DropPlan {
  const ordered = [...messages].sort((a, b) => a.round - b.round || a.seq - b.seq);
  let remaining = ordered;
  const dropped: ContextMessage[] = [];
  // Fixed for the whole pass: the rotation protects the participants who lost a
  // message *last* turn, and must not be re-applied after each drop within this
  // one.
  const skipThisPass = previousSkip ?? [];
  const lost: ParticipantId[] = [];
  let rotationIgnored = false;

  const byParticipant = (msgs: ContextMessage[]): Map<ParticipantId, ContextMessage[]> => {
    const map = new Map<ParticipantId, ContextMessage[]>();
    for (const m of msgs) map.set(m.participant, [...(map.get(m.participant) ?? []), m]);
    return map;
  };

  while (totalChars(remaining) > budgetChars && remaining.length > 0) {
    const groups = byParticipant(remaining);
    const everyone = [...groups.keys()];

    let candidates = everyone.filter((p) => !skipThisPass.includes(p));
    if (candidates.length === 0) {
      // Nothing to drop outside the rotated-out participant: the rotation cannot
      // reach the budget, so it loses to the budget.
      candidates = everyone;
      rotationIgnored = true;
    }

    const victim = candidates.sort((a, b) => {
      const diff = (groups.get(b) ?? []).length - (groups.get(a) ?? []).length;
      return diff !== 0 ? diff : a - b;
    })[0];
    if (victim === undefined) break;

    const oldest = (groups.get(victim) ?? [])[0];
    if (oldest === undefined) break;

    remaining = remaining.filter((m) => m !== oldest);
    dropped.push(oldest);
    if (!lost.includes(victim)) lost.push(victim);
  }

  return { keep: remaining, dropped, skip: lost, rotationIgnored };
}
