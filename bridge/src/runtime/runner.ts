/**
 * Session runner — the thing that actually plays a debate.
 *
 * It ties the modules together: the scheduler decides who speaks, the relay
 * (injected as a plain dispatch function) talks to the page, the token parser
 * reads the answer, and the state machine decides when to stop. Everything it
 * needs from the outside world arrives through `Dispatch`, so the whole loop is
 * tested against a fake before a browser is anywhere near it.
 *
 * Two rules are enforced here rather than trusted to the caller:
 *
 *  - A turn that cannot be parsed is retried once and then the participant is
 *    degraded. A debate must not hang because one model refused to emit a token.
 *  - A planner turn is checked for the plan block on every turn, whatever token
 *    it ends with, because a planner CONSENSUS turn still revises the plan.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Role, SessionState } from './stateMachine';
import { isTerminal, transition } from './stateMachine';
import { Scheduler, type TurnToken } from './scheduler';
import type { ParticipantSpec, SessionRecord } from './session';
import { sessionDir, writeRecord } from './session';
import { escalationAccepted, extractFenced, parseToken, type SettleBy, type Token } from './token';

export interface DispatchRequest {
  sessionId: string;
  participant: ParticipantSpec;
  round: number;
  /** True on a retry, so the adapter can add the RETRY suffix. */
  retry: boolean;
  planText: string;
  contextText: string;
  questionsText: string;
  snapshotText: string;
}

export interface DispatchResult {
  text: string;
  settledBy: SettleBy;
}

/** The seam. A real implementation wraps Relay; a test passes a function. */
export type Dispatch = (req: DispatchRequest) => Promise<DispatchResult>;

export type RunnerEvent =
  | { type: 'turn.start'; round: number; participant: number; retry: boolean }
  | { type: 'turn.end'; round: number; participant: number; token: string | null; ms: number }
  | { type: 'token.multiple'; participant: number; raw: string }
  | { type: 'plan.written'; version: number; bytes: number }
  | { type: 'plan.missing'; participant: number; attempt: number }
  | { type: 'round.complete'; round: number }
  | { type: 'budget.reservation' }
  | { type: 'budget.exhausted' }
  | { type: 'escalate'; participant: number; accepted: boolean; applied: boolean; escalates: number }
  | { type: 'degraded'; participant: number; reason: string }
  | { type: 'objection'; participant: number; body: string; round: number }
  | { type: 'halt'; state: SessionState; reason: string | null };

export interface RunnerDeps {
  /** Sessions root — the same directory session.ts writes to. */
  root: string;
  record: SessionRecord;
  dispatch: Dispatch;
  roundBudget?: number;
  /** Hard stop on the loop, so a scheduler bug cannot spin forever. */
  maxTurns?: number;
  now?: () => number;
  onEvent?: (event: RunnerEvent) => void;
}

export interface RunResult {
  state: SessionState;
  reason: string | null;
  turns: number;
  rounds: number;
  planVersion: number;
  objections: Array<{ participant: number; body: string; round: number }>;
}

const RETRY_HINT = '\n\nREMINDER — end with exactly one token. No code. 500 words max.';

