/**
 * Session lifecycle — create, run, resume, bundle, hand off.
 *
 * Until now a `SessionRunner` could only be constructed by a test. Nothing in the
 * bridge knew what a session was: `control()` had no `ctl.session.*`, the runtime
 * never captured a snapshot, and leases were never taken. This is the missing
 * middle — the layer that owns a session's lifetime so the shell has something to
 * call and the runner has something to be called by.
 *
 * Deliberately thin. It composes the modules that already exist and does not
 * re-implement any of their rules: roster validation is `validateRoster`, the
 * state machine is `transition`, the budget is the scheduler's. Anything that
 * looks like a second copy of a rule belongs in the module that owns it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CdpController } from '../cdp/controller';
import type { AdapterRegistry } from '../adapters/registry';
import type { Logger } from '../logger';
import type { Relay } from './relay';
import type { Dispatch } from './runner';
import { SessionRunner, type RunResult } from './runner';
import type { BundleResult } from './bundle';
import type { ParticipantSpec, RosterConfig, RosterRejection, SessionRecord } from './session';
import { createSession, leaseLedgerFor, loadSession, maintenance, saveState, sessionDir } from './session';
import { captureSnapshot, sliceForPlan, type Snapshot } from '../repo/snapshot';
import { createLiveDispatch } from './liveDispatch';
import type { Page } from '@ai-bridge/shared';

export interface SessionManagerDeps {
  root: string;
  controller: CdpController;
  adapters: AdapterRegistry;
  relay: Pick<Relay, 'sendAndObserve'>;
  log: Logger;
  now?: () => number;
  /**
   * Build the dispatch for a session. Defaults to the live one; a test supplies a
   * fake so the whole lifecycle can be exercised without a browser.
   */
  makeDispatch?: (record: SessionRecord, pageFor: (index: number) => Page | null) => Dispatch;
}

export type CreateResult = { ok: true; record: SessionRecord } | RosterRejection;

