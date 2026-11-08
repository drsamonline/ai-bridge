/**
 * Native messaging framing — the transport Chrome launches for us.
 *
 * This is the third transport: the unix socket (authorised by its own permissions),
 * TCP loopback (authorised by a token and the guard), and stdio (authorised by
 * Chrome having launched us with the extension's origin as argv[1]). Same process,
 * same protocol, one more way in.
 *
 * The framing is Chrome's, not ours: a JSON message, UTF-8, prefixed with its length
 * as a 32-bit integer in **native byte order**. Every implementation of this on a
 * little-endian machine is little-endian, so that is what this writes — and the
 * decoder reads either, because a big-endian port would otherwise fail silently.
 *
 * Pure: buffers in, buffers out. The stdio loop that calls it lives in main.ts,
 * which is why this is testable without a browser.
 */

/** Chrome refuses a host message larger than 1 MB; refusing earlier is clearer. */
export const MAX_FRAME_BYTES = 1024 * 1024;

export interface DecodeResult {
  messages: unknown[];
  /** The tail of an incomplete frame, to prepend to the next chunk. */
  rest: Buffer;
}

/**
 * One message, framed for stdout.
 *
 * Writes little-endian regardless of host byte order: the extension side reads what
 * Chrome gives it, and Chrome's own framing on x86 and ARM is little-endian.
 */
export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_FRAME_BYTES) {
    throw new Error(`EFRAME: ${body.length} bytes exceeds the ${MAX_FRAME_BYTES}-byte native-messaging limit`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Every complete message in `chunk`, plus whatever is left over.
 *
 * A pipe delivers arbitrary boundaries: one read can hold half a frame or three and
 * a half. Callers must keep `rest` and pass it back with the next chunk, which is
 * the part everyone gets wrong first.
 */
export function decodeFrames(chunk: Buffer, rest: Buffer = Buffer.alloc(0)): DecodeResult {
  let buffer = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
  const messages: unknown[] = [];

  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (length > MAX_FRAME_BYTES) {
      // A bogus length means the stream is not ours any more; throwing is better
      // than waiting for 3 GB that will never arrive.
      throw new Error(`EFRAME: declared length ${length} exceeds the ${MAX_FRAME_BYTES}-byte limit`);
    }
    if (buffer.length < 4 + length) break; // incomplete; keep it for next time

    const body = buffer.subarray(4, 4 + length);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      throw new Error('EFRAME: a complete frame was not valid JSON');
    }
    messages.push(parsed);
    buffer = buffer.subarray(4 + length);
  }

  return { messages, rest: Buffer.from(buffer) };
}

/** Chrome passes the calling extension's origin as the first argument. */
export function originFromArgv(argv: readonly string[]): string | null {
  const candidate = argv[2];
  return candidate && /^chrome-extension:\/\/[a-p]{32}\/$/.test(candidate) ? candidate : null;
}
