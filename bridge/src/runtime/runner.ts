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
import { planContextDrops, Scheduler, type ContextMessage, type TurnToken } from './scheduler';
import { LoginWait } from './login';
import type { ParticipantSpec, SessionRecord } from './session';
import { sessionDir, setSubState, writeRecord } from './session';
import { exportBundle, type BundleResult, type BundleObjection } from './bundle';
import {
  jaccard,
  parseQuestionsBlock,
  QuestionLedger,
  STALL_RUNS,
  STALL_THRESHOLD,
} from './questions';
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
  /** Open objections with the ids a resolutions block must use. */
  objectionsText: string;
  snapshotText: string;
}

export interface DispatchResult {
  text: string;
  settledBy: SettleBy;
}

/** The seam. A real implementation wraps Relay; a test passes a function. */
export type Dispatch = (req: DispatchRequest) => Promise<DispatchResult>;

/**
 * Where a turn's code context comes from. `repo/snapshot.ts` supplies the real
 * one; a test supplies a stub. Without this, `snapshotText` was always empty and
 * the auditor audited a plan with no code in front of it.
 */
/**
 * What a participant waiting for a human needs. Injected so the wait is testable
 * without a browser, and so the runner never learns what a tab is.
 */
export interface LoginHooks {
  /** Bring the participant's tab to the front. */
  promote(participant: number): Promise<void>;
  /** Is it signed in yet? */
  ready(participant: number): Promise<boolean>;
  /** Wait, injectable so a test does not spend five real minutes. */
  sleep(ms: number): Promise<void>;
}

export interface SnapshotProvider {
  sliceFor(planText: string, role: Role): Promise<string>;
}

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
  | { type: 'halt'; state: SessionState; reason: string | null }
  /** A state-machine transition was refused: the scheduler and the machine disagree. */
  | { type: 'transition.rejected'; state: SessionState; event: string; why: string }
  | { type: 'resumed'; from: SessionState }
  | { type: 'bundle.written'; dir: string; artifacts: number }
  | { type: 'context.dropped'; participant: number; dropped: number; rotationIgnored: boolean }
  | { type: 'context.truncated'; participant: number; bytes: number }
  | { type: 'question.asked'; id: string; round: number; participant: number }
  | { type: 'objection.resolved'; participant: number; round: number }
  | { type: 'stall.check'; participant: number; similarity: number; runs: number }
  | { type: 'login.required'; participant: number }
  | { type: 'login.succeeded'; participant: number; elapsedMs: number }
  | { type: 'login.expired'; participant: number; ceilingMs: number };

export interface RunnerDeps {
  /** Sessions root — the same directory session.ts writes to. */
  root: string;
  record: SessionRecord;
  dispatch: Dispatch;
  snapshot?: SnapshotProvider;
  login?: LoginHooks;
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
  objections: Array<{ participant: number; body: string; round: number; resolution?: string }>;
}

const RETRY_HINT = '\n\nREMINDER — end with exactly one token. No code. 500 words max.';

/** §7's context block cap. The 600-character per-message trim it replaces had no
 *  relationship to the payload budget at all. */
const CONTEXT_BUDGET_BYTES = 6 * 1024;
/** Never cut a message below this, or the share becomes a list of subject lines. */
const MIN_MESSAGE_BYTES = 256;
/** What `[round 12 | participant 3] ` costs. */
const HEADER_BYTES = 32;

/** Cut on a byte boundary without splitting a character. */
function cutUtf8(text: string, limit: number): string {
  if (Buffer.byteLength(text) <= limit) return text;
  return Buffer.from(text).subarray(0, limit).toString('utf8').replace(/\uFFFD$/, '');
}

export class SessionRunner {
  private readonly deps: RunnerDeps;
  private record: SessionRecord;
  private readonly scheduler: Scheduler;
  private readonly now: () => number;
  private state: SessionState;
  private reason: string | null = null;
  private turns = 0;
  private planVersion: number;
  private readonly objections: Array<{ participant: number; body: string; round: number; resolution?: string }> = [];
  private readonly transcript: Array<{ round: number; participant: number; token: string; text: string }> = [];
  private seq = 0;
  /** Participants whose message was dropped last turn, so the rotation can skip them. */
  private contextSkip: number[] = [];
  /**
   * §7 delta transport. What each participant has already been sent, so a turn
   * carries the change rather than the whole history: the plan only when its version
   * moved, and only the messages that arrived since their last turn.
   */
  private readonly planSeen = new Map<number, number>();
  private readonly contextSeen = new Map<number, number>();
  /** §14: questions the auditor asked that only the user can answer. */
  private readonly questions = new QuestionLedger();
  /** §8: each participant's previous turn, and how many times running it repeated. */
  private readonly lastTurnText = new Map<number, string>();
  private readonly stallRuns = new Map<number, number>();
  private readonly startedAt: number;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    this.record = deps.record;
    this.now = deps.now ?? (() => Date.now());
    this.state = deps.record.state === 'INITIALIZING' ? 'ACTIVE' : deps.record.state;
    this.startedAt = this.now();
    this.planVersion = deps.record.planVersion ?? 0;
    this.scheduler = new Scheduler({
      participants: deps.record.participants.map((p) => ({ index: p.index, role: p.role, providers: p.providers })),
      roundBudget: deps.roundBudget ?? deps.record.roundBudget,
    });

