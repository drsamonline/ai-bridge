/**
 * Watchdog — spec §5.11.
 *
 *   80% of cap  → evict idle owned tabs, force GC, report what was freed
 *   100% of cap → block new requests, raise the banner
 *   back to ok  → unblock
 *
 * Escalation, not repetition: one warn cycle evicts and collects. If the next
 * sample is still at or above the warn line, the active tab is recycled in the
 * same context (§5.2's "80% RSS" recycle trigger), which is the only remaining
 * lever short of detaching.
 */

import { EventEmitter } from 'node:events';
import type { RamLevel, RamSample } from '@ai-bridge/shared';
import type { CdpController } from './cdp/controller';
import type { RamMonitor } from './ram/monitor';
import { mb } from './ram/monitor';
import type { Logger } from './logger';

export interface WatchdogOptions {
  monitor: RamMonitor;
  controller: CdpController;
  log: Logger;
  warnRatio?: number;
  blockRatio?: number;
}

export class Watchdog extends EventEmitter {
  private _level: RamLevel = 'ok';
  private _blocked = false;
  private warnRatio: number;
  private blockRatio: number;
  private escalated = false;

  constructor(private readonly opts: WatchdogOptions) {
    super();
    this.warnRatio = opts.warnRatio ?? 0.8;
    this.blockRatio = opts.blockRatio ?? 1.0;
  }

  get level(): RamLevel {
    return this._level;
  }

  get blocked(): boolean {
    return this._blocked;
  }

  setThresholds(warnRatio: number, blockRatio: number): void {
    this.warnRatio = Math.min(0.99, Math.max(0.1, warnRatio));
    this.blockRatio = Math.max(this.warnRatio + 0.01, blockRatio);
    this.opts.log.info('watchdog thresholds updated', {
      warnRatio: this.warnRatio,
      blockRatio: this.blockRatio,
    });
  }

  start(): void {
    this.opts.monitor.on('sample', (s: RamSample) => void this.onSample(s));
    this.opts.log.info('watchdog armed', {
      warn: `${Math.round(this.warnRatio * 100)}%`,
      block: `${Math.round(this.blockRatio * 100)}%`,
    });
  }

  private async onSample(sample: RamSample): Promise<void> {
    const ratio = sample.browser.totalBytes / Math.max(1, sample.capBytes);
    const next: RamLevel = ratio >= this.blockRatio ? 'block' : ratio >= this.warnRatio ? 'warn' : 'ok';

    if (next === 'block' && !this._blocked) {
      this._blocked = true;
      this._level = 'block';
      this.opts.log.error('RAM cap reached — requests blocked', {
        usedMB: mb(sample.browser.totalBytes),
        capMB: mb(sample.capBytes),
        percent: sample.percent,
      });
      this.emit('block', {
        percent: sample.percent,
        usedBytes: sample.browser.totalBytes,
        capBytes: sample.capBytes,
        source: sample.browser.source,
      });
      await this.opts.controller.gc();
      return;
    }

    if (next === 'warn' && this._level !== 'warn' && this._level !== 'block') {
      this._level = 'warn';
      this.opts.log.warn('RAM at 80% — evicting idle tabs and collecting garbage', {
        usedMB: mb(sample.browser.totalBytes),
        capMB: mb(sample.capBytes),
        percent: sample.percent,
      });
      const evicted = await this.opts.controller.closeIdleTabs();
      const gc = await this.opts.controller.gc();
      const after = await this.opts.monitor.sample();
      const freedBytes = Math.max(0, sample.browser.totalBytes - after.browser.totalBytes);
      this.emit('warn', {
        percent: sample.percent,
        afterPercent: after.percent,
        usedBytes: sample.browser.totalBytes,
        capBytes: sample.capBytes,
        evicted,
        gcPages: gc.pages,
        freedBytes,
      });
      return;
    }

    if (next === 'warn' && this._level === 'warn' && !this.escalated && this.opts.controller.attached) {
      // Still high after eviction + GC: recycle the active tab in place.
      this.escalated = true;
      this.opts.log.warn('still above 80% after eviction — recycling active tab');
      const res = await this.opts.controller.recycle('ram>=80%');
      const after = await this.opts.monitor.sample();
      this.emit('warn', {
        percent: sample.percent,
        afterPercent: after.percent,
        usedBytes: sample.browser.totalBytes,
        capBytes: sample.capBytes,
        evicted: res.closed ? [res.closed] : [],
        gcPages: 0,
        freedBytes: Math.max(0, sample.browser.totalBytes - after.browser.totalBytes),
        escalated: true,
      });
      return;
    }

    if (next === 'ok') {
      const wasBlocked = this._blocked;
      const wasLevel = this._level;
      this._blocked = false;
      this._level = 'ok';
      this.escalated = false;
      if (wasBlocked || wasLevel !== 'ok') {
        this.opts.log.info('RAM back under the warn line — unblocked', { percent: sample.percent });
        this.emit('ok', { percent: sample.percent, wasBlocked });
      }
    }
  }
}
