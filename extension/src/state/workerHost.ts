/**
 * Worker host for T1.
 *
 * Owns the thread, correlates replies, restarts once on crash, and — if the
 * worker cannot start at all — falls back to running the same pure function
 * inline. The fallback is logged loudly: T1 degrading to the main thread is a
 * performance change the user should be able to see, not a silent one.
 */

import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { extractT1, type T1Input, type T1Result } from './extract';
import type { T1Reply } from './t1Worker';

export interface T1HostOptions {
  /** Defaults to the compiled worker next to this file. */
  scriptPath?: string;
  log: (level: 'info' | 'warn' | 'error', msg: string, details?: Record<string, unknown>) => void;
  timeoutMs?: number;
  /** Disable threading (tests, or platforms where worker_threads misbehaves). */
  inline?: boolean;
}

interface Pending {
  resolve: (r: T1Result) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class T1Host {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private restarts = 0;
  private warned = false;
  private _threaded = false;
  private stopping = false;

  constructor(private readonly opts: T1HostOptions) {}

  get threaded(): boolean {
    return this._threaded;
  }

  get isAlive(): boolean {
    return this.worker !== null;
  }

  async start(): Promise<boolean> {
    if (this.opts.inline) {
      this.opts.log('info', 'T1 running inline (threading disabled by option)');
      return false;
    }
    const script = this.opts.scriptPath ?? path.join(__dirname, 't1Worker.js');
    try {
      // Cap the isolate: a regex extractor needs no more, and an unbounded code
      // range is what fails first on hosts with a tight virtual-address limit
      // (a 1.5 GB `ulimit -v` aborts the thread before it starts).
      this.worker = new Worker(script, {
        resourceLimits: {
          codeRangeSizeMb: 16,
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
        },
      });
      this.worker.on('message', (msg: T1Reply | { ready: true }) => {
        if ('ready' in msg) {
          this._threaded = true;
          this.opts.log('info', 'T1 worker ready', { threadId: this.worker?.threadId });
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.ok && msg.result) p.resolve(msg.result);
        else p.reject(new Error(msg.error ?? 'T1 worker failed'));
      });
      this.worker.on('error', (err) => this.onFailure(err));
      this.worker.on('exit', (code) => {
        if (this.stopping) return; // terminate() during shutdown is not a failure
        if (code !== 0) this.onFailure(new Error(`T1 worker exited with code ${code}`));
      });
      // Wait for the worker to announce itself rather than guessing with a sleep.
      const ready = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), this.opts.timeoutMs ?? 2000);
        const onMsg = (msg: unknown) => {
          if (msg && typeof msg === 'object' && 'ready' in msg) {
            clearTimeout(timer);
            this.worker?.off('message', onMsg);
            resolve(true);
          }
        };
        this.worker!.on('message', onMsg);
      });
      if (!ready) this.opts.log('warn', 'T1 worker did not report ready in time — will run inline');
      return this._threaded;
    } catch (err) {
      this.onFailure(err as Error);
      return false;
    }
  }

  private onFailure(err: Error): void {
    this.opts.log('error', `T1 worker failed: ${err.message}`);
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.worker = null;
    this._threaded = false;
    if (this.restarts < 1) {
      this.restarts += 1;
      this.opts.log('warn', 'restarting T1 worker once');
      void this.start();
    }
  }

  async run(input: T1Input): Promise<T1Result> {
    if (!this.worker) {
      if (!this.warned) {
        this.warned = true;
        this.opts.log('warn', 'T1 is running on the extension-host thread (no worker)');
      }
      return extractT1(input);
    }
    const id = ++this.seq;
    const timeoutMs = this.opts.timeoutMs ?? 2000;
    return new Promise<T1Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.opts.log('warn', `T1 worker timed out after ${timeoutMs} ms — extracting inline`);
        resolve(extractT1(input));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, input });
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const w = this.worker;
    this.worker = null;
    this._threaded = false;
    if (w) {
      await w.terminate().catch(() => undefined);
      this.opts.log('info', 'T1 worker stopped');
    }
  }
}