    // The handshake phase is not implemented yet, so the runner starts every
    // participant dispatchable. Recording that is the point: session.json used to
    // keep saying HANDSHAKE_PENDING forever because nobody wrote the truth down.
    for (const p of deps.record.participants) {
      this.record = setSubState(this.deps.root, this.record, p.index, 'ACTIVE', this.now());
    }
  }

  private emit(event: RunnerEvent): void {
    this.deps.onEvent?.(event);
  }

  private participant(index: number): ParticipantSpec {
    const found = this.deps.record.participants.find((p) => p.index === index);
    if (!found) throw new Error(`ENOPARTICIPANT: ${index}`);
    return found;
  }

  /**
   * Apply a state-machine event.
   *
   * A refused transition used to be dropped on the floor, which meant a
   * disagreement between the scheduler and the machine disappeared silently — the
   * same class of bug the state machine's totality was built to prevent. It now
   * returns whether it applied and raises an event when it did not.
   */
  private apply(event: Parameters<typeof transition>[1]): boolean {
    const result = transition(this.state, event);
    if (!result.ok) {
      this.emit({ type: 'transition.rejected', state: this.state, event: event.type, why: result.rejected });
      return false;
    }
    this.state = result.state;
    if (result.reason) this.reason = result.reason;
    return true;
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
    // The context block is built once per turn: it advances the watermark, so
    // building it twice would mark messages seen and then send nothing.
    const contextText = this.contextBlock(participant.index);
    // The slice is built once per turn: the plan is what it ranks against, and the
    // plan does not change inside a turn.
    const snapshotText = this.deps.snapshot
      ? await this.deps.snapshot.sliceFor(this.currentPlan(), participant.role)
      : '';

    const base: Omit<DispatchRequest, 'retry'> = {
      sessionId: this.deps.record.id,
      participant,
      round,
      // Recomputed per attempt on purpose: a retry should carry the change, not the
      // whole plan it was already given. Filled in at dispatch time.
      planText: '',
      contextText,
      questionsText: this.questions.open().map((q) => `- ${q.text}`).join('\n'),
      objectionsText: this.objectionsBlock(participant.index),
      snapshotText,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      this.emit({ type: 'turn.start', round, participant: participant.index, retry });
      const started = this.now();

      let result: DispatchResult;
      try {
        result = await this.deps.dispatch({ ...base, planText: this.planFor(participant), retry });
      } catch (err) {
        const message = (err as Error).message;

        // A sign-in page is not a broken selector and not a lost tab: someone has
        // to type a password. Wait for them, then send the turn again.
        if (/^EAUTH/.test(message) && this.deps.login) {
          const signedIn = await this.waitForLogin(participant);
          if (signedIn) {
            attempt -= 1; // the same attempt, not a retry of a bad answer
            continue;
          }
          this.degrade(participant, 'AUTH_BLOCKED');
          return null;
        }

        const why = `DISPATCH_FAILED: ${message}`;
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

      // §14: the auditor's questions block is the only source. Prose questions in
      // a reply body are ignored and logged, not turned into a gate.
      if (participant.role === 'auditor') {
        const block = extractFenced(result.text, 'questions');
        if (block) {
          for (const q of parseQuestionsBlock(block)) {
            const entry = this.questions.add(round, participant.index, q.text, q.options);
            this.emit({ type: 'question.asked', id: entry.id, round, participant: participant.index });
          }
        }
      }

      // §15: a planner turn may answer objections by id.
      if (participant.role === 'planner') {
        const block = extractFenced(result.text, 'resolutions');
        if (block) this.applyResolutions(block);
      }

      // §8: a participant that repeats itself twice running has stopped moving.
      this.noteStallRisk(participant.index, result.text);

      this.persistTurn(round, participant.index, token.kind, result.text);
      return token;
    }
    return null;
  }

  /**
   * `obj-<round>-<participant>: text` lines from a planner resolutions block.
   * An objection with no entry stays open, which is what the bundle reports.
   */
  private applyResolutions(block: string): void {
    for (const line of block.split('\n')) {
      const match = /^\s*obj-(\d+)-(\d+)\s*:\s*(.+)$/.exec(line);
      if (!match) continue;
      const round = Number(match[1]);
      const participant = Number(match[2]);
      const resolution = (match[3] ?? '').trim();
      const objection = this.objections.find((o) => o.round === round && o.participant === participant);
      if (!objection) continue;
      objection.resolution = resolution;
      this.emit({ type: 'objection.resolved', participant, round });
    }
  }

  private noteStallRisk(participant: number, text: string): void {
    const previous = this.lastTurnText.get(participant);
    this.lastTurnText.set(participant, text);
    if (previous === undefined) return;

    const similarity = jaccard(previous, text);
    const runs = similarity > STALL_THRESHOLD ? (this.stallRuns.get(participant) ?? 0) + 1 : 0;
    this.stallRuns.set(participant, runs);
    this.emit({ type: 'stall.check', participant, similarity, runs });
  }

  /** True once a participant has repeated itself enough to call the session stalled. */
  private stalledParticipant(): number | null {
    for (const [participant, runs] of this.stallRuns) {
      if (runs >= STALL_RUNS) return participant;
    }
    return null;
  }

  /**
   * The open objections, with the exact id a resolutions block must use.
   *
   * Only the planner is sent this: it is the only role that can answer one, and
   * giving it to everyone would put a list of complaints in every debater's
   * context and turn the debate into five people arguing about objections.
   */
  private objectionsBlock(participant: number): string {
    const planner = this.record.participants.find((p) => p.role === 'planner');
    if (!planner || planner.index !== participant) return '';
    return this.objections
      .filter((o) => !o.resolution)
      .map((o) => `obj-${o.round}-${o.participant}: ${o.body}`)
      .join('\n');
  }

  /**
   * Promote the tab and poll until signed in or the ceiling passes.
   *
   * The session state only changes while initialising. Mid-debate, a session-level
   * AWAITING_LOGIN would stall the other four participants for one person's
   * password — so a re-auth is a participant-level wait with a reported event, and
   * only expiry degrades it.
   */
  private async waitForLogin(participant: ParticipantSpec): Promise<boolean> {
    const login = this.deps.login;
    if (!login) return false;

    const wait = new LoginWait({ now: this.now });
    const initialising = this.state === 'INITIALIZING' || this.state === 'HANDSHAKE_PENDING';
    if (initialising) {
      this.apply({ type: 'login.required', participant: participant.index });
    }
    this.emit({ type: 'login.required', participant: participant.index });
    await login.promote(participant.index);

    while (!wait.expired()) {
      await login.sleep(wait.nextDelayMs());
      if (await login.ready(participant.index)) {
        if (initialising) this.apply({ type: 'login.succeeded', participant: participant.index });
        this.emit({ type: 'login.succeeded', participant: participant.index, elapsedMs: wait.elapsedMs() });
        return true;
      }
    }

    if (initialising) {
      this.apply({ type: 'login.ceiling', participant: participant.index, role: participant.role as Role });
    }
    this.emit({ type: 'login.expired', participant: participant.index, ceilingMs: wait.ceilingMs() });
    return false;
  }

  private degrade(participant: ParticipantSpec, why: string): void {
    this.record = setSubState(this.deps.root, this.record, participant.index, 'DEGRADED', this.now());
    const result = this.scheduler.degrade(participant.index, why);
    this.apply({ type: 'participant.degraded', participant: participant.index, role: participant.role as Role, reason: why });
    if (result.roundCompleted) this.emit({ type: 'round.complete', round: this.scheduler.snapshot().round - 1 });
  }

  /**
   * The plan as this participant should receive it.
   *
   * The planner always gets the full text — it is the one revising it, and a note
   * saying "unchanged" would leave it nothing to edit. Everyone else gets the plan
   * when its version moved, and a one-line marker when it did not.
   */
  private planFor(participant: ParticipantSpec): string {
    const full = this.currentPlan();
    if (participant.role === 'planner' || this.planVersion === 0) return full;

    const seen = this.planSeen.get(participant.index) ?? 0;
    if (seen === this.planVersion) {
      return `(plan unchanged since you last read it — still v${this.planVersion})`;
    }
    this.planSeen.set(participant.index, this.planVersion);
    return full;
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

  /**
   * The §7 context block: the last few turns by the other participants, capped at
   * 6 KB, with the drop rotation applied so one participant is not permanently
   * the one that gets cut.
   *
   * The rotation lives in the scheduler (it is tested there); this holds the state
   * between turns and reports what it had to do.
   */
  private contextBlock(participant: number): string {
    // Delta: only what arrived since this participant last spoke. Without the
    // watermark every turn re-sends the same twelve messages, which is where the
    // per-thread token count came from.
    const from = this.contextSeen.get(participant) ?? 0;
    const unseen = this.transcript
      .map((t, i) => ({ t, seq: i + 1 }))
      .filter(({ t, seq }) => t.participant !== participant && seq > from)
      .map(({ t }) => t);
    this.contextSeen.set(participant, this.transcript.length);

    const recent = unseen.slice(-12);
    const messages: ContextMessage[] = recent.map((t, i) => ({
      participant: t.participant,
      round: t.round,
      chars: Buffer.byteLength(t.text),
      seq: i,
    }));

    // Fair share first, drop second.
    //
    // Dropping whole messages meant a 500-byte turn could be cut while a 5 KB one
    // stayed, because the drop rule picks by participant and not by size. Capping
    // each message to its share of the budget keeps every participant represented
    // and only drops when there are simply too many messages to hold.
    const share = messages.length > 0 ? Math.floor(CONTEXT_BUDGET_BYTES / messages.length) : 0;
    let cutToShare = 0;
    const bounded = recent.map((t) => {
      const cap = Math.max(MIN_MESSAGE_BYTES, share - HEADER_BYTES);
      if (Buffer.byteLength(t.text) <= cap) return t.text;
      cutToShare += 1;
      return cutUtf8(t.text, cap);
    });
    if (cutToShare > 0) {
      // Cutting a message to its share is a truncation like any other, and a
      // silent one would be the exact failure this block was rewritten to avoid.
      this.emit({ type: 'context.truncated', participant, bytes: cutToShare });
    }

    const plan = planContextDrops(
      messages.map((m, i) => ({ ...m, chars: Buffer.byteLength(bounded[i] ?? '') })),
      CONTEXT_BUDGET_BYTES,
      this.contextSkip,
    );
    this.contextSkip = plan.skip;
    if (plan.dropped.length > 0) {
      this.emit({
        type: 'context.dropped',
        participant,
        dropped: plan.dropped.length,
        rotationIgnored: plan.rotationIgnored,
      });
    }

    const kept = new Set(plan.keep.map((m) => m.seq));
    const text = recent
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => kept.has(i))
      .map(({ t, i }) => `[round ${t.round} | participant ${t.participant}] ${bounded[i] ?? ''}`)
      .join('\n\n');

    if (Buffer.byteLength(text) <= CONTEXT_BUDGET_BYTES) return text;

    // A single message larger than the whole budget cannot be dropped further, so
    // it is cut — and said so, rather than silently arriving short.
    const cut = Buffer.from(text).subarray(0, CONTEXT_BUDGET_BYTES).toString('utf8');
    this.emit({ type: 'context.truncated', participant, bytes: Buffer.byteLength(cut) });
    return cut;
  }

  /* ------------------------------------------------------------------- run */

  async run(): Promise<RunResult> {
    const maxTurns = this.deps.maxTurns ?? 200;

    while (this.turns < maxTurns) {
      if (this.halted()) break;

      // §19: checked before each turn rather than by a timer, so the session
      // cannot overrun while the runner sits between awaits.
      const wallClock = this.deps.record.wallClockMs;
      if (wallClock > 0 && this.now() - this.startedAt >= wallClock) {
        this.apply({ type: 'wallclock.exhausted' });
        this.emit({ type: 'halt', state: this.state, reason: this.reason });
        break;
      }

      // §8: a participant that has repeated itself twice running has stopped
      // moving, and more rounds will not help it.
      const stalled = this.stalledParticipant();
      if (stalled !== null) {
        this.apply({ type: 'stall.detected', participant: stalled });
        this.emit({ type: 'halt', state: this.state, reason: this.reason });
        break;
      }

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
          // §14 DECISION: an open question gates consensus. Unanimity on a plan
          // whose open question nobody answered is not an agreement yet, so it
          // becomes a question for the user rather than a stop.
          if (this.questions.blocksConsensus()) {
            const open = this.questions.open()[0];
            this.apply({ type: 'ask.user', participant: open?.askedBy ?? 0 });
            this.emit({ type: 'halt', state: this.state, reason: this.reason });
            break;
          }
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

    // A guard that fires must halt. Falling out of the loop in ACTIVE produced a
    // session that looked live and was not running — the worst of both.
    if (this.turns >= maxTurns && this.state === 'ACTIVE') {
      this.apply({ type: 'guard.tripped', reason: `turn ceiling of ${maxTurns} reached` });
      this.emit({ type: 'halt', state: this.state, reason: this.reason });
    }

    return this.result();
  }

  /** Nobody can speak: the reservation is next, the budget is spent, or the roster is gone. */
  private finish(): void {
    const snap = this.scheduler.snapshot();

    const planner = this.record.participants.find((p) => p.role === 'planner');

    if (snap.phase === 'reservation') {
      // The planner is not dispatchable, so the reserved turn cannot run. Resolved
      // by role: assuming participant 0 is the planner mislabels the halt whenever
      // the roster is not in index order.
      if (planner) {
        this.apply({ type: 'participant.degraded', participant: planner.index, role: 'planner', reason: 'PLANNER_DEGRADED' });
      }
      this.emit({ type: 'halt', state: this.state, reason: this.reason });
      return;
    }
    if (snap.phase === 'exhausted') {
      this.apply({ type: 'round.exhausted' });
      this.emit({ type: 'budget.exhausted' });
      this.emit({ type: 'halt', state: this.state, reason: this.reason });
      return;
    }
    if (planner) {
      this.apply({ type: 'participant.degraded', participant: planner.index, role: 'planner', reason: 'NO_ACTIVE_PARTICIPANTS' });
    }
    this.emit({ type: 'halt', state: this.state, reason: this.reason });
  }

  /** Keep the record current, so a killed process reconstructs the truth. */
  private persistRecord(): void {
    this.record = {
      ...this.record,
      state: this.state,
      reason: this.reason ?? undefined,
      planVersion: this.planVersion,
      round: this.scheduler.snapshot().round,
      lastMutationAt: this.now(),
    };
    try {
      writeRecord(this.deps.root, this.record);
    } catch {
      // A failed write is reported by the caller's storage check, not swallowed
      // into a successful run.
    }
  }

  /* ------------------------------------------------------- the missing exits */

  /**
   * NEEDS_USER -> ACTIVE, and keep playing. The audit found this missing: the
   * state machine had the transition and nothing called it, so every session that
   * asked the user a question was terminal in practice.
   */
  async resume(): Promise<RunResult> {
    const from = this.state;
    if (!this.apply({ type: 'user.resume' })) return this.result();
    this.emit({ type: 'resumed', from });
    return this.run();
  }

  /**
   * CONSENSUS -> AWAITING_HANDOFF_CONFIRM, then write the bundle (§9). This is the
   * product's actual output; without it a session that reached consensus left a
   * plan file and a directory of shards and stopped.
   */
  confirmBundle(snapshot?: { id: string; sha256: string; capturedAt: number }): { ok: boolean; bundle?: BundleResult } {
    if (!this.apply({ type: 'user.confirm.bundle' })) return { ok: false };
    this.persistRecord();

    const bundle = exportBundle({
      root: this.deps.root,
      record: this.record,
      planVersion: this.planVersion,
      objections: this.objections.map((o) => ({ ...o }) as BundleObjection),
      questions: this.questions.all(),
      snapshot: snapshot ?? null,
      now: this.now(),
    });
    this.emit({ type: 'bundle.written', dir: bundle.dir, artifacts: bundle.files.length });
    return { ok: true, bundle };
  }

  /**
   * NEEDS_USER -> CONSENSUS. A unilateral claim lands here rather than stopping,
   * so without this the user could never accept a plan the debate did not agree on
   * — which is the whole point of routing a claim through the user.
   */
  confirmConsensus(): boolean {
    const ok = this.apply({ type: 'user.confirm.consensus' });
    if (ok) this.persistRecord();
    return ok;
  }

  /**
   * ABORTED. The transcript and bundle stay for the retention window; the caller
   * releases leases and closes the tabs, because those are browser operations and
   * this module does not own a browser.
   */
  abort(reason = 'user aborted'): boolean {
    const ok = this.apply({ type: 'user.abort' });
    if (!ok) return false;
    this.reason = reason;
    this.persistRecord();
    return true;
  }

  /** The user confirmed the build in Sarvam — the machine's last transition. */
  confirmHandoff(): boolean {
    const ok = this.apply({ type: 'handoff.confirmed' });
    if (ok) this.persistRecord();
    return ok;
  }

  private result(): RunResult {
    this.persistRecord();
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
