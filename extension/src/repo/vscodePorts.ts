/**
 * VS Code implementations of the repo ports.
 *
 * `workspace.fs` for I/O, ripgrep for search (with a bounded JS fallback when
 * `rg` is not on PATH), and ONE `WorkspaceEdit` for every applied change so the
 * user gets a single undo step.
 */

import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import type { ApplyPort, DiffPort, FileEdit, FsPort, FileStat, SearchHit } from './ports';
import { isEditablePath } from './ports';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

function shaOf(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function relOf(root: vscode.Uri, uri: vscode.Uri): string {
  const rootPath = root.fsPath.endsWith('/') ? root.fsPath : `${root.fsPath}/`;
  return uri.fsPath.startsWith(rootPath)
    ? uri.fsPath.slice(rootPath.length).split('\\').join('/')
    : uri.fsPath;
}

export function createFsPort(root: vscode.Uri, log: (m: string) => void): FsPort {
  return {
    root: root.fsPath,

    async list(): Promise<string[]> {
      const uris = await vscode.workspace.findFiles(
        '**/*',
        '**/{node_modules,.git,dist,out,build,coverage,target,vendor,.venv,__pycache__}/**',
        20000,
      );
      return uris.map((u) => relOf(root, u)).filter(isEditablePath);
    },

    async read(rel: string): Promise<string> {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, rel));
      return decoder.decode(bytes);
    },

    async stat(rel: string): Promise<FileStat | null> {
      try {
        const uri = vscode.Uri.joinPath(root, rel);
        const [st, bytes] = await Promise.all([
          vscode.workspace.fs.stat(uri),
          vscode.workspace.fs.readFile(uri),
        ]);
        return { path: rel, sha: shaOf(bytes), size: st.size, mtimeMs: st.mtime };
      } catch {
        return null;
      }
    },

    async search(query: string, opts: { regex?: boolean; maxHits?: number } = {}): Promise<SearchHit[]> {
      const maxHits = opts.maxHits ?? 200;
      try {
        return await rgSearch(root.fsPath, query, { ...opts, maxHits });
      } catch (err) {
        log(`ripgrep unavailable (${(err as Error).message}) — falling back to a JS scan`);
        return jsScan(root, query, { ...opts, maxHits });
      }
    },
  };
}

function rgSearch(
  cwd: string,
  query: string,
  opts: { regex?: boolean; maxHits: number },
): Promise<SearchHit[]> {
  return new Promise((resolve, reject) => {
    const args = ['--json', '--max-count', String(opts.maxHits), '--glob', '!node_modules', '--glob', '!.git'];
    if (!opts.regex) args.push('--fixed-strings');
    args.push('--', query, '.');

    execFile('rg', args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 5000 }, (err, stdout) => {
      if (err && !stdout) {
        reject(err);
        return;
      }
      const hits: SearchHit[] = [];
      for (const line of String(stdout).split('\n')) {
        if (!line.trim()) continue;
        let parsed: {
          type?: string;
          data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
        };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.type !== 'match' || !parsed.data) continue;
        const p = (parsed.data.path?.text ?? '').replace(/^\.\//, '').split('\\').join('/');
        if (!p || !isEditablePath(p)) continue;
        hits.push({
          path: p,
          line: parsed.data.line_number ?? 0,
          text: (parsed.data.lines?.text ?? '').trimEnd(),
        });
        if (hits.length >= opts.maxHits) break;
      }
      resolve(hits);
    });
  });
}

async function jsScan(
  root: vscode.Uri,
  query: string,
  opts: { regex?: boolean; maxHits: number },
): Promise<SearchHit[]> {
  const uris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,out}/**', 2000);
  const hits: SearchHit[] = [];
  const re = opts.regex ? new RegExp(query) : null;
  for (const uri of uris) {
    const rel = relOf(root, uri);
    if (!isEditablePath(rel)) continue;
    let text: string;
    try {
      text = decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const hit = re ? re.test(line) : line.toLowerCase().includes(query.toLowerCase());
      if (hit) {
        hits.push({ path: rel, line: i + 1, text: line.trimEnd() });
        if (hits.length >= opts.maxHits) return hits;
      }
    }
  }
  return hits;
}

/**
 * One `WorkspaceEdit` for the whole batch — a single undo. Refuses if any target
 * document has unsaved changes, because a full-range replace would silently
 * discard the user's in-editor work.
 */
export function createApplyPort(root: vscode.Uri): ApplyPort {
  return {
    async apply(edits: FileEdit[]) {
      for (const e of edits) {
        const uri = vscode.Uri.joinPath(root, e.path);
        const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
        if (open?.isDirty) {
          return { ok: false, error: `EDIRTY: ${e.path} has unsaved changes — save it first` };
        }
      }

      const edit = new vscode.WorkspaceEdit();
      for (const e of edits) {
        const uri = vscode.Uri.joinPath(root, e.path);
        const existing = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
        if (existing) {
          const last = existing.lineCount;
          const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(last, 0));
          edit.replace(uri, range, e.after);
        } else {
          const stat = await vscode.workspace.fs.stat(uri).then(
            () => true,
            () => false,
          );
          if (!stat) {
            edit.createFile(uri, { ignoreIfExists: false });
            edit.insert(uri, new vscode.Position(0, 0), e.after);
          } else {
            const doc = await vscode.workspace.openTextDocument(uri);
            const range = new vscode.Range(
              new vscode.Position(0, 0),
              new vscode.Position(doc.lineCount, 0),
            );
            edit.replace(uri, range, e.after);
          }
        }
      }

      const ok = await vscode.workspace.applyEdit(edit);
      return ok ? { ok: true } : { ok: false, error: 'EAPPLY: VS Code rejected the workspace edit' };
    },
  };
}

/** Native diff for review. Never mutates anything. */
export function createDiffPort(): DiffPort {
  return {
    async show(title: string, edits: FileEdit[]) {
      if (edits.length === 0) return;
      const first = edits[0]!;
      const left = await vscode.workspace.openTextDocument({ content: first.before, language: guessLanguage(first.path) });
      const right = await vscode.workspace.openTextDocument({ content: first.after, language: guessLanguage(first.path) });
      await vscode.commands.executeCommand(
        'vscode.diff',
        left.uri,
        right.uri,
        `${title} — ${first.path}`,
      );
      if (edits.length > 1) {
        void vscode.window.showInformationMessage(
          `Showing 1 of ${edits.length} files. Accept applies all of them as one undo step.`,
        );
      }
    },
  };
}

function guessLanguage(p: string): string {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
    py: 'python', go: 'go', rs: 'rust', java: 'java', cs: 'csharp', rb: 'ruby',
    md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', css: 'css', html: 'html',
  };
  return map[ext] ?? 'plaintext';
}

export { encoder };