export class SessionRunner {
  private readonly deps: RunnerDeps;
  private readonly scheduler: Scheduler;
  private readonly now: () => number;
  private state: SessionState;
  private reason: string | null = null;
  private turns = 0;
  private planVersion: number;
  private readonly objections: Array<{ participant: number; body: string; round: number }> = [];
  private readonly transcript: Array<{ round: number; participant: number; token: string; text: string }> = [];
  private seq = 0;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.state = deps.record.state === 'INITIALIZING' ? 'ACTIVE' : deps.record.state;
    this.planVersion = deps.record.planVersion ?? 0;
    this.scheduler = new Scheduler({
      participants: deps.record.participants.map((p) => ({ index: p.index, role: p.role, providers: p.providers })),
      roundBudget: deps.roundBudget ?? deps.record.roundBudget,
    });
  }

  private emit(event: RunnerEvent): void {
    this.deps.onEvent?.(event);
  }

  private participant(index: number): ParticipantSpec {
    const found = this.deps.record.participants.find((p) => p.index === index);
    if (!found) throw new Error(`ENOPARTICIPANT: ${index}`);
    return found;
  }

  /** Apply a state-machine event. A refused transition is a scheduler bug, not a halt. */
  private apply(event: Parameters<typeof transition>[1]): void {
    const result = transition(this.state, event);
    if (!result.ok) return;
    this.state = result.state;
    if (result.reason) this.reason = result.reason;
  }

  private halted(): boolean {
    return isTerminal(this.state) || this.state !== 'ACTIVE';
  }

  /* ------------------------------------------------------------------ plan */

  private writePlan(text: string): void {
    this.planVersion += 1;
    const dir = path.join(sessionDir(this.deps.root, this.deps.record.id), 'plans');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `plan-v${this.planVersion}.md`), text, { mode: 0o600 });
    this.emit({ type: 'plan.written', version: this.planVersion, bytes: Buffer.byteLength(text) });
  }

  /* ------------------------------------------------------------- transcript */

  private persistTurn(round: number, participant: number, token: string, text: string): void {
    this.seq += 1;
    const dir = path.join(sessionDir(this.deps.root, this.deps.record.id), 'tx');
    fs.mkdirSync(dir, { recursive: true });
    // Sharded per message: a single serialised key is O(n) per write and the
    // transcript is the one thing that grows without bound.
    const file = path.join(dir, `${round}-${participant}-${this.seq}.json`);
    fs.writeFileSync(file, `${JSON.stringify({ round, participant, token, text, t: this.now() })}\n`, { mode: 0o600 });
    this.transcript.push({ round, participant, token, text });
  }

  /* ------------------------------------------------------------------ turns */

  private async playTurn(participant: ParticipantSpec, round: number): Promise<Token | null> {
    const base: Omit<DispatchRequest, 'retry'> = {
      sessionId: this.deps.record.id,
      participant,
      round,
      planText: this.currentPlan(),
      contextText: this.contextBlock(participant.index),
      questionsText: '',
      snapshotText: '',
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      this.emit({ type: 'turn.start', round, participant: participant.index, retry });
      const started = this.now();

      let result: DispatchResult;
      try {
        result = await this.deps.dispatch({ ...base, retry });
      } catch (err) {
        const why = `DISPATCH_FAILED: ${(err as Error).message}`;
        this.emit({ type: 'degraded', participant: participant.index, reason: why });
        this.degrade(participant, why);
        return null;
      }

      const parsed = parseToken(result.text, result.settledBy);
      this.emit({
        type: 'turn.end',
        round,
        participant: participant.index,
        token: parsed.token?.kind ?? null,
        ms: this.now() - started,
      });
      if (parsed.multiple && parsed.token) {
        this.emit({ type: 'token.multiple', participant: participant.index, raw: parsed.token.raw });
      }

      // A token settled by `debounce` is not trusted: retry rather than act on it.
      if (parsed.token === null || parsed.reason !== null) {
        if (attempt === 0) continue;
        this.degrade(participant, parsed.reason ?? 'NO_TOKEN');
        return null;
      }
      const token = parsed.token;

      // The plan block is required from the planner on every turn (§5).
      if (participant.role === 'planner') {
        const plan = extractFenced(result.text, 'plan');
        if (!plan) {
          this.emit({ type: 'plan.missing', participant: participant.index, attempt });
          if (attempt === 0) continue;
          this.degrade(participant, 'PLAN_MISSING');
          return null;
        }
        this.writePlan(plan);
      }

      this.persistTurn(round, participant.index, token.kind, result.text);
      return token;
    }
    return null;
  }

  private degrade(participant: ParticipantSpec, why: string): void {
    const result = this.scheduler.degrade(participant.index, why);
    this.apply({ type: 'participant.degraded', participant: participant.index, role: participant.role as Role, reason: why });
    if (result.roundCompleted) this.emit({ type: 'round.complete', round: this.scheduler.snapshot().round - 1 });
  }

  private currentPlan(): string {
    if (this.planVersion === 0) return '';
    const file = path.join(sessionDir(this.deps.root, this.deps.record.id), 'plans', `plan-v${this.planVersion}.md`);
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  }

  /** Last three turns by the other participants — the §7 context block, minimally. */
  private contextBlock(participant: number): string {
    return this.transcript
      .filter((t) => t.participant !== participant)
      .slice(-3)
      .map((t) => `[round ${t.round} | participant ${t.participant}] ${t.text.slice(0, 600)}`)
      .join('\n\n');
  }

  /* ------------------------------------------------------------------- run */

  async run(): Promise<RunResult> {
    const maxTurns = this.deps.maxTurns ?? 200;

    while (this.turns < maxTurns) {
      if (this.halted()) break;

      const next = this.scheduler.nextSpeaker();
      if (next === null) {
        this.finish();
        break;
      }

      const participant = this.participant(next);
      const round = this.scheduler.snapshot().round;
      this.turns += 1;

      const token = await this.playTurn(participant, round);
      if (token === null) continue; // degraded; the scheduler has already skipped it

      const { roundCompleted } = this.scheduler.completeTurn(participant.index, token.kind as TurnToken);

      if (token.kind === 'ASK_USER') {
        this.apply({ type: 'ask.user', participant: participant.index });
        this.emit({ type: 'halt', state: this.state, reason: this.reason });
        break;
      }

      if (token.kind === 'ESCALATE') {
        const accepted = escalationAccepted(token);
        const applied = this.scheduler.escalate(accepted);
        this.emit({
          type: 'escalate',
          participant: participant.index,
          accepted,
          applied: applied.applied,
          escalates: applied.escalates,
        });
      }

      if (token.kind === 'OBJECTION') {
        this.objections.push({ participant: participant.index, body: token.body, round });
        this.emit({ type: 'objection', participant: participant.index, body: token.body, round });
      }

      if (roundCompleted) {
        this.emit({ type: 'round.complete', round });
        // Consensus is evaluated on the round that just finished, before anything
        // clears the tally.
        if (this.scheduler.consensusReached()) {
          this.apply({ type: 'consensus.unanimous' });
          this.emit({ type: 'halt', state: this.state, reason: this.reason });
          break;
        }
        const unilateral = this.scheduler.unilateralClaim();
        if (unilateral !== null) {
          this.apply({ type: 'consensus.unilateral', participant: unilateral });
          this.emit({ type: 'halt', state: this.state, reason: this.reason });
          break;
        }
      }
    }

    return this.result();
  }

  /** Nobody can speak: the reservation is next, the budget is spent, or the roster is gone. */
  private finish(): void {
    const snap = this.scheduler.snapshot();

    if (snap.phase === 'reservation') {
      // The planner is not dispatchable, so the reserved turn cannot run.
      this.apply({ type: 'participant.degraded', participant: 0, role: 'planner', reason: 'PLANNER_DEGRADED' });
      this.emit({ type: 'halt', state: this.state, reason: this.reason });
      return;
    }
    if (snap.phase === 'exhausted') {
      this.apply({ type: 'round.exhausted' });
      this.emit({ type: 'budget.exhausted' });
      this.emit({ type: 'halt', state: this.state, reason: this.reason });
      return;
    }
    this.apply({ type: 'participant.degraded', participant: 0, role: 'planner', reason: 'NO_ACTIVE_PARTICIPANTS' });
    this.emit({ type: 'halt', state: this.state, reason: this.reason });
  }

  private result(): RunResult {
    // Keep the record current, so a killed process reconstructs the truth rather
    // than the state the session was created in.
    const record: SessionRecord = {
      ...this.deps.record,
      state: this.state,
      reason: this.reason ?? undefined,
      planVersion: this.planVersion,
      round: this.scheduler.snapshot().round,
      lastMutationAt: this.now(),
    };
    try {
      writeRecord(this.deps.root, record);
    } catch {
      // A failed write is reported by the caller's storage check, not swallowed
      // into a successful run.
    }
    return {
      state: this.state,
      reason: this.reason,
      turns: this.turns,
      rounds: this.scheduler.snapshot().round,
      planVersion: this.planVersion,
      objections: [...this.objections],
    };
  }

  snapshot() {
    return this.scheduler.snapshot();
  }
}

export { RETRY_HINT };
