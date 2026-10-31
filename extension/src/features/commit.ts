/**
 * Batch 8.3 — the commit-message feature, minus the editor.
 *
 * Adapted from `src/vscode/CommitMessageGenerator.ts` of AppsGanin/ai-free-vscode
 * (MIT, commit 6f53bad). See docs/batch8/attribution.md.
 *
 * The git call is a plain function of a working directory, which is what makes
 * it testable: the harness builds a throwaway repository, stages a change and
 * asserts on the real diff. Nothing here imports `vscode`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** A diff bigger than this is truncated before it is sent. */
export const MAX_DIFF_CHARS = 12_000;

const GIT_TIMEOUT_MS = 10_000;

/** The staged diff, falling back to the working tree when nothing is staged. */
export async function stagedDiff(cwd: string): Promise<string> {
  const staged = await git(cwd, ['diff', '--cached', '--no-color', '--unified=3']);
  if (staged.trim()) return staged;
  // Nothing staged is not an error: the user may be about to stage, and a
  // message for the working tree is still useful.
  return git(cwd, ['diff', '--no-color', '--unified=3']);
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const error = err as Error & { code?: string; stderr?: string };
    if (error.code === 'ENOENT') {
      throw new Error('ENOGIT: git is not on PATH');
    }
    throw new Error(`EGIT: ${(error.stderr || error.message).trim().split('\n')[0]}`);
  }
}

/**
 * Caps the diff before it is sent.
 *
 * A diff that fills the context window costs the same on a metered tier as one
 * that does not, and the first 12 000 characters describe the change well enough
 * for a subject line.
 */
export function truncateDiff(diff: string, maxChars = MAX_DIFF_CHARS): string {
  const text = diff.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n… diff truncated at ${maxChars} characters`;
}

export interface CommitPromptOptions {
  /** Extra instruction from settings, appended to the default. */
  extra?: string;
  /** Conventional Commits by default; free text is allowed. */
  style?: string;
}

/**
 * The instruction sent with the diff.
 *
 * Asks for the message and nothing else, because anything else has to be
 * stripped before it reaches the commit box — and stripping is where a good
 * message turns into a bad one.
 */
export function buildCommitPrompt(diff: string, opts: CommitPromptOptions = {}): string {
  const style = (opts.style || 'Conventional Commits (type(scope): summary)').trim();
  const lines = [
    'Write a commit message for the diff below.',
    `Style: ${style}.`,
    '- Subject on one line, imperative mood, at most 72 characters.',
    '- Write it in English.',
    '- Add a short body after a blank line only for a significant change.',
    '- Reply with ONLY the commit message: no markdown fences, no quotes, no preamble.',
  ];
  if (opts.extra && opts.extra.trim()) lines.push('', opts.extra.trim());
  lines.push('', 'Diff:', truncateDiff(diff));
  return lines.join('\n');
}

/**
 * Cleans up what the model actually sends.
 *
 * Models wrap the message in fences, quote it, or open with "Commit message:"
 * even when told not to. Each of those has a cheap, predictable repair — and a
 * repaired message beats a commit subject containing three backticks.
 */
export function parseCommitMessage(raw: string): string {
  let text = (raw ?? '').trim();
  if (!text) return '';

  // A fenced block, with or without a language tag.
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced) text = fenced[1]!.trim();

  // A leading label the model added on its own.
  text = text.replace(/^(?:commit message|message|subject)\s*:\s*/i, '').trim();

  // Wrapping quotes around the whole thing.
  const quoted = /^(["'`])([\s\S]*)\1$/.exec(text);
  if (quoted && !quoted[2]!.includes('\n')) text = quoted[2]!.trim();

  // Collapse the trailing whitespace a fence leaves behind.
  return text.replace(/\s+$/, '');
}

/** The subject line, for a status bar or a log. */
export function subjectOf(message: string): string {
  return message.split('\n')[0]!.trim();
}
