/**
 * Batch 8.0 — reading an SSE stream safely.
 *
 * Ported from `src/providers/common/stream.ts` of AppsGanin/ai-free-vscode
 * (MIT, commit 6f53bad). See docs/batch8/attribution.md.
 *
 * Two things here are not incidental:
 *
 *  - Every read has an idle timeout. A free endpoint can hold a socket open
 *    forever without sending a byte, and "the panel is still waiting" is a worse
 *    failure than "the stream timed out".
 *  - The reader is cancelled in `finally`. An abandoned stream keeps the upstream
 *    generating, which on a metered tier costs the user quota for nothing.
 */

import { IdleTimeoutError, isAbortError } from './errors';

export interface ReadOptions {
  /** For the error message; the caller knows which endpoint went quiet. */
  providerId: string;
  /** Max pause between reads. Defaults to 30 s. */
  idleTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface SseEvent {
  event: string;
  data: string;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/** Rejects if `promise` has not settled within `idleTimeoutMs`. */
export async function withIdleTimeout<T>(
  promise: Promise<T>,
  idleTimeoutMs: number,
  label: string,
): Promise<T> {
  if (!(idleTimeoutMs > 0)) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new IdleTimeoutError(`${label}: no data for ${idleTimeoutMs} ms`)),
          idleTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Yields the raw bytes of a response body, cancelling the reader on exit. */
export async function* readChunks(
  body: ReadableStream<Uint8Array>,
  opts: ReadOptions,
): AsyncIterable<Uint8Array> {
  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const reader = body.getReader();
  try {
    while (!opts.signal?.aborted) {
      const { done, value } = await withIdleTimeout(
        reader.read(),
        idleTimeoutMs,
        opts.providerId,
      );
      if (done) break;
      if (value?.length) yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

/** Same, decoded to text; the trailing partial code point is flushed at the end. */
export async function* readText(
  body: ReadableStream<Uint8Array>,
  opts: ReadOptions,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  for await (const chunk of readChunks(body, opts)) {
    const text = decoder.decode(chunk, { stream: true });
    if (text) yield text;
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

/** Passes a stream through, treating a cancellation as a normal end. */
export async function* ignoreAbort<T>(
  source: AsyncIterable<T>,
  signal?: AbortSignal,
): AsyncIterable<T> {
  try {
    yield* source;
  } catch (err) {
    if (!isAbortError(err, signal)) throw err;
  }
}

/** Index of the next blank-line boundary; `length` is 2 for `\n\n`, 4 for `\r\n\r\n`. */
function findBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  if (lf !== -1) return { index: lf, length: 2 };
  return null;
}

/** One `event:` / `data:` record. Comment lines (`: keep-alive`) are dropped. */
function parseEvent(raw: string): SseEvent {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return { event, data: data.join('\n') };
}

/**
 * Splits `text/event-stream` into records.
 *
 * Records are emitted on a blank line, so a chunk boundary can fall anywhere —
 * mid-JSON, mid-field, between the `\n` and the `\n` of a separator. The buffer
 * carries the remainder across chunks, and the final record is emitted even when
 * the stream ends without a trailing blank line.
 */
export async function* sseEvents(chunks: AsyncIterable<string>): AsyncIterable<SseEvent> {
  let buffer = '';
  for await (const chunk of chunks) {
    buffer += chunk;
    for (;;) {
      const boundary = findBoundary(buffer);
      if (!boundary) break;
      const raw = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const event = parseEvent(raw);
      if (event.data) yield event;
    }
  }
  const tail = parseEvent(buffer);
  if (tail.data) yield tail;
}
