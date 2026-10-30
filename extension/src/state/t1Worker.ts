/**
 * T1 worker entry — spec §5.5 ("every turn, Web Worker").
 *
 * Runs the regex extraction off the extension-host thread. The VS Code extension
 * host is Node, so "Web Worker" here is `worker_threads`; the isolation that
 * matters (no blocking the UI thread) is the same.
 */

import { parentPort } from 'node:worker_threads';
import { extractT1, type T1Input, type T1Result } from './extract';

interface Request {
  id: number;
  input: T1Input;
}

export interface T1Reply {
  id: number;
  ok: boolean;
  result?: T1Result;
  error?: string;
}

if (!parentPort) {
  throw new Error('t1Worker must be started as a worker thread');
}

parentPort.on('message', (msg: Request) => {
  try {
    const result = extractT1(msg.input);
    const reply: T1Reply = { id: msg.id, ok: true, result };
    parentPort!.postMessage(reply);
  } catch (err) {
    const reply: T1Reply = { id: msg.id, ok: false, error: (err as Error).message };
    parentPort!.postMessage(reply);
  }
});

parentPort.postMessage({ ready: true });
