/**
 * Repo reader — spec §5.7.
 *
 * Indexes the workspace through an `FsPort`, ranks files against the user's
 * question, and prunes them: signatures for every matched file, full bodies only
 * while the token budget allows. The result is a context block the extension
 * prepends to the prompt, with each file's sha so a stale proposal can be
 * refused later.
 *
 * "AST-aware" is honest about its limits: it is a per-language signature
 * extractor (TypeScript/JS, Python, Go, Rust, Java/C#, Ruby), not a parser
 * integration. It gets the top-level declarations right, which is what the prune
 * needs; a real parser lands with the state layer's T3 rescan in 2.3.
 */

import type { FsPort, SearchHit } from './ports';
import { isEditablePath } from './ports';

export interface BundleFile {
  path: string;
  sha: string;
  bytes: number;
  hits: number;
  tokens: number;
  mode: 'signatures' | 'body' | 'signatures+body';
  signatures: string[];
}

export interface RepoBundle {
  root: string;
  query: string;
  files: BundleFile[];
  tokens: number;
  text: string;
  indexed: number;
}

export interface ReaderOptions {
  fs: FsPort;
  /** Context budget for the whole bundle. */
  budgetTokens?: number;
  maxFiles?: number;
  /** Files larger than this only ever get signatures. */
  bodyLimitBytes?: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Top-level declaration lines, per language family. */
export function extractSignatures(text: string, path = ''): string[] {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const lines = text.split('\n');
  const out: string[] = [];

  const push = (line: string) => {
    const trimmed = line.trimEnd();
    if (trimmed.trim().length > 0 && !out.includes(trimmed)) out.push(trimmed);
  };

  const jsLike = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte'];
  const jvmLike = ['java', 'cs', 'kt', 'scala', 'swift', 'php'];

  if (jsLike.includes(ext) || jvmLike.includes(ext) || ext === '') {
    const re =
      /^\s*(export\s+)?(default\s+)?(declare\s+)?(async\s+)?(abstract\s+)?(public|private|protected|static|readonly|final|\s)*\s*(function|class|interface|type|enum|namespace|module|const|let|var|struct|record|trait)\b[^\n{=]*/;
    for (const line of lines) {
      if (re.test(line) && (line.includes('(') || /\b(class|interface|type|enum|struct|trait|record)\b/.test(line))) {
        push(line);
      }
    }
    return out.slice(0, 200);
  }

  if (ext === 'py') {
    for (const line of lines) {
      if (/^(async\s+)?(def|class)\s+\w+/.test(line) || /^[A-Z_][A-Z0-9_]*\s*=/.test(line)) push(line);
    }
    return out.slice(0, 200);
  }

  if (ext === 'go') {
    for (const line of lines) {
      if (/^func\s|^type\s/.test(line)) push(line);
    }
    return out.slice(0, 200);
  }

  if (ext === 'rs') {
    for (const line of lines) {
      if (/^(pub\s+)?(async\s+)?(fn|struct|enum|trait|impl|mod|const|static)\b/.test(line)) push(line);
    }
    return out.slice(0, 200);
  }

  if (ext === 'rb') {
    for (const line of lines) {
      if (/^(def|class|module)\s/.test(line)) push(line);
    }
    return out.slice(0, 200);
  }

  // Unknown language: headings and lines that look like declarations.
  for (const line of lines) {
    if (/^(#{1,3}\s|\w[\w .-]*:\s*$|[\w<>]+\s+\w+\s*\([^)]*\)\s*[:{])/.test(line)) push(line);
  }
  return out.slice(0, 120);
}

/** Words worth searching for: identifiers, dotted names, quoted strings. */
export function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const m of query.matchAll(/[A-Za-z_][A-Za-z0-9_.]{2,}/g)) {
    const t = m[0];
    if (t.length >= 3) terms.add(t);
  }
  for (const m of query.matchAll(/["'`]([^"'`]{3,40})["'`]/g)) terms.add(m[1]!);
  // Drop the words that only carry intent.
  const stop = new Set([
    'rename', 'change', 'update', 'make', 'please', 'the', 'and', 'for', 'with', 'from',
    'into', 'this', 'that', 'file', 'files', 'code', 'add', 'remove', 'delete', 'function',
  ]);
  return [...terms].filter((t) => !stop.has(t.toLowerCase())).slice(0, 12);
}

export class RepoReader {
  private files: string[] = [];
  private indexedAt = 0;

  constructor(private readonly opts: ReaderOptions) {}

  get root(): string {
    return this.opts.fs.root;
  }

  get indexedFiles(): number {
    return this.files.length;
  }

  async index(): Promise<{ files: number; tookMs: number }> {
    const started = Date.now();
    const all = await this.opts.fs.list();
    this.files = all.filter(isEditablePath);
    this.indexedAt = Date.now();
    return { files: this.files.length, tookMs: this.indexedAt - started };
  }

  /**
   * Build the context block for a question. Search hits rank the files; the
   * bundle then carries signatures (always) and bodies (while budget lasts).
   */
  async bundle(query: string, opts: { budgetTokens?: number; maxFiles?: number } = {}): Promise<RepoBundle> {
    const budget = opts.budgetTokens ?? this.opts.budgetTokens ?? 3000;
    const maxFiles = opts.maxFiles ?? this.opts.maxFiles ?? 6;
    const bodyLimit = this.opts.bodyLimitBytes ?? 6000;

    if (this.files.length === 0) await this.index();

    const terms = queryTerms(query);
    const hitCount = new Map<string, number>();
    const hits: SearchHit[] = [];

    for (const term of terms) {
      const found = await this.opts.fs.search(term, { maxHits: 200 }).catch(() => []);
      for (const h of found) {
        if (!isEditablePath(h.path)) continue;
        hitCount.set(h.path, (hitCount.get(h.path) ?? 0) + 1);
        if (hits.length < 400) hits.push(h);
      }
    }

    // Files named outright in the question always make the cut.
    for (const f of this.files) {
      const base = f.split('/').pop() ?? f;
      if (query.includes(base)) hitCount.set(f, (hitCount.get(f) ?? 0) + 50);
    }

    const ranked = [...hitCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxFiles)
      .map(([path]) => path);

    const files: BundleFile[] = [];
    const chunks: string[] = [];
    let used = 0;

    for (const path of ranked) {
      const stat = await this.opts.fs.stat(path).catch(() => null);
      if (!stat) continue;
      const text = await this.opts.fs.read(path).catch(() => '');
      if (!text) continue;

      const signatures = extractSignatures(text, path);
      const sigBlock = signatures.join('\n');
      const bodyAllowed = stat.size <= bodyLimit && used + estimateTokens(text) < budget;
      const body = bodyAllowed ? text : null;

      const chunk = [
        `### ${path}  sha=${stat.sha}  (${stat.size} bytes)`,
        '```',
        ...(signatures.length ? ['// signatures', sigBlock] : []),
        ...(body ? ['// full file', body] : ['// body omitted — ask for it if you need it']),
        '```',
      ].join('\n');

      const tokens = estimateTokens(chunk);
      used += tokens;
      files.push({
        path,
        sha: stat.sha,
        bytes: stat.size,
        hits: hitCount.get(path) ?? 0,
        tokens,
        mode: body ? (signatures.length ? 'signatures+body' : 'body') : 'signatures',
        signatures,
      });
      chunks.push(chunk);
      if (used >= budget) break;
    }

    const header = [
      `## Repo context — root: ${this.opts.fs.root}`,
      `Files matched: ${files.length} of ${this.files.length} indexed. Query terms: ${terms.join(', ') || '(none)'}.`,
      'When you propose a change, reply with fenced blocks in this exact shape:',
      '```edit path=<repo-relative path>',
      '<<<<<<< SEARCH',
      '<exact existing text, once>',
      '=======',
      '<replacement>',
      '>>>>>>> REPLACE',
      '```',
      'Use a ```file path=<path> block to create a new file. Do not describe edits in prose.',
      '',
    ].join('\n');

    const text = [header, ...chunks].join('\n\n');
    return {
      root: this.opts.fs.root,
      query,
      files,
      tokens: estimateTokens(text),
      text,
      indexed: this.files.length,
    };
  }

  /** Full bodies for specific files — the "bodies on demand" half of §5.7. */
  async bodies(paths: string[]): Promise<Array<{ path: string; sha: string; text: string }>> {
    const out: Array<{ path: string; sha: string; text: string }> = [];
    for (const path of paths) {
      const stat = await this.opts.fs.stat(path).catch(() => null);
      if (!stat) continue;
      out.push({ path, sha: stat.sha, text: await this.opts.fs.read(path) });
    }
    return out;
  }
}
