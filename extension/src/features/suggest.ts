/**
 * Batch 8.3b — inline suggestions, minus the editor.
 *
 * Adapted from `src/vscode/InlineCompletionProvider.ts` of
 * AppsGanin/ai-free-vscode (MIT, commit 6f53bad).
 * See docs/batch8/attribution.md.
 *
 * The whole design is about latency on a slow free tier. A ghost-text provider
 * that fires while you type, and takes four seconds to answer, is worse than no
 * provider at all — so this one is armed by a keystroke and disarms itself after
 * one answer. Everything it sends is small, and everything it returns is cut to
 * a shape that cannot surprise the editor.
 */

export interface SuggestionContext {
  /** Code before the cursor. */
  prefix: string;
  /** Code after the cursor. */
  suffix: string;
  languageId: string;
  maxPrefixChars?: number;
  maxSuffixChars?: number;
}

/** Defaults, deliberately small: a completion needs context, not a repository. */
export const DEFAULT_MAX_PREFIX_CHARS = 2_000;
export const DEFAULT_MAX_SUFFIX_CHARS = 800;
/** Whichever comes first. */
export const DEFAULT_MAX_LINES = 12;
export const DEFAULT_MAX_CHARS = 600;

/**
 * The prompt.
 *
 * It asks for continuation only — no explanation, no fence — because anything
 * else has to be stripped, and stripping is where a good completion turns into a
 * wrong one. The suffix is included so the model can close a bracket it opened.
 */
export function buildSuggestionPrompt(ctx: SuggestionContext): string {
  const prefix = ctx.prefix.slice(-(ctx.maxPrefixChars ?? DEFAULT_MAX_PREFIX_CHARS));
  const suffix = ctx.suffix.slice(0, ctx.maxSuffixChars ?? DEFAULT_MAX_SUFFIX_CHARS);
  const language = ctx.languageId || 'text';

  return [
    `Continue the ${language} code at the cursor.`,
    'Reply with ONLY the code to insert — no explanation, no markdown fences.',
    'At most 12 lines. Match the surrounding style and indentation.',
    'If no useful continuation exists, reply with nothing at all.',
    '',
    'Code before the cursor:',
    '```',
    prefix,
    '```',
    ...(suffix.trim()
      ? ['Code after the cursor:', '```', suffix, '```']
      : []),
  ].join('\n');
}

export interface CleanOptions {
  maxLines?: number;
  maxChars?: number;
}

/**
 * Shapes a raw answer into something the editor can insert.
 *
 * Each rule exists because models do the thing it prevents: they wrap the answer
 * in a fence, they open with a blank line, they explain first, and they keep
 * going well past twelve lines.
 */
export function cleanSuggestion(raw: string, opts: CleanOptions = {}): string {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  let text = (raw ?? '').replace(/\r\n/g, '\n');

  // A fenced answer, with or without a language tag: keep the inside.
  const fenced = /```[a-zA-Z0-9_+-]*\s*\n([\s\S]*?)(?:\n?```|$)/.exec(text);
  if (fenced) text = fenced[1] ?? '';

  // An explanation before the code ("Here is the continuation:").
  text = text.replace(/^[^\n]*(?:here(?:'s| is)[^\n]*|continuation[^\n]*):\s*\n/i, '');

  // Models often indent the whole block by the fence's indentation.
  const lines = text.split('\n');
  while (lines.length && lines[0]!.trim() === '') lines.shift();

  const kept = lines.slice(0, maxLines);

  // Never end mid-statement: drop a last line that has no terminator and no
  // closing bracket, unless it is the only line.
  if (kept.length > 1) {
    const last = kept[kept.length - 1]!;
    const looksComplete = /[;})\]:]|\bend\b|\bpass\b|\breturn\b/.test(last.trimEnd());
    if (last.trim() && !looksComplete && kept.length === maxLines) kept.pop();
  }

  let out = kept.join('\n');

  if (out.length > maxChars) {
    out = out.slice(0, maxChars);
    const lastNewline = out.lastIndexOf('\n');
    if (lastNewline > maxChars * 0.5) out = out.slice(0, lastNewline);
    out = out.replace(/[^\n]*$/, '');
  }

  return out.replace(/\s+$/, '');
}

/** True when the answer is worth offering at all. */
export function isUsable(suggestion: string): boolean {
  const text = suggestion.trim();
  if (!text) return false;
  // A fence or a sentence about the code is not code.
  if (/^```/.test(text)) return false;
  if (/^(sorry|cannot|i can't|i cannot|no continuation)/i.test(text)) return false;
  return true;
}
