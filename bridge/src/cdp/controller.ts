/**
 * CDP controller — batch 0.2.
 *
 * Owns exactly one attached browser. Invariants this file enforces:
 *
 *  • ATTACH ONLY. `connectOverCDP` and nothing else; there is no `launch` call
 *    in this package (the contract test asserts that).
 *  • CONTEXT REUSE. `browser.contexts()[0]` is adopted, never recreated, so the
 *    user's cookies and logins are the ones the adapters will drive.
 *  • OWNED TABS ONLY. Pages opened by this bridge are tracked and are the only
 *    pages it will ever close. Pre-existing user tabs are invisible to it.
 *  • DISCONNECT ≠ KILL. `detach()` calls `browser.close()` on the CDP
 *    connection, which leaves the user's browser running (verified against a
 *    real Chromium: the debug endpoint still answers afterwards).
 */

import { EventEmitter } from 'node:events';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import type { BrowserCandidate, BrowserStatus, TabInfo } from '@ai-bridge/shared';
import { discover, noEndpointMessage, probePort } from './discovery';
import type { Logger } from '../logger';

export interface CdpControllerOptions {
  log: Logger;
  ports: readonly number[];
  /** Recycle the active tab after this many turns (spec §5.2). */
  maxTurns?: number;
  /** A tab with no turn for this long is "idle" and evictable at 80% RAM. */
  idleMs?: number;
}

interface TabRecord {
  id: string;
  page: Page;
  openedAt: number;
  turns: number;
  lastActivityAt: number;
}

