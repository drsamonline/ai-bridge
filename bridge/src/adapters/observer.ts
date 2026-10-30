/**
 * Response observer — spec §5.4.
 *
 * A MutationObserver installed in the page reports the newest assistant turn as
 * it changes; the debounce and the settle decision live here in Node so the
 * policy sits in one place and is testable.
 *
 * Settle rule, in priority order:
 *   1. copy-button sentinel present AND no streaming signal    → done
 *   2. stop button gone AND streaming flag gone                → done
 *   3. text unchanged for `debounceMs`                          → done (degraded)
 *
 * Every change is also pushed as a delta, so the panel streams instead of
 * waiting for the whole answer.
 */

import type { Page } from 'playwright-core';
import type { Logger } from '../logger';

export interface ObserveSelectors {
  assistantTurn: string[];
  markdown: string[];
  copySentinel: string[];
  stopButton: string[];
  streamingFlag: string[];
}

export interface ObserveOptions {
  debounceMs?: number;
  /** Hard stop; resolves with whatever text exists. */
  timeoutMs?: number;
  onDelta?: (text: string, meta: { elapsedMs: number; streaming: boolean }) => void;
}

export interface ObserveResult {
  text: string;
  firstTokenMs: number | null;
  totalMs: number;
  settledBy: 'sentinel' | 'stop-gone' | 'debounce' | 'timeout';
}

interface Snapshot {
  text: string;
  streaming: boolean;
  copy: boolean;
  stop: boolean;
  turns: number;
}

/**
 * Installed into the page. Must be self-contained: it is serialised with
 * toString() and evaluated in the browser, so it may not close over Node state.
 */
function installObserver(args: { sel: ObserveSelectors; binding: string }) {
  const w = window as unknown as Record<string, unknown>;
  if (w.__aiBridgeObserver) return 'already-installed';

  // Presence is not visibility: ChatGPT keeps the stop button in the DOM and
  // hides it, so a settled turn would otherwise never look settled.
  const visible = (el: Element | null): boolean => {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const pick = (candidates: string[], root: ParentNode): Element | null => {
    for (const c of candidates) {
      try {
        const el = root.querySelector(c);
        if (el) return el;
      } catch {
        /* invalid selector for this page — skip */
      }
    }
    return null;
  };

  const pickVisible = (candidates: string[], root: ParentNode): Element | null => {
    for (const c of candidates) {
      try {
        const el = root.querySelector(c);
        if (visible(el)) return el;
      } catch {
        /* skip */
      }
    }
    return null;
  };

  const turns = () => {
    const out: Element[] = [];
    for (const c of args.sel.assistantTurn) {
      try {
        document.querySelectorAll(c).forEach((el) => out.push(el));
      } catch {
        /* skip */
      }
    }
    return out;
  };

  const snapshot = () => {
    const all = turns();
    const turn = all.length ? all[all.length - 1]! : null;
    const md = turn ? pick(args.sel.markdown, turn) ?? turn : null;
    return {
      text: md ? (md as HTMLElement).innerText.trim() : '',
      streaming: turn ? pickVisible(args.sel.streamingFlag, turn) !== null : false,
      copy: turn ? pickVisible(args.sel.copySentinel, turn) !== null : false,
      stop: pickVisible(args.sel.stopButton, document) !== null,
      turns: all.length,
    };
  };

  let pending: ReturnType<typeof setTimeout> | null = null;
  const emit = () => {
    const push = w[args.binding] as ((p: Snapshot) => void) | undefined;
    if (typeof push === 'function') push(snapshot());
  };
  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      emit();
    }, 50);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'data-testid', 'aria-label', 'disabled', 'aria-busy'],
  });

  w.__aiBridgeObserver = { observer, snapshot, dispose: () => observer.disconnect() };
  emit();
  return 'installed';
}

const INSTALL_SOURCE = `(${installObserver.toString()})`;
const SNAPSHOT_SOURCE = `(() => { const s = window.__aiBridgeObserver; return s ? s.snapshot() : null; })()`;

export class ResponseObserver {
  private installed = new WeakSet<Page>();
  private latest: Snapshot | null = null;

  constructor(private readonly log: Logger) {}

  /** Install once per page, with that adapter's selector map. */
  private async ensure(page: Page, selectors: ObserveSelectors): Promise<void> {
    if (this.installed.has(page)) return;
    try {
      await page.exposeBinding('__aiBridgePush', (_source, payload: Snapshot) => {
        this.latest = payload;
      });
    } catch (err) {
      // Already bound (e.g. a recycled page reuse) — the DOM poll covers us.
      this.log.debug(`exposeBinding skipped: ${(err as Error).message}`);
    }
    const args = JSON.stringify({ sel: selectors, binding: '__aiBridgePush' });
    const res = await page.evaluate(`${INSTALL_SOURCE}(${args})`);
    this.log.debug(`observer ${String(res)}`);
    this.installed.add(page);
  }

  async observe(page: Page, selectors: ObserveSelectors, opts: ObserveOptions = {}): Promise<ObserveResult> {
    const debounceMs = Math.min(1500, Math.max(600, opts.debounceMs ?? 900));
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const startedAt = Date.now();

    await this.ensure(page, selectors);

    return new Promise<ObserveResult>((resolve) => {
      let lastText = '';
      let lastChangeAt = Date.now();
      let firstTokenMs: number | null = null;
      let settled = false;
      let pushTimer: NodeJS.Timeout | null = null;
      let domTimer: NodeJS.Timeout | null = null;
      let hardTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (pushTimer) clearInterval(pushTimer);
        if (domTimer) clearInterval(domTimer);
        if (hardTimer) clearTimeout(hardTimer);
        pushTimer = domTimer = hardTimer = null;
      };

      const finish = (settledBy: ObserveResult['settledBy']) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ text: lastText, firstTokenMs, totalMs: Date.now() - startedAt, settledBy });
      };

      const consider = (snap: Snapshot | null) => {
        if (settled || !snap) return;

        if (snap.text !== lastText) {
          if (snap.text.length > 0 && firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
          lastText = snap.text;
          lastChangeAt = Date.now();
          opts.onDelta?.(lastText, {
            elapsedMs: Date.now() - startedAt,
            streaming: snap.streaming || snap.stop,
          });
        }
        if (lastText.length === 0) return;

        const quiet = Date.now() - lastChangeAt;
        const stillStreaming = snap.streaming || snap.stop;

        // 1. copy-button sentinel: the turn is finished and interactive.
        if (snap.copy && !stillStreaming && quiet >= Math.min(debounceMs, 400)) {
          finish('sentinel');
          return;
        }
        // 2. stop button gone and no streaming flag.
        if (!snap.stop && !snap.streaming && quiet >= Math.min(debounceMs, 600)) {
          finish('stop-gone');
          return;
        }
        // 3. pure text stability (degraded, e.g. a page that strips the chrome).
        if (quiet >= debounceMs) finish('debounce');
      };

      // Primary channel: MutationObserver → exposed binding.
      pushTimer = setInterval(() => {
        const snap = this.latest;
        this.latest = null;
        consider(snap);
      }, 50);

      // Fallback channel: read the DOM directly if the binding is unavailable.
      domTimer = setInterval(() => {
        void page
          .evaluate(SNAPSHOT_SOURCE)
          .then((snap) => consider(snap as Snapshot | null))
          .catch(() => undefined);
      }, 250);

      hardTimer = setTimeout(() => finish('timeout'), timeoutMs);
    });
  }
}