export class SessionManager {
  private readonly deps: SessionManagerDeps;
  private readonly runners = new Map<string, SessionRunner>();
  private readonly snapshots = new Map<string, Snapshot>();
  /** participant index → tab id, for the tabs this session has leased. */
  private readonly tabs = new Map<string, Map<number, string>>();

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
  }

  private now(): number {
    return (this.deps.now ?? (() => Date.now()))();
  }

  /**
   * Create a session: validate the roster, freeze the repository if one was
   * given, and write the record. The snapshot is captured here rather than per
   * turn because §10 requires every participant to be judged against the same
   * tree.
   */
  async create(cfg: RosterConfig & { repoRoot?: string }): Promise<CreateResult> {
    const created = createSession(this.deps.root, cfg, this.now());
    if (!created.ok) return created;

    if (cfg.repoRoot) {
      try {
        const snapshot = await captureSnapshot(cfg.repoRoot, { now: this.now() });
        this.snapshots.set(created.record.id, snapshot);
        this.deps.log.info('snapshot captured', {
          sessionId: created.record.id,
          files: snapshot.meta.files,
          skipped: snapshot.meta.skipped.length,
          sha256: snapshot.meta.sha256.slice(0, 12),
        });
      } catch (err) {
        // A session without a snapshot is still a session: the participants
        // debate the plan, and the auditor says so rather than failing to start.
        this.deps.log.warn('snapshot capture failed; the session runs without code', {
          sessionId: created.record.id,
          error: (err as Error).message,
        });
      }
    }

    return { ok: true, record: created.record };
  }

  state(id: string): SessionRecord | null {
    return loadSession(this.deps.root, id);
  }

  /** The snapshot a session was judged against, for the manifest and for tests. */
  snapshotMeta(id: string): Snapshot['meta'] | null {
    return this.snapshots.get(id)?.meta ?? null;
  }

  list(): SessionRecord[] {
    const out: SessionRecord[] = [];
    for (const id of this.sessionIds()) {
      const record = loadSession(this.deps.root, id);
      if (record) out.push(record);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  private sessionIds(): string[] {
    // The manager is not the only writer — the runner writes records too — so the
    // disk is the source of truth for what exists.
    try {
      return fs.readdirSync(path.join(this.deps.root, 'sessions'));
    } catch {
      return [];
    }
  }

  /** Bind a participant to the tab it speaks through. */
  bindTab(sessionId: string, participant: number, tabId: string): void {
    const map = this.tabs.get(sessionId) ?? new Map<number, string>();
    map.set(participant, tabId);
    this.tabs.set(sessionId, map);
    this.deps.controller.pinTab(tabId);
  }

  private pageFor(sessionId: string): (index: number) => Page | null {
    return (index: number) => {
      const tabId = this.tabs.get(sessionId)?.get(index);
      // Only the active page is reachable through the controller today; a
      // per-tab page accessor is a controller change, not a manager one.
      const page = this.deps.controller.activePage;
      if (!tabId || !page) return null;
      return page;
    };
  }

  private runnerFor(record: SessionRecord, dispatch?: Dispatch): SessionRunner {
    const existing = this.runners.get(record.id);
    if (existing && !dispatch) return existing;

    const snapshot = this.snapshots.get(record.id);
    const runner = new SessionRunner({
      root: this.deps.root,
      record,
      dispatch: dispatch ?? this.buildDispatch(record),
      ...(snapshot
        ? {
            snapshot: {
              sliceFor: async (planText: string, role) => {
                const slice = await sliceForPlan(snapshot, planText, role);
                return slice.text;
              },
            },
          }
        : {}),
      now: () => this.now(),
    });
    this.runners.set(record.id, runner);
    return runner;
  }

  private buildDispatch(record: SessionRecord): Dispatch {
    const pageFor = this.pageFor(record.id);
    if (this.deps.makeDispatch) return this.deps.makeDispatch(record, pageFor);
    return createLiveDispatch({
      relay: this.deps.relay,
      adapters: this.deps.adapters,
      pageFor,
      log: this.deps.log,
    });
  }

  /** Take the leases for a session before anything is dispatched. */
  private lease(record: SessionRecord): void {
    const ledger = leaseLedgerFor(record);
    for (const participant of record.participants) {
      const taken = ledger.acquire(participant.index);
      if (!taken.ok) {
        this.deps.log.warn('lease refused', { participant: participant.index, reason: taken.detail });
      }
    }
  }

  async run(id: string, dispatch?: Dispatch): Promise<RunResult | null> {
    const record = loadSession(this.deps.root, id);
    if (!record) return null;
    this.lease(record);
    return this.runnerFor(record, dispatch).run();
  }

  async resume(id: string): Promise<RunResult | null> {
    const runner = this.runners.get(id);
    if (!runner) return null;
    return runner.resume();
  }

  /** Freeze the bundle. The session must have reached a state the machine allows. */
  bundle(id: string): { ok: boolean; bundle?: BundleResult } {
    const runner = this.runners.get(id);
    if (!runner) return { ok: false };
    const snapshot = this.snapshots.get(id);
    return runner.confirmBundle(
      snapshot
        ? { id: snapshot.meta.id, sha256: snapshot.meta.sha256, capturedAt: snapshot.meta.capturedAt }
        : undefined,
    );
  }

  confirmHandoff(id: string): boolean {
    return this.runners.get(id)?.confirmHandoff() ?? false;
  }

  confirmConsensus(id: string): boolean {
    return this.runners.get(id)?.confirmConsensus() ?? false;
  }

  abort(id: string, reason?: string): boolean {
    const runner = this.runners.get(id);
    if (!runner) return false;
    const ok = runner.abort(reason);
    if (ok) {
      // Leases are released and the tabs unpinned: the session no longer owns
      // them, and a pinned tab that nobody is using is a tab nobody can evict.
      for (const tabId of this.tabs.get(id)?.values() ?? []) this.deps.controller.unpinTab(tabId);
      this.tabs.delete(id);
    }
    return ok;
  }

  /** What a starting bridge does to the sessions directory. */
  startup(): { suspended: string[]; collected: string[] } {
    return maintenance(this.deps.root, this.now(), this.now());
  }

  /** Persist an externally decided state, for the ops that change it outside a run. */
  setState(id: string, state: SessionRecord['state'], reason?: string): SessionRecord | null {
    const record = loadSession(this.deps.root, id);
    if (!record) return null;
    return saveState(this.deps.root, record, state, reason, this.now());
  }
}
