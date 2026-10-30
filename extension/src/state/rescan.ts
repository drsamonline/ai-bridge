/**
 * T3 — on-demand full rescan (§5.5).
 *
 * Re-reads the workspace rather than trusting the accumulated state:
 *   · every tracked file is re-stat'd; changed shas are marked stale
 *   · files that vanished are dropped, files that reappeared are re-added
 *   · files named in recent deltas but never tracked are added if they exist
 *   · the stack is recomputed from the extensions actually present
 *   · repo.dirtyHash becomes a hash of path+sha, so drift is detectable later
 *
 * It never invents content and never touches tasks or decisions — T3 is about
 * ground truth on disk, not about what the model said.
 */

import * as crypto from 'node:crypto';
import type { ProjectState } from '@ai-bridge/shared';
import type { FsPort } from '../repo/ports';

export interface RescanResult {
  tookMs: number;
  files: number;
  added: string[];
  removed: string[];
  changed: string[];
  stale: string[];
  stack: string[];
  dirtyHash: string;
}

const EXT_STACK: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', cs: 'csharp', rb: 'ruby',
  php: 'php', swift: 'swift', kt: 'kotlin', sql: 'sql', sh: 'shell',
  css: 'css', scss: 'css', html: 'html', vue: 'vue', svelte: 'svelte',
  tf: 'terraform', proto: 'protobuf',
};

export async function rescanRepo(
  state: ProjectState,
  fsPort: FsPort,
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void,
): Promise<RescanResult> {
  const started = Date.now();
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const stale: string[] = [];

  const repoFiles = new Set(await fsPort.list().catch(() => [] as string[]));

  // 1. Verify what we already track.
  for (const tracked of [...state.files]) {
    const stat = await fsPort.stat(tracked.path).catch(() => null);
    if (!stat) {
      removed.push(tracked.path);
      state.files = state.files.filter((f) => f.path !== tracked.path);
      continue;
    }
    if (tracked.sha && tracked.sha !== stat.sha) {
      changed.push(tracked.path);
      tracked.sha = stat.sha;
      if (!tracked.touchedBy.includes('t3')) tracked.touchedBy.push('t3');
    } else if (!tracked.sha) {
      // Never had a sha (came from a T1 mention): fill it in now.
      tracked.sha = stat.sha;
      stale.push(tracked.path);
    }
  }

  // 2. Add files that recent deltas name and that actually exist.
  const named = new Set<string>();
  for (const d of state.deltas.slice(-60)) {
    if (d.path) named.add(d.path);
  }
  for (const path of named) {
    if (state.files.some((f) => f.path === path)) continue;
    if (!repoFiles.has(path)) continue;
    const stat = await fsPort.stat(path).catch(() => null);
    if (!stat) continue;
    state.files.push({ path, role: 'unknown', sha: stat.sha, touchedBy: ['t3'] });
    added.push(path);
  }

  // 3. Recompute the stack from what is actually there.
  const stack = new Set(state.stack);
  for (const f of state.files) {
    const ext = f.path.slice(f.path.lastIndexOf('.') + 1).toLowerCase();
    const lang = EXT_STACK[ext];
    if (lang) stack.add(lang);
  }

  // 4. A dirty hash over path+sha: any change on disk alters it.
  const hash = crypto.createHash('sha256');
  for (const f of [...state.files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${f.path}\u0000${f.sha}\n`);
  }
  state.repo.dirtyHash = hash.digest('hex').slice(0, 16);
  state.stack = [...stack];
  state.meta.updatedAt = Date.now();

  const result: RescanResult = {
    tookMs: Date.now() - started,
    files: state.files.length,
    added,
    removed,
    changed,
    stale,
    stack: state.stack,
    dirtyHash: state.repo.dirtyHash,
  };
  log?.(
    'info',
    `T3 rescan: ${result.files} file(s), +${added.length} −${removed.length} ~${changed.length} in ${result.tookMs} ms`,
  );
  return result;
}
