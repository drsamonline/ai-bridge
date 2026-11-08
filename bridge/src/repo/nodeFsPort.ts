/**
 * The bridge's own filesystem port — SPEC v6 §9, work item 6.
 *
 * The reuse map said the shell would supply this. It cannot: under Option B the
 * shell is a page served over HTTP, and a browser page has no filesystem. The
 * bridge is the Node process, so the port lives here and `ports.ts` stays what it
 * always was — an interface that makes the reader testable.
 *
 * `gitMeta` is here for the same reason: `execFile` is a Node facility, and the
 * snapshot manifest needs the branch and commit it was taken from.
 */

import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { FileStat, FsPort, SearchHit } from '@ai-bridge/shared';
import { isEditablePath, SKIP_DIRS } from '@ai-bridge/shared';

const run = promisify(execFile);

/** A depth guard: a symlink loop must not walk forever. */
const MAX_DEPTH = 24;

export interface NodeFsPortOptions {
  root: string;
  /** Files above this size are listed but never read into a bundle. */
  maxFileBytes?: number;
  /** A hard ceiling on the walk, so a runaway tree cannot hang a session. */
  maxFiles?: number;
}

export class NodeFsPort implements FsPort {
  readonly root: string;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private cache: string[] | null = null;

  constructor(opts: NodeFsPortOptions) {
    this.root = path.resolve(opts.root);
    this.maxFileBytes = opts.maxFileBytes ?? 1024 * 1024;
    this.maxFiles = opts.maxFiles ?? 20_000;
  }

  /** Walk once and memoise: a bundle asks for the file list repeatedly. */
  async list(): Promise<string[]> {
    if (this.cache) return this.cache;
    const out: string[] = [];
    const walk = (rel: string, depth: number): void => {
      if (depth > MAX_DEPTH || out.length >= this.maxFiles) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(path.join(this.root, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (out.length >= this.maxFiles) return;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          walk(childRel, depth + 1);
        } else if (entry.isFile() && isEditablePath(childRel)) {
          out.push(childRel);
        }
      }
    };
    walk('', 0);
    out.sort();
    this.cache = out;
    return out;
  }

  async read(relPath: string): Promise<string> {
    return fs.readFileSync(this.abs(relPath), 'utf8');
  }

  async stat(relPath: string): Promise<FileStat | null> {
    try {
      const full = this.abs(relPath);
      const st = fs.statSync(full);
      if (!st.isFile()) return null;
      if (st.size > this.maxFileBytes) return null;
      const bytes = fs.readFileSync(full);
      return {
        path: relPath,
        // First 16 hex chars, as the port contract says: enough to detect drift,
        // short enough to sit in a manifest.
        sha: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16),
        size: st.size,
        mtimeMs: st.mtimeMs,
      };
    } catch {
      return null;
    }
  }

  async search(query: string, opts: { regex?: boolean; maxHits?: number } = {}): Promise<SearchHit[]> {
    const maxHits = opts.maxHits ?? 200;
    const matcher = opts.regex
      ? new RegExp(query, 'i')
      : null;
    const needle = query.toLowerCase();
    const hits: SearchHit[] = [];

    for (const relPath of await this.list()) {
      if (hits.length >= maxHits) break;
      let text: string;
      try {
        text = await this.read(relPath);
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        const found = matcher ? matcher.test(line) : line.toLowerCase().includes(needle);
        if (!found) continue;
        hits.push({ path: relPath, line: i + 1, text: line.trim().slice(0, 400) });
        if (hits.length >= maxHits) break;
      }
    }
    return hits;
  }

  /** Repo-relative to absolute, refusing to escape the root. */
  private abs(relPath: string): string {
    const full = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`EPATH: ${relPath} escapes the repo root`);
    }
    return full;
  }

  /** Invalidate the memoised walk after the tree changes. */
  refresh(): void {
    this.cache = null;
  }
}

export interface GitMeta {
  branch: string | null;
  commit: string | null;
  dirty: boolean;
}

/**
 * The branch, commit and dirty flag for the snapshot manifest.
 *
 * Never throws: a snapshot of a directory that is not a git repository is still a
 * valid snapshot, and the manifest records the absence rather than failing the
 * session.
 */
export async function gitMeta(root: string): Promise<GitMeta> {
  const git = async (args: string[]): Promise<string | null> => {
    try {
      const { stdout } = await run('git', args, { cwd: root, timeout: 5000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  };
  const [branch, commit, status] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['rev-parse', 'HEAD']),
    git(['status', '--porcelain']),
  ]);
  return { branch, commit, dirty: status !== null && status.length > 0 };
}