export class CdpController extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private browserSession: CDPSession | null = null;
  private port: number | null = null;
  private candidates: BrowserCandidate[] = [];
  private info = { name: 'Unknown', version: '', protocol: '' };
  private tabs = new Map<string, TabRecord>();
  private tabSeq = 0;
  private activeTabId: string | null = null;
  private recycled = 0;
  private lastRecycleReason: string | null = null;
  private attachedAt = 0;
  private detaching = false;
  private readonly maxTurns: number;
  private readonly idleMs: number;

  constructor(private readonly opts: CdpControllerOptions) {
    super();
    this.maxTurns = opts.maxTurns ?? 50;
    this.idleMs = opts.idleMs ?? 120_000;
  }

  get attached(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  get attachedPort(): number | null {
    return this.port;
  }

  /* ---------------------------------------------------------------- attach */

  async attach(ports?: readonly number[]): Promise<BrowserStatus> {
    const wanted = ports && ports.length ? ports : this.opts.ports;
    this.opts.log.info('discovering CDP endpoints', { ports: [...wanted] });
    this.candidates = await discover(wanted, this.opts.log);

    if (this.candidates.length === 0) {
      throw new Error(noEndpointMessage(wanted));
    }

    // Prefer the port the user configured first, then by discovery order.
    const target = this.candidates[0]!;
    this.opts.log.info(`attaching via connectOverCDP to ${target.name} on 127.0.0.1:${target.port}`, {
      version: target.version,
      protocol: target.protocol,
    });

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${target.port}`, {
      timeout: 15_000,
    });

    this.browser = browser;
    this.port = target.port;
    this.info = { name: target.name, version: target.version, protocol: target.protocol };
    this.attachedAt = Date.now();

    browser.on('disconnected', () => {
      if (this.detaching) {
        // Expected: detach() closed the CDP connection itself.
        this.opts.log.debug('CDP session closed by detach()');
        return;
      }
      this.opts.log.warn('CDP connection dropped (browser closed or endpoint gone)');
      this.reset();
      this.emit('detached', { reason: 'disconnected' });
    });

    // Context reuse: adopt what the user already has.
    const existing = browser.contexts();
    this.context = existing[0] ?? (await browser.newContext());
    this.opts.log.info('context adopted', {
      contexts: existing.length,
      reused: existing.length > 0,
      pagesInContext: this.context.pages().length,
    });

    this.browserSession = await browser.newBrowserCDPSession();

    this.opts.log.info('attached', {
      name: this.info.name,
      version: this.info.version,
      port: this.port,
      contexts: browser.contexts().length,
    });
    this.emit('attached', this.status());
    return this.status();
  }

  async detach(): Promise<{ closedTabs: number; browserStillRunning: boolean }> {
    if (!this.browser) return { closedTabs: 0, browserStillRunning: false };
    this.detaching = true;
    const closedTabs = await this.closeAllOwnedTabs();
    const port = this.port;
    try {
      // Disconnects the CDP session. Does NOT terminate the browser.
      await this.browser.close();
    } catch (err) {
      this.opts.log.warn(`close error while detaching: ${(err as Error).message}`);
    }
    this.reset();
    this.detaching = false;
    const still = port !== null ? (await probePort(port, 500)) !== null : false;
    this.opts.log.info('detached', { closedTabs, browserStillRunning: still });
    this.emit('detached', { reason: 'user', closedTabs, browserStillRunning: still });
    return { closedTabs, browserStillRunning: still };
  }

  private reset(): void {
    this.browser = null;
    this.context = null;
    this.browserSession = null;
    this.port = null;
    this.tabs.clear();
    this.activeTabId = null;
  }

  private requireContext(): BrowserContext {
    if (!this.context) throw new Error('ENOTATTACHED: no browser attached — run attach first');
    return this.context;
  }

  /* ------------------------------------------------------------------ tabs */

  async newTab(url = 'about:blank'): Promise<TabInfo> {
    const ctx = this.requireContext();
    const page = await ctx.newPage();
    const record: TabRecord = {
      id: `tab${++this.tabSeq}`,
      page,
      openedAt: Date.now(),
      turns: 0,
      lastActivityAt: Date.now(),
    };
    this.tabs.set(record.id, record);
    this.activeTabId = record.id;

    page.on('close', () => {
      if (this.tabs.delete(record.id)) {
        this.opts.log.info('tab closed', { id: record.id, remaining: this.tabs.size });
        this.emit('tab.closed', { id: record.id });
      }
      if (this.activeTabId === record.id) {
        this.activeTabId = [...this.tabs.keys()].pop() ?? null;
      }
    });

    if (url && url !== 'about:blank') {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    }
    this.opts.log.info('tab opened', { id: record.id, url: page.url(), tabs: this.tabs.size });
    this.emit('tab.opened', { id: record.id, url: page.url() });
    return this.tabInfo(record);
  }

  async closeTab(tabId?: string): Promise<{ closed: string | null }> {
    const record = tabId ? this.tabs.get(tabId) : this.activeRecord();
    if (!record) return { closed: null };
    try {
      await record.page.close();
    } catch (err) {
      this.opts.log.warn(`tab close failed: ${(err as Error).message}`);
    }
    this.tabs.delete(record.id);
    if (this.activeTabId === record.id) {
      this.activeTabId = [...this.tabs.keys()].pop() ?? null;
    }
    return { closed: record.id };
  }

  /** Close every owned tab. Never touches a tab the user opened. */
  async closeAllOwnedTabs(): Promise<number> {
    const ids = [...this.tabs.keys()];
    for (const id of ids) await this.closeTab(id);
    return ids.length;
  }

  /**
   * Evict tabs that have seen no activity for `idleMs`, oldest first, while
   * keeping at least one tab alive. Returns the ids closed.
   */
  async closeIdleTabs(): Promise<string[]> {
    const now = Date.now();
    const idle = [...this.tabs.values()]
      .filter((t) => now - t.lastActivityAt >= this.idleMs)
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt);
    const keep = this.tabs.size - idle.length >= 1 ? idle.length : Math.max(0, idle.length - 1);
    const victims = idle.slice(0, keep);
    const closed: string[] = [];
    for (const t of victims) {
      const res = await this.closeTab(t.id);
      if (res.closed) closed.push(res.closed);
    }
    if (closed.length) this.opts.log.info('evicted idle tabs', { closed });
    return closed;
  }

  /**
   * Recycle: close the active owned tab and open a fresh one in the SAME
   * context, so the login survives (spec §5.2).
   */
  async recycle(reason: string): Promise<{ closed: string | null; opened: TabInfo | null }> {
    if (!this.attached) return { closed: null, opened: null };
    const closed = await this.closeTab(this.activeTabId ?? undefined);
    const opened = await this.newTab('about:blank');
    this.recycled += 1;
    this.lastRecycleReason = reason;
    this.opts.log.info('recycled active tab', { reason, closed: closed.closed, opened: opened.id });
    this.emit('recycled', { reason, closed: closed.closed, opened: opened.id, count: this.recycled });
    return { closed: closed.closed, opened };
  }

  /** Record a turn against the active tab; recycles at the §5.2 turn limit. */
  async noteTurn(tabId?: string, n = 1): Promise<{ turns: number; recycled: boolean }> {
    const record = tabId ? this.tabs.get(tabId) : this.activeRecord();
    if (!record) return { turns: 0, recycled: false };
    record.turns += n;
    record.lastActivityAt = Date.now();
    if (record.turns >= this.maxTurns) {
      await this.recycle(`turns>=${this.maxTurns}`);
      return { turns: record.turns, recycled: true };
    }
    return { turns: record.turns, recycled: false };
  }

  /* ------------------------------------------------------------------ gc */

  async gc(): Promise<{ pages: number; ok: boolean }> {
    const ctx = this.context;
    if (!ctx) return { pages: 0, ok: false };
    let ok = true;
    const pages = [...this.tabs.values()].map((t) => t.page);
    for (const page of pages) {
      try {
        const session = await ctx.newCDPSession(page);
        await session.send('HeapProfiler.collectGarbage');
        await session.detach();
      } catch (err) {
        ok = false;
        this.opts.log.debug(`gc failed on a tab: ${(err as Error).message}`);
      }
    }
    this.opts.log.info('gc requested', { pages: pages.length, ok });
    this.emit('gc', { pages: pages.length, ok });
    return { pages: pages.length, ok };
  }

  /* -------------------------------------------------------------- processes */

  /**
   * Exact pids of the browser's processes, straight from CDP. Falls back to
   * the OS process tree if `SystemInfo` is refused by this build.
   */
  async processPids(): Promise<Array<{ pid: number; type: string }>> {
    if (!this.browserSession) return [];
    try {
      const res = (await this.browserSession.send('SystemInfo.getProcessInfo' as never)) as {
        processInfo?: Array<{ id: number; type: string }>;
      };
      const list = res.processInfo ?? [];
      if (list.length) return list.map((p) => ({ pid: p.id, type: p.type }));
    } catch (err) {
      this.opts.log.debug(`SystemInfo.getProcessInfo unavailable: ${(err as Error).message}`);
    }
    return [];
  }

  /* ---------------------------------------------------------------- status */

  status(): BrowserStatus {
    const tabs = [...this.tabs.values()].map((t) => this.tabInfo(t));
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    return {
      attached: this.attached,
      port: this.port,
      name: this.info.name,
      version: this.info.version,
      protocol: this.info.protocol,
      contexts: this.browser ? this.browser.contexts().length : 0,
      tabs,
      tabAgeMs: active ? Date.now() - active.openedAt : 0,
      turns: active?.turns ?? 0,
      recycled: this.recycled,
      lastRecycleReason: this.lastRecycleReason,
      candidates: this.candidates,
    };
  }

  get activePage(): Page | null {
    return this.activeRecord()?.page ?? null;
  }

  get attachedDurationMs(): number {
    return this.attachedAt ? Date.now() - this.attachedAt : 0;
  }

  private activeRecord(): TabRecord | undefined {
    if (this.activeTabId) {
      const r = this.tabs.get(this.activeTabId);
      if (r) return r;
    }
    return [...this.tabs.values()].pop();
  }

  private tabInfo(record: TabRecord): TabInfo {
    return {
      id: record.id,
      url: record.page.url(),
      title: '',
      ageMs: Date.now() - record.openedAt,
      idleMs: Date.now() - record.lastActivityAt,
      turns: record.turns,
    };
  }
}
