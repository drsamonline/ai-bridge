/**
 * Edit applier — spec §5.8.
 *
 * plan()   computes every file's after-text and refuses anything unsafe:
 *            · hunk search text must occur EXACTLY once
 *            · a tracked sha (when the proposal carries one) must match
 *            · a file that does not exist may only be created from full content
 *            · locked decisions are held, even in auto mode
 * apply()  re-verifies every sha immediately before writing and then hands the
 *          whole batch to ONE ApplyPort.apply call — one undo step, all or
 *          nothing. A refusal at any point leaves the workspace byte-identical.
 */

import * as crypto from 'node:crypto';
import type { ApplyPort, FileEdit, FsPort } from './ports';
import type { Proposal } from './proposal';

export interface LockedDecisionLite {
  id: string;
  what: string;
  why: string;
  /** Repo-relative paths this decision governs; empty = every file. */
  paths?: string[];
  /** Always true in practice; the field exists so a decision can be retired. */
  locked?: boolean;
}

export type FileStatus = 'ok' | 'create' | 'refused';

export interface PlannedFile {
  path: string;
  status: FileStatus;
  before: string;
  after: string;
  shaBefore: string;
  added: number;
  removed: number;
  hunks: number;
  /** §6 Diff View: "accept/reject per hunk" — the individual edits. */
  hunkList: Array<{ search: string; replace: string; added: number; removed: number }>;
  reason?: string;
}

export interface HeldEdit {
  path: string;
  decisionId: string;
  what: string;
}

export interface Plan {
  id: string;
  files: PlannedFile[];
  ok: boolean;
  summary: { files: number; added: number; removed: number };
  /** Human-readable refusals, for the banner. */
  refusals: Array<{ path: string; reason: string }>;
  /** Locked decisions that held this plan back, for the approval flow. */
  held: HeldEdit[];
  /** Decisions the user waived to get here. */
  waived: string[];
}

export interface PlanOptions {
  /** Decision ids the user has explicitly approved overriding. */
  waiveDecisions?: string[];
}

