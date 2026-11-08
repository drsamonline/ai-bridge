/**
 * Turn payload assembly — SPEC v6 §7.
 *
 * What a participant is actually sent, and in what order. This was missing: the
 * runner passed its context block and the snapshot through as raw text, so
 * nothing enforced §7's per-item budgets, nothing fenced the blocks, and nothing
 * told the participant what its role was beyond a line in the preamble it saw
 * once, at handshake, hours ago.
 *
 * Pure by design. The budgets are the spec's numbers in one place, so a test can
 * assert them and a reader can check them against §7 without tracing a call path.
 */

import type { Role } from './stateMachine';

/** §7's per-item caps, in bytes. */
export const PAYLOAD_CAPS = {
  planner: { snapshot: 15 * 1024, plan: 6 * 1024, context: 6 * 1024, questions: 2 * 1024, suffix: 1024 },
  auditor: { snapshot: 30 * 1024, plan: 6 * 1024, context: 2 * 1024, questions: 2 * 1024, suffix: 1024 },
  debater: { snapshot: 0, plan: 6 * 1024, context: 6 * 1024, questions: 2 * 1024, suffix: 1024 },
} as const;

/** §7's role one-liners. Short on purpose: a reminder, not a second preamble. */
export const ROLE_LINE: Record<Role, string> = {
  planner: 'Your job: revise the plan. Return the full updated plan in a fenced block tagged plan.',
  auditor: 'Your job: audit the plan against the code below. Raise an objection if it will not survive.',
  debater: 'Your job: critique the plan\'s reasoning. You are not shown the code.',
};

export const PROTOCOL_SUFFIX = 'REMINDER — end with exactly one token. No code. 500 words max.';

export interface PayloadInput {
  role: Role;
  planText: string;
  contextText: string;
  questionsText: string;
  snapshotText: string;
  /** True on the retry after an untrusted or missing token. */
  retry?: boolean;
}

export interface PayloadBlock {
  name: 'plan' | 'context' | 'questions' | 'snapshot';
  bytes: number;
  /** True when the block was cut to fit its cap. */
  truncated: boolean;
}

export interface Payload {
  text: string;
  bytes: number;
  blocks: PayloadBlock[];
  /** True when any block was cut. Recorded, never silent. */
  truncated: boolean;
}

/** Cut a block to its cap on a byte boundary, without splitting a character. */
function cap(text: string, limit: number): { text: string; truncated: boolean } {
  if (limit <= 0) return { text: '', truncated: text.length > 0 };
  const bytes = Buffer.byteLength(text);
  if (bytes <= limit) return { text, truncated: false };
  const cut = Buffer.from(text).subarray(0, limit).toString('utf8');
  // `toString` on a truncated buffer can end mid-character; drop the replacement
  // character rather than shipping U+FFFD to a model.
  return { text: cut.replace(/\uFFFD$/, ''), truncated: true };
}

const fence = (tag: string, body: string): string => `\`\`\`${tag}\n${body}\n\`\`\``;

/**
 * Assemble the message for one turn.
 *
 * Order matters and follows §7: the plan first, because it is what the turn is
 * about; then what the other participants said; then what the user has not
 * answered; then the code; then the role line and the suffix, which have to be
 * last or a model reads them as part of the plan.
 */
export function buildPayload(input: PayloadInput): Payload {
  const caps = PAYLOAD_CAPS[input.role];
  const blocks: PayloadBlock[] = [];
  const parts: string[] = [];

  const push = (name: PayloadBlock['name'], body: string, limit: number, tag: string): void => {
    if (!body.trim() || limit <= 0) {
      blocks.push({ name, bytes: 0, truncated: false });
      return;
    }
    const cut = cap(body, limit);
    blocks.push({ name, bytes: Buffer.byteLength(cut.text), truncated: cut.truncated });
    parts.push(fence(tag, cut.text));
  };

  push('plan', input.planText, caps.plan, 'plan');
  push('context', input.contextText, caps.context, 'context');
  push('questions', input.questionsText, caps.questions, 'questions');
  push('snapshot', input.snapshotText, caps.snapshot, 'snapshot');

  const tail = [ROLE_LINE[input.role], PROTOCOL_SUFFIX];
  if (input.retry) tail.unshift('RETRY — your previous message ended without a readable control token.');
  parts.push(cap(tail.join('\n'), caps.suffix).text);

  const text = parts.join('\n\n');
  return {
    text,
    bytes: Buffer.byteLength(text),
    blocks,
    truncated: blocks.some((b) => b.truncated),
  };
}
