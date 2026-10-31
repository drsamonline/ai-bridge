/**
 * Batch 8.3b — quick fixes, minus the editor.
 *
 * Adapted from `src/vscode/FixProblemProvider.ts` of AppsGanin/ai-free-vscode
 * (MIT, commit 6f53bad). See docs/batch8/attribution.md.
 *
 * The safety rule of this repository is that an edit the model proposes is
 * reviewable before it lands. So the fix is applied as a single `WorkspaceEdit`
 * over one line range — one undo step, no partial state — and the user is shown
 * the replacement and asked first. A side-by-side diff view is 8.3c; a modal
 * with the exact text is the cheap version of the same guarantee.
 */

export interface FixContext {
  /** The line the diagnostic is on, with a little context around it. */
  code: string;
  /** The diagnostic message, which is usually the most useful part. */
  message: string;
  languageId: string;
  /** 1-based line number, for the prompt only. */
  line: number;
  /** The 0-based index of the diagnostic line inside `code`. */
  offset: number;
}

/** How much surrounding code a fix is shown. */
export const FIX_CONTEXT_LINES = 6;

/**
 * The prompt.
 *
 * Asks for the replacement lines only — the caller swaps a known range, so the
 * model must not try to describe where the change goes.
 */
export function buildFixPrompt(ctx: FixContext): string {
  const language = ctx.languageId || 'text';
  return [
    `Fix the ${language} problem reported at line ${ctx.line}.`,
    `Problem: ${ctx.message}`,
    '',
    'Reply with ONLY the replacement for the marked line — no explanation, no',
    'markdown fences. If the fix needs more than that line, include the extra',
    'lines in order; they replace the marked line as a block.',
    '',
    'Code (the marked line is prefixed with ">> "):',
    '```',
    ...ctx.code.split('\n').map((text, index) =>
      index === ctx.offset ? `>> ${text}` : `   ${text}`,
    ),
    '```',
  ].join('\n');
}

/**
 * Pulls the replacement out of an answer.
 *
 * A fenced block is unwrapped; a bare answer is kept as-is. The `>> ` marker is
 * stripped if the model echoed it back — it was there to point at a line, not to
 * become part of the file.
 */
export function extractReplacement(raw: string): string {
  let text = (raw ?? '').replace(/\r\n/g, '\n');

  const fenced = /```[a-zA-Z0-9_+-]*\s*\n([\s\S]*?)(?:\n?```|$)/.exec(text);
  if (fenced) text = fenced[1] ?? '';

  // A preamble before the code.
  text = text.replace(/^[^\n]*(?:here(?:'s| is)|replacement|fixed)[^\n]*:\s*\n/i, '');

  const lines = text
    .split('\n')
    .map((line) => line.replace(/^>>\s?/, ''))
    .map((line) => (line.startsWith('   ') ? line.slice(3) : line));

  while (lines.length && lines[0]!.trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();

  return lines.join('\n');
}

/**
 * Is this answer a plausible fix?
 *
 * Refusing is better than inserting an apology into someone's source file.
 */
export function isUsableFix(replacement: string): boolean {
  const text = replacement.trim();
  if (!text) return false;
  if (/^(sorry|cannot|i can't|i cannot|unable to)/i.test(text)) return false;
  if (/^```/.test(text)) return false;
  return true;
}

/** The line range a replacement of `replacement` occupies, for the preview. */
export function describeFix(replacement: string): string {
  const lines = replacement.split('\n');
  if (lines.length === 1) return 'replace this line';
  return `replace this line with ${lines.length} lines`;
}
