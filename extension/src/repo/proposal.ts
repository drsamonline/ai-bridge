/**
 * Edit-proposal parsing.
 *
 * The model is asked to answer with fenced blocks. Two shapes are accepted:
 *
 *   ```edit path=src/a.ts          ← SEARCH/REPLACE hunks (preferred: reviewable)
 *   <<<<<<< SEARCH
 *   old line
 *   =======
 *   new line
 *   >>>>>>> REPLACE
 *   ```
 *
 *   ```file path=src/a.ts          ← whole-file content (used for new files)
 *   ...
 *   ```
 *
 * Anything outside those blocks is treated as prose and never applied, so a
 * model that rambles cannot smuggle a change through.
 */

export interface Hunk {
  search: string;
  replace: string;
}

export interface FileProposal {
  path: string;
  hunks: Hunk[];
  /** Present for ```file blocks. */
  content?: string;
}

export interface Proposal {
  id: string;
  files: FileProposal[];
  /** Byte offsets are not tracked; this is the raw block text for the audit trail. */
  raw: string;
}

const FENCE = /^```(edit|file)\b([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
const PATH_ATTR = /(?:^|\s)(?:path|file)=("([^"]+)"|'([^']+)'|(\S+))/i;

function parsePath(info: string): string | null {
  const m = info.match(PATH_ATTR);
  if (!m) return null;
  const raw = m[2] ?? m[3] ?? m[4] ?? '';
  const cleaned = raw.trim().replace(/^[`'"]|[`'"]$/g, '').replace(/^\.\//, '');
  return cleaned.length ? cleaned : null;
}

function parseHunks(body: string): Hunk[] {
  const hunks: Hunk[] = [];
  const re = /^<<<<<<<+\s*SEARCH[^\n]*\n([\s\S]*?)^=======[^\n]*\n([\s\S]*?)^>>>>>>>+\s*REPLACE[^\n]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    hunks.push({ search: m[1] ?? '', replace: m[2] ?? '' });
  }
  return hunks;
}

/**
 * Pull every proposal out of an answer. Returns null when the answer contains no
 * applicable block — the caller must treat that as "no change proposed", not as
 * an empty edit.
 */
export function parseProposal(answer: string, id = `p${Date.now().toString(36)}`): Proposal | null {
  const files: FileProposal[] = [];
  const raws: string[] = [];

  FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE.exec(answer)) !== null) {
    const kind = m[1] as 'edit' | 'file';
    const info = m[2] ?? '';
    const body = m[3] ?? '';
    const path = parsePath(info);
    if (!path) continue;

    if (kind === 'edit') {
      const hunks = parseHunks(body);
      if (hunks.length === 0) continue;
      files.push({ path, hunks });
    } else {
      // Strip the single trailing newline the fence itself contributes.
      files.push({ path, hunks: [], content: body.replace(/\n$/, '') });
    }
    raws.push(`${kind} ${path}`);
  }

  if (files.length === 0) return null;

  // Merge duplicate paths, keeping order of first appearance.
  const merged = new Map<string, FileProposal>();
  for (const f of files) {
    const prev = merged.get(f.path);
    if (!prev) {
      merged.set(f.path, { ...f, hunks: [...f.hunks] });
      continue;
    }
    if (f.content !== undefined) prev.content = f.content;
    prev.hunks.push(...f.hunks);
  }

  return { id, files: [...merged.values()], raw: raws.join('\n') };
}

/** Human summary for the diff card: `3 files +42 −11`. */
export function summarise(files: Array<{ added: number; removed: number }>): string {
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return `${files.length} file${files.length === 1 ? '' : 's'} +${added} −${removed}`;
}
