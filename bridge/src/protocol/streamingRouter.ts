/**
 * Batch 8.1 — holding text back until it is known not to be a tool call.
 *
 * Adapted from `src/providers/common/StreamingToolCallRouter.ts` of
 * AppsGanin/ai-free-vscode (MIT, commit 6f53bad).
 * See docs/batch8/attribution.md.
 *
 * The problem this solves is one of timing. A marker arrives in pieces — ` `` `,
 * ` ```tool_`, ` ```tool_call ` — and by the time the third piece lands, the
 * first two are already on the user's screen as garbage. So a short tail is
 * always held back, and text that turns out to be a call is never shown.
 *
 * Two ways that goes wrong, both bounded here:
 *
 *  - **A false hit.** A markdown fence, a YAML block, a question about JSON.
 *    Held text that stops looking like a call is released after `maxHoldChars`.
 *  - **A huge real call.** A tool taking a whole file. The hold is raised to
 *    `hardCapChars` rather than flushed, so a 200 KB argument still works.
 */

import {
  findToolCallMarkerStart,
  looksLikeToolCallStart,
  parseToolCallsFromText,
  type ParsedToolCall,
} from './toolCalling';

/** Held text that stops looking like a call is released as plain text. */
export const MAX_HOLD_CHARS = 4_096;
/** Hard cap for a confirmed call with huge arguments (a whole file). */
export const HARD_CAP_CHARS = 262_144;
/** Longest marker prefix held back: len('```tool_call') - 1. */
export const MARKER_HOLDBACK_CHARS = 11;
/** Longest transcript-echo marker: len('[Tool result id=') - 1. */
export const TRANSCRIPT_HOLDBACK_CHARS = 15;

/**
 * Where a small model starts playing out the transcript it was shown, instead of
 * answering. Everything after such a marker is dropped.
 *
 * Each alternative is narrowed to what our own prompt actually writes, because a
 * false positive costs the rest of the answer: `\nUser:` at column 0 in that
 * exact casing, our tool-result placeholder, and a call id carrying a capital or
 * a digit (a word like `[call_procedure_key]` written in prose does not).
 */
const TRANSCRIPT_CUT_RE = new RegExp(
  [
    '\\n(?:User|Assistant):(?=[ \\t\\n])',
    '\\[Tool result id=',
    '\\[(?:toolu|call|tooluse)_(?=[\\w-]*[A-Z0-9])[\\w-]{6,}',
  ].join('|'),
  'g',
);

export interface RouterSink {
  text(part: string): void;
  toolCall(call: ParsedToolCall): void;
  /** Called when text was dropped as a transcript echo, for the debug log. */
  dropped?(reason: string, chars: number): void;
}

export interface RouterOptions {
  sink: RouterSink;
  maxHoldChars?: number;
  hardCapChars?: number;
  holdbackChars?: number;
}

/**
 * Position inside the ```` ``` ```` fences of the answer, carried across chunks.
 *
 * A quoted chat log or a YAML `user:` key inside a code block is not a
 * transcript echo, so the cut scan has to know where it is.
 */
interface FenceState {
  open: boolean;
  /** The start of the current line, so a fence split across chunks is caught. */
  lineStart: number;
}

export class StreamingToolCallRouter {
  private held = '';
  private closed = false;
  private readonly sink: RouterSink;
  private readonly maxHoldChars: number;
  private readonly hardCapChars: number;
  private readonly holdbackChars: number;

  constructor(opts: RouterOptions) {
    this.sink = opts.sink;
    this.maxHoldChars = opts.maxHoldChars ?? MAX_HOLD_CHARS;
    this.hardCapChars = opts.hardCapChars ?? HARD_CAP_CHARS;
    this.holdbackChars = opts.holdbackChars ?? MARKER_HOLDBACK_CHARS;
  }

  /** Text that has been emitted as the answer so far is not tracked; callers count. */
  push(chunk: string): void {
    if (this.closed || !chunk) return;
    this.held += chunk;
    this.drain(false);
  }

  /** End of stream: release everything still held. */
  flush(): void {
    if (this.closed) return;
    this.drain(true);
    if (!this.closed && this.held) {
      const rest = this.held;
      this.held = '';
      this.emitText(rest);
    }
    this.closed = true;
  }

