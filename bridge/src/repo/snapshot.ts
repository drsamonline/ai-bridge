/**
 * The snapshot provider — SPEC v6 §10, and the glue that was missing.
 *
 * `reader.ts` reads a repository, `slice.ts` ranks and budgets a slice of it, and
 * `nodeFsPort.ts` gives the bridge a filesystem. Nothing connected the three, so
 * `DispatchRequest.snapshotText` was always empty and every participant debated a
 * plan with no code in front of it — the auditor included, which is the whole
 * point of the auditor.
 *
 * Two calls, deliberately separate. `captureSnapshot` happens once at session
 * start and produces the frozen thing the manifest names. `sliceForPlan` happens
 * every turn, because the plan changes and the slice should follow it.
 */

import * as crypto from 'node:crypto';
import { RepoReader, type RepoBundle } from '@ai-bridge/shared';
import { gitMeta, NodeFsPort, type SkippedFile } from './nodeFsPort';
import { rankSlice, ROLE_SLICE_BYTES, type SliceRole } from './slice';

export interface SnapshotMeta {
  id: string;
  root: string;
  /** Hash of the commit and the file list: cheap, and enough to prove identity. */
  sha256: string;
  capturedAt: number;
  files: number;
  skipped: SkippedFile[];
  commit: string | null;
  branch: string | null;
  dirty: boolean;
}

export interface Snapshot {
  meta: SnapshotMeta;
  port: NodeFsPort;
  reader: RepoReader;
}

export interface SliceForTurn {
  text: string;
  bytes: number;
  files: string[];
  contentAvailable: boolean;
  skipped: SkippedFile[];
}

export interface CaptureOptions {
  /** Files above this are recorded as skipped rather than read. */
  maxFileBytes?: number;
  budgetTokens?: number;
  maxFiles?: number;
  now?: number;
}

/**
 * Freeze the repository. Called once, at session create; re-capturing is a new
 * session, because a debate that audits a moving repository cannot be checked
 * against anything.
 */
export async function captureSnapshot(root: string, opts: CaptureOptions = {}): Promise<Snapshot> {
  const port = new NodeFsPort({
    root,
    ...(opts.maxFileBytes !== undefined ? { maxFileBytes: opts.maxFileBytes } : {}),
  });
  const files = await port.list();
  const git = await gitMeta(port.root);

  // The commit plus the file list identifies the snapshot without hashing every
  // byte: a content hash over a large tree is minutes of IO for a value that only
  // has to detect a change, and `dirty` already says the tree moved.
  const sha256 = crypto
    .createHash('sha256')
    .update(`${git.commit ?? 'no-git'}\n${git.dirty ? 'dirty' : 'clean'}\n${files.join('\n')}`)
    .digest('hex');

  const reader = new RepoReader({
    fs: port,
    budgetTokens: opts.budgetTokens ?? 8000,
    maxFiles: opts.maxFiles ?? 40,
  });
  await reader.index();

  const now = opts.now ?? Date.now();
  return {
    meta: {
      id: `snap-${now.toString(36)}`,
      root: port.root,
      sha256,
      capturedAt: now,
      files: files.length,
      skipped: port.skipped(),
      commit: git.commit,
      branch: git.branch,
      dirty: git.dirty,
    },
    port,
    reader,
  };
}

/**
 * The slice for one turn, against the current plan.
 *
 * A debater gets nothing — their job is the argument, not the code — and this
 * returns empty for that role rather than a slice the caller then has to discard.
 */
export async function sliceForPlan(
  snapshot: Snapshot,
  planText: string,
  role: SliceRole,
): Promise<SliceForTurn> {
  const budget = ROLE_SLICE_BYTES[role];
  const skipped = snapshot.meta.skipped;
  if (budget === 0) {
    return { text: '', bytes: 0, files: [], contentAvailable: false, skipped };
  }

  // The bundle is built against the plan, so the reader's own relevance pass and
  // the ranker agree about what the plan is talking about.
  const bundle: RepoBundle = await snapshot.reader.bundle(planText, {
    budgetTokens: 8000,
    maxFiles: 60,
  });

  // Bodies are what make the slice content rather than a table of contents.
  const bodies: Record<string, string> = {};
  for (const file of await snapshot.reader.bodies(bundle.files.map((f) => f.path))) {
    bodies[file.path] = file.text;
  }

  const slice = rankSlice(bundle, { planText, budgetBytes: budget, bodies });
  return {
    text: slice.text,
    bytes: slice.bytes,
    files: slice.files.map((f) => f.path),
    contentAvailable: slice.contentAvailable,
    skipped,
  };
}
