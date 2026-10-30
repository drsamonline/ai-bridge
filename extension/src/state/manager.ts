/**
 * State manager — the object the rest of the extension talks to.
 *
 * One turn in, one persisted state out. T1 runs in the worker, deltas are capped
 * at §4's 200, files/stack/constraints/todos are folded into their slices, and
 * the whole thing is written every turn (spec §5.5: "T1 — every turn").
 *
 * Snapshots are taken on init, every `snapshotEvery` turns, and on demand.
 */

import { EventEmitter } from 'node:events';
import type { Delta, ProjectState, Task } from '@ai-bridge/shared';
import { pushDelta, touchMeta, trackFile } from './schema';
import type { StateStore } from './store';
import type { T1Host } from './workerHost';
import { buildBoot, verifyAck, type AckCheck, type BootOptions, type BootResult } from './boot';
import { HeuristicT2, mergePatch, type T2Backend, type T2Turn } from './t2';
import { rescanRepo, type RescanResult } from './rescan';
import type { FsPort } from '../repo/ports';

export interface ManagerOptions {
  store: StateStore;
  t1: T1Host;
  log: (level: 'info' | 'warn' | 'error', msg: string, details?: Record<string, unknown>) => void;
  snapshotEvery?: number;
  now?: () => number;
  /** T2 backend. Absent = T2 is off and says so. */
  t2?: T2Backend;
  /** Run T2 every N turns (spec §5.5: every 5). 0 disables. */
  t2Every?: number;
  /** How many turns T2 looks at. */
  t2Window?: number;
  /** Repo port for T3 rescan. Absent = T3 unavailable. */
  fs?: FsPort;
}

export interface T2Outcome {
  ran: boolean;
  backend: string;
  reason?: string;
  counts?: Record<string, number>;
  tookMs?: number;
}

export interface TurnResult {
  deltas: number;
  total: number;
  persisted: boolean;
  tookMs: number;
  threaded: boolean;
}

export class StateManager extends EventEmitter {
  private state!: ProjectState;
  private turns = 0;
  private ready = false;
  private taskSeq = 0;
  /** Rolling transcript for T2 (kept in memory only). */
  private transcript: T2Turn[] = [];
  private lastT2: T2Outcome = { ran: false, backend: 'none', reason: 'not run yet' };

  constructor(private readonly opts: ManagerOptions) {
    super();
  }

  get current(): ProjectState {
    if (!this.ready) throw new Error('ENOINIT: StateManager.init() has not run');
    return this.state;
  }

  get turnCount(): number {
    return this.turns;
  }

  get threaded(): boolean {
    return this.opts.t1.threaded;
  }

  async init(): Promise<{ state: ProjectState; recovered: boolean; reason?: string }> {
    const loaded = await this.opts.store.load();
    this.state = loaded.state;
    this.ready = true;
    this.opts.log(
      loaded.recovered ? 'warn' : 'info',
      `state ready: ${this.state.deltas.length} delta(s), ${this.state.files.length} file(s)${loaded.recovered ? ` (recovered: ${loaded.reason})` : ''}`,
    );
    await this.opts.store.snapshot(this.state, 'init').catch((err: Error) => {
      this.opts.log('warn', `initial snapshot failed: ${err.message}`);
    });
    this.emit('changed', this.state);
    return { state: this.state, recovered: loaded.recovered, reason: loaded.reason };
  }

