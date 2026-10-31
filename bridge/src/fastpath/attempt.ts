/**
 * Batch 9.0b — one fast-path attempt.
 *
 * The HTTP half of the cascade, kept out of the runtime so it can be tested
 * without a controller, a page or a router. It answers one question: did this
 * template produce an answer, or a challenge?
 *
 * The extraction rule is deliberately best-effort and documented, because a
 * template points at an endpoint whose stream shape we do not own: `data:`
 * payloads are read for the common field paths, and anything unrecognised is
 * passed through as text rather than silently dropped.
 */

import { ApiError, isAbortError } from '../api/errors';
import type { FetchLike } from '../api/openaiCompat';
import { classifyResponse, type Detection } from './detect';
import { renderTemplate, type FastPathTemplate, type FastPathVars } from './types';

/** Raised when the fast rung was refused rather than broken: try the next rung. */
export class ChallengeError extends Error {
  constructor(readonly detection: Detection) {
    super(`fast path ${detection.verdict}: ${detection.reason}`);
    this.name = 'ChallengeError';
  }
}

/** How much of a body to read before deciding it is a challenge page. */
const SNIFF_CHARS = 4_000;

export interface AttemptOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  /** Stop reading after this many characters of answer. */
  maxChars?: number;
}

/**
 * Reads one `data:` payload for text.
 *
 * The paths cover what web chat streams actually send; anything else is returned
 * as-is, so a template pointing at a shape we did not anticipate still produces
 * something the user can see and correct.
 */
export function extractTextFromEvent(data: string): string {
  const trimmed = data.trim();
  if (!trimmed || trimmed === '[DONE]') return '';

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return data; // a plain-text stream, or an SSE comment
  }
  if (!payload || typeof payload !== 'object') return '';

  const record = payload as Record<string, unknown>;
  const choice = Array.isArray(record.choices) ? (record.choices[0] as Record<string, unknown>) : undefined;
  const delta = choice?.delta as Record<string, unknown> | undefined;

  // Some providers put the delta at the top level (`{"delta":{"text":…}}`)
  // rather than under `choices`. Reading only the OpenAI shape silently dropped
  // every chunk from those, which looked exactly like an empty answer.
  const recordDelta = record.delta as Record<string, unknown> | undefined;

  const candidates = [
    delta?.content,
    delta?.text,
    recordDelta?.content,
    recordDelta?.text,
    choice?.text,
    record.text,
    record.content,
    (record.message as Record<string, unknown> | undefined)?.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return '';
}

/**
 * Runs the template and yields the answer.
 *
 * Throws `ChallengeError` when the response was refused rather than broken — the
 * caller falls through to the next rung. Anything else is a real failure.
 */
export async function* attemptFast(
  template: FastPathTemplate,
  vars: FastPathVars,
  opts: AttemptOptions = {},
): AsyncIterable<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = renderTemplate(template.bodyTemplate, vars);
  const maxChars = opts.maxChars ?? 200_000;

  let response: Response;
  try {
    response = await fetchImpl(template.url, {
      method: template.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', ...(template.headers ?? {}) },
      body,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (isAbortError(err, opts.signal)) throw err;
    throw new ApiError('EFAST', `fast path request failed: ${(err as Error).message}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const looksStreaming = contentType.includes('event-stream');

  // A refusal never streams: read enough to classify it, then hand back.
  if (!response.ok || !looksStreaming) {
    const text = await response.text().catch(() => '');
    const detection = classifyResponse(
      { status: response.status, contentType, body: text.slice(0, SNIFF_CHARS) },
      looksStreaming ? 'stream' : 'json',
    );
    if (detection.verdict === 'challenge' || detection.verdict === 'auth') {
      throw new ChallengeError(detection);
    }
    if (detection.verdict === 'error') {
      throw new ApiError('EFAST', `fast path: ${detection.reason}`);
    }
    // A non-streaming success: the body is the answer.
    if (text) yield text;
    return;
  }

  if (!response.body) throw new ApiError('EFAST', 'fast path: response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let emitted = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Records are separated by a blank line; anything after the last one is
      // still arriving.
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) break;
        const record = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of record.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const text = extractTextFromEvent(line.slice(5));
          if (!text) continue;
          emitted += text.length;
          yield text;
          if (emitted > maxChars) return;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
