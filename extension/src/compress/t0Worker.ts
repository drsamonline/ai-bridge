/**
 * T0 worker entry — spec §5.6 ("T0, always, WW").
 *
 * The module graph here is deliberately tiny (`t0Worker → t0 → text/tokens`), so
 * a fresh isolate costs almost nothing: no shared package, no WebSocket client.
 */

import { parentPort } from 'node:worker_threads';
import { compressT0, type CompressOptions, type CompressResult } from './t0';

interface Request {
  id: number;
  text: string;
  opts: CompressOptions;
}

export interface CompressReply {
  id: number;
  ok: boolean;
  result?: CompressResult;
  error?: string;
}

if (!parentPort) {
  throw new Error('t0Worker must be started as a worker thread');
}

parentPort.on('message', (msg: Request) => {
  try {
    const result = compressT0(msg.text, msg.opts);
    const reply: CompressReply = { id: msg.id, ok: true, result };
    parentPort!.postMessage(reply);
  } catch (err) {
    const reply: CompressReply = { id: msg.id, ok: false, error: (err as Error).message };
    parentPort!.postMessage(reply);
  }
});

parentPort.postMessage({ ready: true });