  /** Feed one turn of conversation through T1 and persist. */
  async turn(role: 'user' | 'assistant' | 'system', text: string): Promise<TurnResult> {
    const started = Date.now();
    if (!this.ready) throw new Error('ENOINIT: StateManager.init() has not run');
    const t = this.opts.now?.() ?? Date.now();

    this.transcript.push({ role, text: text.slice(0, 4000) });
    if (this.transcript.length > 40) this.transcript.splice(0, this.transcript.length - 40);

    const extracted = await this.opts.t1.run({ text, role, t });

    for (const delta of extracted.deltas) pushDelta(this.state, delta);

    // Fold the extraction into the typed slices.
    for (const p of extracted.paths) trackFile(this.state, p, '', role);
    for (const s of extracted.stack) if (!this.state.stack.includes(s)) this.state.stack.push(s);
    for (const c of extracted.constraints) {
      if (!this.state.constraints.includes(c)) this.state.constraints.push(c);
    }
    if (this.state.constraints.length > 40) {
      this.state.constraints.splice(0, this.state.constraints.length - 40);
    }
    for (const todo of extracted.todos) {
      if (this.state.todo.some((x) => x.task === todo)) continue;
      this.state.todo.push({
        id: `t${++this.taskSeq}`,
        task: todo,
        files: extracted.paths.slice(0, 3),
      } satisfies Task);
    }
    for (const done of extracted.dones) {
      const idx = this.state.todo.findIndex((x) => x.task === done);
      if (idx >= 0) {
        const [moved] = this.state.todo.splice(idx, 1);
        this.state.done.push({ ...moved!, state: 'done' });
      } else {
        this.state.done.push({ id: `t${++this.taskSeq}`, task: done, files: [], state: 'done' });
      }
    }
    if (this.state.todo.length > 100) this.state.todo.splice(0, this.state.todo.length - 100);
    if (this.state.done.length > 100) this.state.done.splice(0, this.state.done.length - 100);

    touchMeta(this.state);
    this.turns += 1;

    await this.opts.store.save(this.state).catch((err: Error) => {
      this.opts.log('error', `state save failed: ${err.message}`);
    });

    const every = this.opts.snapshotEvery ?? 10;
    if (every > 0 && this.turns % every === 0) {
      await this.opts.store.snapshot(this.state, `t${this.turns}`).catch((err: Error) => {
        this.opts.log('warn', `snapshot failed: ${err.message}`);
      });
    }

    // T2 on its interval (§5.5: every 5 turns). Failure never breaks the turn.
    const t2Every = this.opts.t2Every ?? 5;
    if (t2Every > 0 && this.turns % t2Every === 0) {
      await this.runT2().catch((err: Error) => {
        this.opts.log('warn', `T2 failed: ${err.message}`);
      });
    }

    const result: TurnResult = {
      deltas: extracted.deltas.length,
      total: this.state.deltas.length,
      persisted: true,
      tookMs: Date.now() - started,
      threaded: this.opts.t1.threaded,
    };
    this.emit('turn', { role, result, state: this.state });
    this.opts.log(
      'info',
      `T1 turn ${this.turns}: +${result.deltas} delta(s) → ${result.total} total, ${result.tookMs} ms${result.threaded ? ' (worker)' : ' (inline)'}`,
    );
    return result;
  }

  /* ------------------------------------------------------------------- T2 */

  get lastT2Outcome(): T2Outcome {
    return this.lastT2;
  }

