/**
 * Bootstrap ack — §2.3 "bootstrap ack check (retry once)".
 *
 * Send the boot, ask the chat to restate DOING/TODO, check it did. If it did not,
 * retry ONCE with a stricter instruction. One retry, not a loop: a chat that
 * ignores the state twice is not going to be talked into it, and hammering it
 * costs quota the user needs for real work.
 *
 * The result carries the full attempt history so the UI can show what was sent
 * and what came back — a silent "ack failed" would be useless for diagnosis.
 */

import type { AckCheck } from './boot';

export interface AttemptRecord {
  attempt: number;
  promptChars: number;
  answerChars: number;
  ok: boolean;
  missing: string[];
  /** The prompt as actually sent, for the log/panel. */
  prompt: string;
  answer: string;
}

export interface BootstrapResult {
  ok: boolean;
  attempts: number;
  retried: boolean;
  ack: AckCheck;
  answer: string;
  history: AttemptRecord[];
}

export interface BootstrapOptions {
  /** The composed boot prompt. */
  boot: string;
  /** Send a prompt to a fresh chat and return its answer. */
  send: (prompt: string) => Promise<string>;
  /** Ack check against the state. */
  ack: (answer: string) => AckCheck;
  /** Spec says once; kept configurable for tests. */
  maxRetries?: number;
  onAttempt?: (record: AttemptRecord) => void;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export const RETRY_PREAMBLE = [
  'Your previous reply did not restate the project state, so it cannot be trusted to continue.',
  'Restate now, exactly as listed below, one bullet per item under the headings DOING and TODO.',
  'Do not summarise, do not skip items, do not start work yet.',
  '',
].join('\n');

export async function bootstrapChat(opts: BootstrapOptions): Promise<BootstrapResult> {
  const maxRetries = Math.max(0, opts.maxRetries ?? 1);
  const history: AttemptRecord[] = [];
  let lastAck: AckCheck = { ok: false, found: [], missing: [], extra: [] };
  let lastAnswer = '';
  let attempts = 0;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const prompt = attempt === 1 ? opts.boot : `${RETRY_PREAMBLE}${opts.boot}`;
    attempts = attempt;

    opts.log?.('info', `boot attempt ${attempt}/${maxRetries + 1} — ${prompt.length} chars`);
    lastAnswer = await opts.send(prompt);
    lastAck = opts.ack(lastAnswer);

    const record: AttemptRecord = {
      attempt,
      promptChars: prompt.length,
      answerChars: lastAnswer.length,
      ok: lastAck.ok,
      missing: lastAck.missing,
      prompt,
      answer: lastAnswer,
    };
    history.push(record);
    opts.onAttempt?.(record);

    if (lastAck.ok) {
      opts.log?.(
        'info',
        `boot ack OK on attempt ${attempt} — restated ${lastAck.found.length} item(s)`,
      );
      return { ok: true, attempts, retried: attempt > 1, ack: lastAck, answer: lastAnswer, history };
    }

    opts.log?.(
      'warn',
      `boot ack incomplete on attempt ${attempt} — missing ${lastAck.missing.length}: ${lastAck.missing.slice(0, 3).join('; ')}`,
    );
  }

  opts.log?.('error', `boot ack failed after ${attempts} attempt(s) — the chat never restated the state`);
  return { ok: false, attempts, retried: attempts > 1, ack: lastAck, answer: lastAnswer, history };
}