  private emitText(text: string): void {
    if (text) this.sink.text(text);
  }

  /**
   * One pass of the state machine. `final` means no more chunks are coming, so
   * an incomplete call is released as text instead of waiting forever.
   */
  private drain(final: boolean): void {
    for (;;) {
      if (this.closed) return;

      const cut = findTranscriptCut(this.held);
      if (cut) {
        // The cut sits on the newline before the marker, so the prefix ends in
        // whitespace that was never part of the answer.
        this.emitText(this.held.slice(0, cut.index).replace(/\s+$/, ''));
        if (this.sink.dropped) this.sink.dropped(cut.reason, this.held.length - cut.index);
        this.held = '';
        this.closed = true;
        return;
      }

      const markerAt = findToolCallMarkerStart(this.held);

      if (markerAt === -1) {
        if (this.held.length <= this.holdbackChars) {
          if (final && this.held) {
            const rest = this.held;
            this.held = '';
            this.emitText(rest);
          }
          return;
        }
        const emitUpTo = this.held.length - this.holdbackChars;
        this.emitText(this.held.slice(0, emitUpTo));
        this.held = this.held.slice(emitUpTo);
        return;
      }

      // Text before the marker is the answer, whatever follows is the call.
      if (markerAt > 0) {
        this.emitText(this.held.slice(0, markerAt));
        this.held = this.held.slice(markerAt);
      }

      // An open wrapper is not a finished call. Without this, the JSON scanner
      // reads the body of ```` ```tool_call ```` before its closing fence has
      // arrived, emits the call, and then flushes the orphaned ```` ``` ```` as
      // text — three backticks appearing in the answer for no reason.
      if (!final && unterminatedWrapper(this.held)) return;

      const calls = parseToolCallsFromText(this.held);
      if (calls.length > 0) {
        for (const call of calls) this.sink.toolCall(call);
        this.held = '';
        return;
      }

      // Still arriving. Hold — unless it has grown past what a real call can be,
      // or it stopped looking like a call at all.
      const overHardCap = this.held.length > this.hardCapChars;
      const notACall = this.held.length > this.maxHoldChars && !looksLikeToolCallStart(this.held);
      if (overHardCap || notACall || final) {
        const released = this.held;
        this.held = '';
        this.emitText(released);
        return;
      }
      return;
    }
  }
}

/**
 * Does the held text open a wrapper it has not closed yet?
 *
 * ```` ```tool_call ```` needs its closing fence, `<tool_call>` its closing tag.
 * While either is open the inside is not a finished call, whatever the JSON
 * scanner could make of a prefix of it.
 */
function unterminatedWrapper(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('```tool_call')) {
    return trimmed.indexOf('```', '```tool_call'.length) === -1;
  }
  if (trimmed.startsWith('<tool_call')) {
    return !trimmed.includes('</tool_call>');
  }
  return false;
}

/**
 * First transcript-echo marker outside a fenced block, if any.
 *
 * Returns the index and a short reason for the log. The fence walk is
 * incremental over the whole held buffer, which is bounded by the hard cap.
 */
export function findTranscriptCut(text: string): { index: number; reason: string } | null {
  const state: FenceState = { open: false, lineStart: 0 };
  let index = 0;

  while (index < text.length) {
    const newline = text.indexOf('\n', index);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(index, lineEnd);

    if (!state.open) {
      TRANSCRIPT_CUT_RE.lastIndex = 0;
      const match = TRANSCRIPT_CUT_RE.exec(text.slice(index - 1 < 0 ? 0 : index - 1));
      // Only accept a match that begins at the start of this line (allowing the
      // leading newline the pattern expects).
      if (match && (match.index === 0 || match.index === 1)) {
        const absolute = (index - 1 < 0 ? 0 : index - 1) + match.index;
        return { index: absolute, reason: match[0].trim().slice(0, 24) };
      }
    }

    if (line.trimStart().startsWith('```')) state.open = !state.open;
    state.lineStart = lineEnd + 1;
    if (newline === -1) break;
    index = lineEnd + 1;
  }

  return null;
}
