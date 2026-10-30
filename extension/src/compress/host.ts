/**
 * Worker host for T0.
 *
 * Same shape as the T1 host (and the same lessons): wait for the worker's ready
 * message rather than sleeping, cap the isolate with `resourceLimits`, and fall
 * back to running the pure function inline if the thread cannot start — loudly,
 * because a compressor silently moving onto the UI thread is a performance
 * change the user should be able to see.
 */

import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { compressT0, type CompressOptions, type CompressResult } from './t0';
import type { CompressReply } from './t0Worker';

export interface CompressHostOptions {
  scriptPath?: string;
  log: (level: 'info' | 'warn' | 'error', msg: string, details?: Record<string, unknown>) => void;
  timeoutMs?: number;
  inline?: boolean;
}

interface Pending {
  resolve: (r: CompressResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class CompressHost {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private warned = false;
  private _threaded = false;

  constructor(private readonly opts: CompressHostOptions) {}

  get threaded(): boolean {
    return this._threaded;
  }

  async start(): Promise<boolean> {
    if (this.opts.inline) {
      this.opts.log('info', 'T0 running inline (threading disabled by option)');
      return false;
    }
    const script = this.opts.scriptPath ?? path.join(__dirname, 't0Worker.js');
    try {
      this.worker = new Worker(script, {
        resourceLimits: {
          codeRangeSizeMb: 16,
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
        },
      });
      this.worker.on('message', (msg: CompressReply | { ready: true }) => {
        if ('ready' in msg) {
          this._threaded = true;
          this.opts.log('info', 'T0 worker ready', { threadId: this.worker?.threadId });
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.ok && msg.result) p.resolve(msg.result);
        else p.reject(new Error(msg.error ?? 'T0 worker failed'));
      });
      this.worker.on('error', (err) => this.onFailure(err));
      this.worker.on('exit', (code) => {
        if (code !== 0) this.onFailure(new Error(`T0 worker exited with code ${code}`));
      });

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
      if (!ready) this.opts.log('warn', 'T0 worker did not report ready — will run inline');
      return this._threaded;
    } catch (err) {
      this.onFailure(err as Error);
      return false;
    }
  }

  private onFailure(err: Error): void {
    this.opts.log('error', `T0 worker failed: ${err.message}`);
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.worker = null;
    this._threaded = false;
  }

  async compress(text: string, opts: CompressOptions = {}): Promise<CompressResult> {
    if (!this.worker) {
      if (!this.warned) {
        this.warned = true;
        this.opts.log('warn', 'T0 is running on the extension-host thread (no worker)');
      }
      return compressT0(text, opts);
    }
    const id = ++this.seq;
    const timeoutMs = this.opts.timeoutMs ?? 3000;
    return new Promise<CompressResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.opts.log('warn', `T0 worker timed out after ${timeoutMs} ms — compressing inline`);
        resolve(compressT0(text, opts));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, text, opts });
    });
  }

  async stop(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    this._threaded = false;
    if (w) await w.terminate().catch(() => undefined);
  }
}