  /**
   * Run T2 now. Tries the configured backend; if it fails and it is not the
   * heuristic, falls back once so state still advances — and says so.
   */
  async runT2(): Promise<T2Outcome> {
    const started = Date.now();
    const backend = this.opts.t2;
    if (!backend) {
      this.lastT2 = { ran: false, backend: 'none', reason: 'no T2 backend configured' };
      this.opts.log('info', 'T2 skipped: no backend configured');
      return this.lastT2;
    }

    const window = this.transcript.slice(-(this.opts.t2Window ?? 10));
    if (window.length === 0) {
      this.lastT2 = { ran: false, backend: backend.name, reason: 'no turns to summarise' };
      return this.lastT2;
    }

    try {
      const patch = await backend.summarise({ state: this.state, turns: window });
      const counts = mergePatch(this.state, patch, () => `t2-${++this.taskSeq}`, this.opts.log);
      touchMeta(this.state);
      await this.opts.store.save(this.state);
      this.lastT2 = {
        ran: true,
        backend: backend.name,
        counts: counts as unknown as Record<string, number>,
        tookMs: Date.now() - started,
      };
      this.opts.log('info', `T2 done via ${backend.name} in ${this.lastT2.tookMs} ms`);
      this.emit('t2', this.lastT2);
      return this.lastT2;
    } catch (err) {
      const message = (err as Error).message;
      this.opts.log('warn', `T2 backend ${backend.name} failed (${message})`);
      if (backend.name !== 'heuristic') {
        try {
          const fallback = new HeuristicT2();
          const patch = await fallback.summarise({ state: this.state, turns: window });
          const counts = mergePatch(this.state, patch, () => `t2-${++this.taskSeq}`, this.opts.log);
          touchMeta(this.state);
          await this.opts.store.save(this.state);
          this.lastT2 = {
            ran: true,
            backend: 'heuristic (fallback)',
            reason: message,
            counts: counts as unknown as Record<string, number>,
            tookMs: Date.now() - started,
          };
          this.opts.log('warn', 'T2 fell back to the heuristic extractor');
          this.emit('t2', this.lastT2);
          return this.lastT2;
        } catch (inner) {
          this.opts.log('error', `T2 fallback failed too: ${(inner as Error).message}`);
        }
      }
      this.lastT2 = { ran: false, backend: backend.name, reason: message };
      this.emit('t2', this.lastT2);
      return this.lastT2;
    }
  }

  /* ------------------------------------------------------------------- T3 */

  async rescan(): Promise<RescanResult> {
    if (!this.opts.fs) throw new Error('ENOPORT: T3 needs a repo port');
    const result = await rescanRepo(this.state, this.opts.fs, this.opts.log);
    touchMeta(this.state);
    await this.opts.store.save(this.state);
    this.emit('rescan', result);
    return result;
  }

  /* ----------------------------------------------------------------- boot */

  boot(opts: BootOptions = {}): BootResult {
    const result = buildBoot(this.state, opts);
    this.state.meta.bootTokenEstimate = result.tokens;
    this.opts.log(
      'info',
      `boot built: ${result.tokens}/${result.budgetTokens} tokens, sections [${result.sections.join(', ')}]${result.trimmed.length ? ` trimmed [${result.trimmed.join(', ')}]` : ''}`,
    );
    return result;
  }

  /** Did a fresh chat restate DOING/TODO from the boot? (§2.3 uses this too.) */
  ack(answer: string): AckCheck {
    const check = verifyAck(this.state, answer);
    this.opts.log(
      check.ok ? 'info' : 'warn',
      `boot ack: ${check.found.length} restated, ${check.missing.length} missing${check.missing.length ? ` — ${check.missing.slice(0, 3).join('; ')}` : ''}`,
    );
    return check;
  }

  async saveNow(): Promise<void> {
    touchMeta(this.state);
    await this.opts.store.save(this.state);
  }

  async snapshot(label = 'manual'): Promise<string> {
    return this.opts.store.snapshot(this.state, label);
  }

  async snapshots(): Promise<Awaited<ReturnType<StateStore['listSnapshots']>>> {
    return this.opts.store.listSnapshots();
  }

  async restore(name: string): Promise<ProjectState> {
    const restored = await this.opts.store.restore(name);
    this.state = restored;
    await this.opts.store.save(this.state);
    this.emit('changed', this.state);
    this.opts.log('info', `state restored from ${name}`, { deltas: restored.deltas.length });
    return this.state;
  }

  async clear(): Promise<void> {
    this.state.deltas = [] as Delta[];
    this.state.done = [];
    this.state.doing = [];
    this.state.todo = [];
    this.state.files = [];
    this.state.constraints = [];
    this.state.stack = [];
    touchMeta(this.state);
    await this.opts.store.save(this.state);
    this.emit('changed', this.state);
    this.opts.log('warn', 'state cleared (decisions and glossary kept)');
  }

  async dispose(): Promise<void> {
    await this.opts.t1.stop();
  }
}
