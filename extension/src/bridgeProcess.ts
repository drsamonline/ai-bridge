/**
 * Bridge process supervisor (extension side).
 *
 * Spawns `node <repo>/bridge/dist/main.js`, pipes its stdout/stderr into the
 * "AI Bridge" Output channel line by line, and resolves once the bridge prints
 * its machine-readable ready line.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { clearLock, isPidAlive, lockDir, readLock } from '@ai-bridge/shared';

export interface BridgeProcessOptions {
  extensionPath: string;
  port: number;
  logLevel: string;
  onLine: (line: string, stream: 'stdout' | 'stderr') => void;
  readyTimeoutMs?: number;
}

export interface ReadyInfo {
  port: number;
  pid: number;
  lock: string;
}

export class BridgeProcess {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private readyInfo: ReadyInfo | null = null;

  constructor(private readonly opts: BridgeProcessOptions) {}

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed;
  }

  get info(): ReadyInfo | null {
    return this.readyInfo;
  }

  /** Absolute path to the compiled bridge entry. */
  resolveEntry(): string {
    const candidates = [
      path.join(this.opts.extensionPath, '..', 'bridge', 'dist', 'main.js'),
      path.join(this.opts.extensionPath, 'bridge', 'dist', 'main.js'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return path.resolve(c);
    }
    throw new Error(
      `bridge entry not found (looked in ${candidates.join(', ')}) — run "npm run build" in the repo root`,
    );
  }

  async start(): Promise<ReadyInfo> {
    if (this.running && this.readyInfo) return this.readyInfo;

    // If a healthy bridge already owns the lock, adopt it instead of forking.
    try {
      const existing = readLock().lock;
      if (isPidAlive(existing.pid)) {
        this.opts.onLine(
          `[ext] existing bridge detected pid=${existing.pid} port=${existing.port} — adopting`,
          'stdout',
        );
        this.readyInfo = { port: existing.port, pid: existing.pid, lock: path.join(lockDir(), 'lock.json') };
        return this.readyInfo;
      }
      this.opts.onLine(`[ext] clearing stale lock pid=${existing.pid}`, 'stdout');
      clearLock(existing.pid);
    } catch {
      /* no lock — normal cold start */
    }

    const entry = this.resolveEntry();
    this.opts.onLine(`[ext] spawning bridge: node ${entry}`, 'stdout');

    const child = spawn(process.execPath, [entry], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AI_BRIDGE_PORT: String(this.opts.port),
        AI_BRIDGE_LOG_LEVEL: this.opts.logLevel,
        ELECTRON_RUN_AS_NODE: '1',
      },
    });
    this.child = child;

    const ready = new Promise<ReadyInfo>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('bridge did not report ready within 10s')),
        this.opts.readyTimeoutMs ?? 10_000,
      );

      let buf = '';
      const onChunk = (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          this.opts.onLine(line, 'stdout');
          if (line.startsWith('AI_BRIDGE_READY ')) {
            try {
              const info = JSON.parse(line.slice('AI_BRIDGE_READY '.length)) as ReadyInfo;
              clearTimeout(timer);
              this.readyInfo = info;
              resolve(info);
            } catch {
              /* keep waiting */
            }
          }
        }
      };
      child.stdout.on('data', onChunk);
      child.stderr.on('data', (c: Buffer) => {
        for (const line of c.toString().split('\n')) {
          if (line.trim()) this.opts.onLine(line, 'stderr');
        }
      });

      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        this.opts.onLine(
          `[ext] bridge exited code=${code} signal=${signal}`,
          code === 0 ? 'stdout' : 'stderr',
        );
        this.child = null;
        this.readyInfo = null;
        reject(new Error(`bridge exited before ready (code=${code})`));
      });
      child.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    return ready;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.opts.onLine('[ext] stopping bridge (SIGTERM)', 'stdout');
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once('exit', done);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 3_000);
    });
    this.child = null;
    this.readyInfo = null;
  }
}
