/**
 * Repo ports — the seam that makes repo editing testable.
 *
 * §5.7/§5.8 say the reader uses `workspace.fs` + ripgrep and the applier uses a
 * single `WorkspaceEdit`. Both are VS Code APIs, so the core logic talks to
 * these interfaces instead, and `vscodePorts.ts` supplies the real
 * implementations. The contract tests drive the same core with a plain `node:fs`
 * port, which is how "reject = no change" can be *proven* rather than asserted.
 */

export interface FileStat {
  /** Path relative to the repo root, POSIX separators. */
  path: string;
  /** sha256 of the file bytes, hex, first 16 chars — the drift check. */
  sha: string;
  size: number;
  mtimeMs: number;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface FsPort {
  readonly root: string;
  /** All editable files, repo-relative, filtered (VCS dirs, node_modules, binaries). */
  list(): Promise<string[]>;
  read(relPath: string): Promise<string>;
  stat(relPath: string): Promise<FileStat | null>;
  /** Content search. Literal by default; `regex: true` for patterns. */
  search(query: string, opts?: { regex?: boolean; maxHits?: number }): Promise<SearchHit[]>;
}

/** One file's before/after, computed by the planner and applied atomically. */
export interface FileEdit {
  path: string;
  before: string;
  after: string;
  /** sha of `before`, re-checked immediately before applying. */
  shaBefore: string;
}

export interface ApplyPort {
  /**
   * Apply every edit as ONE undoable operation (a single WorkspaceEdit in
   * VS Code). Must be all-or-nothing: return ok:false without touching disk if
   * any edit cannot be applied.
   */
  apply(edits: FileEdit[]): Promise<{ ok: boolean; error?: string }>;
}

export interface DiffPort {
  /** Open the native diff for review. Never mutates the workspace. */
  show(title: string, edits: FileEdit[]): Promise<void>;
}

export const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'pdf', 'zip', 'gz', 'tar', 'jar',
  'exe', 'dll', 'so', 'dylib', 'wasm', 'woff', 'woff2', 'ttf', 'otf', 'mp3', 'mp4',
  'mov', 'avi', 'class', 'pyc', 'lock', 'vsix',
]);

export const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.cache', 'target', 'vendor',
]);

export function isEditablePath(relPath: string): boolean {
  const parts = relPath.split('/');
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  const dot = relPath.lastIndexOf('.');
  if (dot < 0) return true;
  const ext = relPath.slice(dot + 1).toLowerCase();
  return !BINARY_EXTENSIONS.has(ext);
}