export interface ApplierOptions {
  fs: FsPort;
  apply: ApplyPort;
  /** Locked decisions; the state layer (2.1) becomes the real source. */
  decisions?: () => LockedDecisionLite[];
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export function sha(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/** Line-level +/− counts for a before/after pair (cheap LCS-free approximation). */
export function lineDelta(before: string, after: string): { added: number; removed: number } {
  const b = before.split('\n');
  const a = after.split('\n');
  const counts = new Map<string, number>();
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of a) {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else added += 1;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return { added, removed };
}

/** Apply one hunk to `text`, requiring exactly one occurrence. */
function applyHunk(text: string, search: string, replace: string): { text: string } | { error: string } {
  if (search === '') return { error: 'empty SEARCH block' };
  const first = text.indexOf(search);
  if (first < 0) return { error: 'SEARCH text not found' };
  const second = text.indexOf(search, first + 1);
  if (second >= 0) return { error: 'SEARCH text matches more than once (ambiguous)' };
  return { text: text.slice(0, first) + replace + text.slice(first + search.length) };
}

export class EditApplier {
  constructor(private readonly opts: ApplierOptions) {}

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    this.opts.log?.(level, msg);
  }

  async plan(proposal: Proposal, opts: PlanOptions = {}): Promise<Plan> {
    const files: PlannedFile[] = [];
    const refusals: Array<{ path: string; reason: string }> = [];
    const decisions = this.opts.decisions?.() ?? [];
    const waived = new Set(opts.waiveDecisions ?? []);
    const held: HeldEdit[] = [];

    for (const fp of proposal.files) {
      const stat = await this.opts.fs.stat(fp.path).catch(() => null);
      let before = '';
      let shaBefore = '';

      if (!stat) {
        if (fp.content === undefined) {
          refusals.push({ path: fp.path, reason: 'ENOENT: file does not exist and the proposal has no full content' });
          files.push({
            path: fp.path, status: 'refused', before: '', after: '', shaBefore: '',
            added: 0, removed: 0, hunks: fp.hunks.length, hunkList: [], reason: 'ENOENT',
          });
          continue;
        }
      } else {
        before = await this.opts.fs.read(fp.path);
        shaBefore = stat.sha;
        if (shaBefore !== sha(before)) {
          // The port and the file disagree — treat as drift, never write.
          refusals.push({ path: fp.path, reason: 'EDRIFT: sha reported by the port does not match the file contents' });
          files.push({
            path: fp.path, status: 'refused', before, after: before, shaBefore,
            added: 0, removed: 0, hunks: fp.hunks.length, hunkList: [], reason: 'EDRIFT',
          });
          continue;
        }
      }

      let after: string;
      if (fp.content !== undefined) {
        after = fp.content;
      } else {
        after = before;
        let failure: string | null = null;
        for (const [i, hunk] of fp.hunks.entries()) {
          const res = applyHunk(after, hunk.search, hunk.replace);
          if ('error' in res) {
            failure = `hunk ${i + 1}: ${res.error}`;
            break;
          }
          after = res.text;
        }
        if (failure) {
          refusals.push({ path: fp.path, reason: `ENOAPPLY: ${failure}` });
          files.push({
            path: fp.path, status: 'refused', before, after: before, shaBefore,
            added: 0, removed: 0, hunks: fp.hunks.length, hunkList: [], reason: failure,
          });
          continue;
        }
      }

      // Locked-decision guard: held even in auto mode (§5.8). A decision the user
      // has explicitly approved overriding is recorded and allowed through.
      const blockedBy = decisions.find(
        (d) =>
          d.locked !== false &&
          (d.paths?.length ? d.paths.includes(fp.path) : true) &&
          before.includes(d.what) &&
          !after.includes(d.what),
      );
      if (blockedBy) {
        held.push({ path: fp.path, decisionId: blockedBy.id, what: blockedBy.what });
        if (!waived.has(blockedBy.id)) {
          const reason = `ELOCKED: would remove locked decision "${blockedBy.what}" (${blockedBy.id})`;
          refusals.push({ path: fp.path, reason });
          files.push({
            path: fp.path, status: 'refused', before, after: before, shaBefore,
            added: 0, removed: 0, hunks: fp.hunks.length, hunkList: [], reason,
          });
          this.log('warn', reason);
          continue;
        }
        this.log('warn', `locked decision ${blockedBy.id} waived by explicit approval for ${fp.path}`);
      }

      const delta = lineDelta(before, after);
      files.push({
        path: fp.path,
        status: stat ? 'ok' : 'create',
        before,
        after,
        shaBefore,
        added: delta.added,
        removed: delta.removed,
        hunks: fp.hunks.length,
        hunkList: fp.hunks.map((h) => {
          const d = lineDelta(h.search, h.replace);
          return { search: h.search, replace: h.replace, added: d.added, removed: d.removed };
        }),
      });
    }

    const usable = files.filter((f) => f.status !== 'refused');
    const summary = {
      files: usable.length,
      added: usable.reduce((n, f) => n + f.added, 0),
      removed: usable.reduce((n, f) => n + f.removed, 0),
    };
    const ok = usable.length > 0 && refusals.length === 0;
    this.log(
      ok ? 'info' : 'warn',
      `plan ${proposal.id}: ${usable.length} file(s) +${summary.added} −${summary.removed}, ${refusals.length} refusal(s)` +
        (held.length ? `, ${held.length} held by locked decisions` : ''),
    );
    return {
      id: proposal.id,
      files,
      ok,
      summary,
      refusals,
      held,
      waived: [...waived],
    };
  }

  /** Apply an accepted plan as one operation. Refuses on any drift. */
  /**
   * Apply a plan, optionally only some of its hunks (§6: accept/reject per hunk).
   * `selection` is a list of `path#index` keys; omitted means "all of them".
   */
  async apply(
    plan: Plan,
    selection?: string[],
  ): Promise<{ ok: boolean; applied: number; error?: string; skipped: number }> {
    const usable = plan.files.filter((f) => f.status !== 'refused');
    if (usable.length === 0) return { ok: false, applied: 0, error: 'ENOTHING: no applicable files in this plan', skipped: 0 };
    if (plan.refusals.length > 0) {
      return { ok: false, applied: 0, error: `EREFUSED: ${plan.refusals[0]!.reason}`, skipped: 0 };
    }

    // Re-verify immediately before writing: the workspace may have moved since planning.
    for (const f of usable) {
      if (f.status === 'create') {
        const exists = await this.opts.fs.stat(f.path).catch(() => null);
        if (exists) return { ok: false, applied: 0, error: `EDRIFT: ${f.path} appeared after planning`, skipped: 0 };
        continue;
      }
      const now = await this.opts.fs.stat(f.path).catch(() => null);
      if (!now) return { ok: false, applied: 0, error: `EDRIFT: ${f.path} disappeared after planning`, skipped: 0 };
      if (now.sha !== f.shaBefore) {
        return { ok: false, applied: 0, error: `EDRIFT: ${f.path} changed on disk after planning`, skipped: 0 };
      }
    }

    // §6: with a selection, rebuild each file from only the chosen hunks.
    const chosen = (f: PlannedFile): PlannedFile => {
      if (!selection || selection.length === 0) return f;
      if (f.status === 'create') {
        return selection.includes(`${f.path}#all`) || selection.some((k) => k.startsWith(`${f.path}#`)) ? f : { ...f, after: f.before };
      }
      const keep = f.hunkList.filter((_h, i) => selection.includes(`${f.path}#${i}`));
      if (keep.length === f.hunkList.length) return f;
      let text = f.before;
      for (const h of keep) {
        const at = text.indexOf(h.search);
        if (at < 0) continue;
        text = text.slice(0, at) + h.replace + text.slice(at + h.search.length);
      }
      const added = keep.reduce((n, h) => n + h.added, 0);
      const removed = keep.reduce((n, h) => n + h.removed, 0);
      return { ...f, after: text, added, removed, hunks: keep.length };
    };

    const selectedFiles = usable.map(chosen).filter((f) => f.after !== f.before || f.status === 'create');
    const skipped = usable.length - selectedFiles.length;
    if (selectedFiles.length === 0) {
      return { ok: false, applied: 0, error: 'ENOTHING: no hunks were selected', skipped };
    }

    const edits: FileEdit[] = selectedFiles.map((f) => ({
      path: f.path,
      before: f.before,
      after: f.after,
      shaBefore: f.shaBefore,
    }));

    const res = await this.opts.apply.apply(edits);
    if (!res.ok) {
      this.log('error', `apply failed: ${res.error ?? 'unknown'}`);
      return { ok: false, applied: 0, error: res.error ?? 'EAPPLY', skipped };
    }
    this.log(
      'info',
      `applied ${edits.length} file(s) in one operation${selection && selection.length ? ` (${selection.length} selected hunk(s))` : ''}: ${edits.map((e) => e.path).join(', ')}`,
    );
    return { ok: true, applied: edits.length, skipped };
  }
}
