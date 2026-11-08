/**
 * Control-token parsing — SPEC v6 §5.
 *
 * Deliberately its own module rather than part of relay.ts, which is where the
 * map put it. Parsing is pure text handling with no dependencies; relay pulls in
 * the fastpath and the CDP controller, and loading that graph to read one line
 * would make the parser's tests depend on a browser it never touches.
 *
 * The rules, in the order they matter:
 *
 *   1. The token is the last non-whitespace line that is OUTSIDE a fenced block.
 *      A plan block is fenced and comes last in a planner turn, so a parser that
 *      ignores fences reads the plan's closing marker as the token.
 *   2. It must match, anchored, one of the six forms. A token mentioned mid
 *      sentence is prose, not a signal.
 *   3. Several tokens → the last one wins, and the caller is told it happened.
 *   4. A response settled by `debounce` is not trusted: the text stopped changing
 *      while the model was still thinking, which is exactly when a half-written
 *      token line sits at the end of the buffer.
 */

export type TokenKind = 'READY' | 'REPLY' | 'ASK_USER' | 'ESCALATE' | 'OBJECTION' | 'CONSENSUS';

export interface Token {
  kind: TokenKind;
  /** Everything after the colon, for the four tokens that carry a payload. */
  body: string;
  /** The matched line, verbatim, for the audit trail. */
  raw: string;
}

export type SettleBy = 'sentinel' | 'stop-gone' | 'debounce' | 'timeout' | 'no-stream';

export interface ParseResult {
  token: Token | null;
  /** Why there is no usable token, when there isn't one. */
  reason: 'NONE' | 'UNTRUSTED_SETTLE' | 'AMBIGUOUS_FENCE' | null;
  /** True when more than one token line was present and the last was taken. */
  multiple: boolean;
}

// Group 1 is the kind on its own and group 2 is the payload. Folding the payload
// into the alternatives made group 1 return "ASK_USER: …" instead of "ASK_USER",
// which every `token.kind === 'ASK_USER'` check then failed to match.
const ANCHORED = /^\[\[(READY|REPLY|CONSENSUS|ASK_USER|ESCALATE|OBJECTION)(?::\s*(.*))?\]\]$/;

/**
 * Split the text into the token line and whether it was inside a fence.
 *
 * A fence opened and never closed is treated as still open: the honest reading of
 * a truncated response is that everything after the marker is inside it, and
 * guessing otherwise turns a truncated plan into a bogus token.
 */
export function tokenLines(text: string): { candidates: string[]; insideFence: string | null } {
  const lines = (text ?? '').split('\n');
  let inFence = false;
  const candidates: string[] = [];
  let insideFence: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!trimmed) continue;
    if (inFence) {
      if (ANCHORED.test(trimmed)) insideFence = trimmed;
      continue;
    }
    candidates.push(trimmed);
  }

  return { candidates, insideFence };
}

/** The last non-whitespace line outside any fence, or null. */
export function lastLineOutsideFence(text: string): string | null {
  const { candidates } = tokenLines(text);
  return candidates.length > 0 ? candidates[candidates.length - 1] ?? null : null;
}

export function parseToken(text: string, settledBy: SettleBy = 'sentinel'): ParseResult {
  const { candidates, insideFence } = tokenLines(text);
  const last = candidates.length > 0 ? candidates[candidates.length - 1] ?? null : null;

  // Only the last line can be the token, so only it is matched — a response that
  // quotes all six forms in its prose is not ambiguous.
  const match = last ? ANCHORED.exec(last) : null;
  if (!match) {
    return {
      token: null,
      reason: insideFence ? 'AMBIGUOUS_FENCE' : 'NONE',
      multiple: false,
    };
  }

  // Count how many of the candidate lines are tokens, for the warning. Cheap, and
  // it is the difference between "the model emitted two tokens" and "it emitted
  // one", which is worth knowing when a response goes wrong.
  const multiple = candidates.filter((line) => ANCHORED.test(line)).length > 1;

  const [, kind, payload] = match;
  const body = payload ?? '';

  if (settledBy === 'debounce') {
    // Parse anyway so the caller can log what it saw, but do not trust it.
    return {
      token: { kind: kind as TokenKind, body: body.trim(), raw: last ?? '' },
      reason: 'UNTRUSTED_SETTLE',
      multiple,
    };
  }

  return {
    token: { kind: kind as TokenKind, body: body.trim(), raw: last ?? '' },
    reason: null,
    multiple,
  };
}

/** §5: an escalation is accepted iff the text after the colon is non-empty. */
export function escalationAccepted(token: Token): boolean {
  return token.kind === 'ESCALATE' && token.body.trim().length > 0;
}

/**
 * The plan artifact, from a fenced block tagged `plan` (§5).
 *
 * Extracted from any planner turn regardless of the terminating token: a planner
 * turn that ends in CONSENSUS still revises the plan, and skipping extraction
 * there would ship an artifact that predates the text everyone agreed to.
 */
export function extractFenced(text: string, tag: string): string | null {
  const lines = (text ?? '').split('\n');
  const open = new RegExp('^```' + tag + '\\s*$', 'i');
  const out: string[] = [];
  let capturing = false;

  for (const line of lines) {
    if (!capturing && open.test(line.trim())) {
      capturing = true;
      continue;
    }
    if (capturing && line.trim() === '```') return out.join('\n').trim() || null;
    if (capturing) out.push(line);
  }
  // Unterminated: treat as absent rather than shipping half a plan.
  return null;
}
