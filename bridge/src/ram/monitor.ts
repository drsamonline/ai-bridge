/**
 * RAM monitor — 3 s poll, spec §5.11.
 *
 * Measures the ATTACHED BROWSER's resident set (browser + renderer + GPU +
 * utility processes, pids from CDP), against the 500 MB cap. When CDP will not
 * hand over process info, it falls back to the OS process tree rooted at the
 * process carrying the debugging flag.
 */

import { EventEmitter } from 'node:events';
import type { BrowserMemory, RamSample } from '@ai-bridge/shared';
import type { CdpController } from '../cdp/controller';
import type { Logger } from '../logger';
import { findBrowserRootPid, readRss, treeRss } from './memory';

export interface RamMonitorOptions {
  controller: CdpController;
  capBytes: number;
  pollMs: number;
  log: Logger;
}

export class RamMonitor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private last: RamSample | null = null;
  private _capBytes: number;
  private _pollMs: number;
  private consecutiveHigh = 0;
  private loggedNote: string | null = null;

  constructor(private readonly opts: RamMonitorOptions) {
    super();
    this._capBytes = opts.capBytes;
    this._pollMs = opts.pollMs;
  }

  get capBytes(): number {
    return this._capBytes;
  }

  get pollMs(): number {
    return this._pollMs;
  }

  setCap(bytes: number): void {
    this._capBytes = Math.max(1, bytes);
  }

  setPoll(ms: number): void {
    this._pollMs = Math.max(250, ms);
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  /** Consecutive samples at or above the warn threshold — lets the watchdog escalate. */
  get highStreak(): number {
    return this.consecutiveHigh;
  }

  latest(): RamSample | null {
    return this.last;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this._pollMs);
    this.timer.unref();
    void this.tick();
    this.opts.log.info('RAM monitor started', { pollMs: this._pollMs, capMB: mb(this._capBytes) });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      const sample = await this.sample();
      this.last = sample;
      if (sample.level === 'ok') this.consecutiveHigh = 0;
      else this.consecutiveHigh += 1;
      this.emit('sample', sample);
    } catch (err) {
      this.opts.log.warn(`RAM sample failed: ${(err as Error).message}`);
    }
  }

  async sample(): Promise<RamSample> {
    const controller = this.opts.controller;
    let browser: BrowserMemory = {
      totalBytes: 0,
      rendererBytes: 0,
      processCount: 0,
      source: 'unavailable',
      byPid: {},
    };

    if (controller.attached) {
      const procs = await controller.processPids();
      if (procs.length) {
        const reading = readRss(procs.map((p) => p.pid));
        const rendererPids = new Set(procs.filter((p) => p.type === 'renderer').map((p) => p.pid));
        let total = 0;
        let renderer = 0;
        const byPid: Record<number, number> = {};
        for (const [pid, bytes] of reading.byPid) {
          total += bytes;
          byPid[pid] = bytes;
          if (rendererPids.has(pid)) renderer += bytes;
        }
        browser = {
          totalBytes: total,
          rendererBytes: renderer,
          processCount: reading.byPid.size,
          source: reading.source,
          byPid,
        };
        if (reading.note && reading.note !== this.loggedNote) {
          this.loggedNote = reading.note;
          this.opts.log.warn(`RSS metric: ${reading.note}`);
        }
      } else {
        // CDP refused process info — walk the OS tree from the debug port.
        const port = controller.attachedPort;
        const root = port !== null ? findBrowserRootPid(port) : null;
        if (root !== null) {
          const reading = treeRss(root);
          let total = 0;
          const byPid: Record<number, number> = {};
          for (const [pid, bytes] of reading.byPid) {
            total += bytes;
            byPid[pid] = bytes;
          }
          browser = {
            totalBytes: total,
            rendererBytes: 0,
            processCount: reading.byPid.size,
            source: reading.source,
            byPid,
          };
          this.opts.log.debug('RSS via process tree fallback', { root, source: reading.source });
        }
      }
    }

    const percent = Math.round((browser.totalBytes / this._capBytes) * 1000) / 10;
    const level = percent >= 100 ? 'block' : percent >= 80 ? 'warn' : 'ok';
    return { t: Date.now(), browser, capBytes: this._capBytes, percent, level };
  }
}

export function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
