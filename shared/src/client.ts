/**
 * BridgeClient — the extension-side half of the handshake.
 *
 * Deliberately free of any `vscode` import so it can be exercised by the
 * headless test harness (test/handshake.cjs) exactly as the extension runs it.
 * The extension supplies an OutputChannel sink via `on('log')`.
 */

import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import WebSocket from 'ws';
import {
  CLOSE_CODES,
  ERRORS,
  HANDSHAKE_ID,
  PROTOCOL_VERSION,
  type HandshakeData,
} from './protocol';
import { LockError, lockPath, readLock, type LockFile } from './lock';
import { isControlEvent, type ControlEvent, type ControlMsg } from './control';
import type { WireMsg } from './types';

export type BridgeClientState = 'idle' | 'connecting' | 'connected' | 'closed';

export interface BridgeClientOptions {
  /** Override the lock directory (tests). */
  lockDir?: string;
  /** Handshake deadline. */
  connectTimeoutMs?: number;
  /** Per-request deadline. */
  requestTimeoutMs?: number;
  /** Client label shown in bridge logs. */
  label?: string;
}

export interface BridgeClientEvents {
  log: [level: 'info' | 'warn' | 'error', message: string];
  connecting: [target: { host: string; port: number; lockPath: string }];
  connected: [data: HandshakeData];
  disconnected: [info: { code: number; reason: string }];
  /** Unsolicited bridge push: watchdog, tab lifecycle, RAM samples. */
  event: [event: ControlEvent];
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export class BridgeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private _state: BridgeClientState = 'idle';
  private pending = new Map<string, Pending>();
  private seq = 0;
  private handshake: HandshakeData | null = null;
  private lastLock: LockFile | null = null;

  constructor(private readonly opts: BridgeClientOptions = {}) {
    super();
  }

  get state(): BridgeClientState {
    return this._state;
  }

  get handshakeData(): HandshakeData | null {
    return this.handshake;
  }

  get lock(): LockFile | null {
    return this.lastLock;
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit('log', level, message);
  }

  /**
   * Read the lock, open the socket, send `attach`, await the handshake result.
   * Throws BridgeError on any failure — never resolves optimistically.
   */
  async connect(): Promise<HandshakeData> {
    if (this._state === 'connected' && this.handshake) return this.handshake;

    this._state = 'connecting';
    const dir = this.opts.lockDir;
    const path = lockPath(dir ?? undefined);

    let lock: LockFile;
    try {
      const read = readLock(dir ?? undefined);
      lock = read.lock;
      this.log(
        'info',
        `lock file read: ${read.path} (mode 0${read.mode.toString(8)}) pid=${lock.pid} port=${lock.port}`,
      );
    } catch (err) {
      this._state = 'closed';
      if (err instanceof LockError) {
        throw new BridgeError(`bridge not reachable: ${err.message}`, err.code);
      }
      throw err;
    }

    this.lastLock = lock;
    const url = `ws://${lock.host}:${lock.port}`;
    this.emit('connecting', { host: lock.host, port: lock.port, lockPath: path });
    this.log('info', `dialling ${url}`);

    const ws = new WebSocket(url, {
      handshakeTimeout: this.opts.connectTimeoutMs ?? 5_000,
      perMessageDeflate: false,
      maxPayload: 8 * 1024 * 1024,
    });
    this.ws = ws;

    ws.on('message', (raw) => this.onMessage(raw));
    ws.on('close', (code, reason) => this.onClose(code, reason.toString()));
    ws.on('error', (err) => this.log('error', `socket error: ${err.message}`));

    const data = await new Promise<HandshakeData>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new BridgeError('handshake timed out', ERRORS.ETIMEOUT));
        ws.terminate();
      }, this.opts.connectTimeoutMs ?? 5_000);

      ws.once('open', () => {
        this.log('info', 'socket open — sending { op: "attach" }');
        ws.send(
          JSON.stringify({
            op: 'attach',
            port: lock.port,
            token: lock.token,
            rid: HANDSHAKE_ID,
          } satisfies WireMsg),
        );
      });

      const onResult = (msg: WireMsg) => {
        if (msg.op !== 'result' || msg.id !== HANDSHAKE_ID) return;
        clearTimeout(timer);
        this.off('_result', onResult);
        if (!msg.ok) {
          reject(new BridgeError(msg.error ?? 'handshake rejected', ERRORS.EAUTH));
          return;
        }
        resolve(msg.data as HandshakeData);
      };
      this.on('_result', onResult);

      ws.once('error', (err) => {
        clearTimeout(timer);
        this.off('_result', onResult);
        reject(new BridgeError(`cannot reach bridge: ${err.message}`, 'ECONNREFUSED'));
      });
      ws.once('close', (code, reason) => {
        clearTimeout(timer);
        this.off('_result', onResult);
        if (code === CLOSE_CODES.UNAUTHORIZED) {
          reject(new BridgeError('bridge rejected the token (401)', ERRORS.EAUTH));
        } else {
          reject(
            new BridgeError(`bridge closed during handshake: ${code} ${reason.toString()}`, 'ECLOSED'),
          );
        }
      });
    });

    if (data.bridge.protocol !== PROTOCOL_VERSION) {
      this.log(
        'warn',
        `protocol mismatch: bridge speaks v${data.bridge.protocol}, extension speaks v${PROTOCOL_VERSION}`,
      );
    }

    this.handshake = data;
    this._state = 'connected';
    this.log(
      'info',
      `handshake OK — pid=${data.bridge.pid} v${data.bridge.version} protocol=v${data.bridge.protocol} token=${data.tokenFingerprint} caps=[${data.capabilities.join(',')}]`,
    );
    this.emit('connected', data);
    return data;
  }

  /** Send any §4 or `ctl.*` message and await its `{ op: 'result' }` reply. */
  async request(msg: WireMsg | ControlMsg, timeoutMs?: number): Promise<unknown> {
    if (this._state !== 'connected' || !this.ws) {
      throw new BridgeError('not connected', 'ENOTCONN');
    }
    const rid = (msg as WireMsg).rid ?? `r${++this.seq}`;
    const payload = JSON.stringify({ ...msg, rid });

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new BridgeError(`request ${msg.op} timed out`, ERRORS.ETIMEOUT));
      }, timeoutMs ?? this.opts.requestTimeoutMs ?? 30_000);
      this.pending.set(rid, { resolve, reject, timer });
      this.ws!.send(payload);
    });
  }

  close(code = CLOSE_CODES.NORMAL, reason = 'client-close'): void {
    for (const [rid, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError('client closed', 'ECLOSED'));
      this.pending.delete(rid);
    }
    this._state = 'closed';
    this.handshake = null;
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch {
        this.ws.terminate();
      }
      this.ws = null;
    }
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: WireMsg;
    try {
      msg = JSON.parse(raw.toString()) as WireMsg;
    } catch {
      this.log('warn', 'dropped non-JSON frame from bridge');
      return;
    }

    if (msg.op === 'result') {
      this.emit('_result', msg);
      const rid = msg.id;
      const p = this.pending.get(rid);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(rid);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new BridgeError(msg.error ?? 'request failed', 'EREMOTE'));
      }
      return;
    }
    const maybeEvent: unknown = msg;
    if (isControlEvent(maybeEvent)) {
      this.emit('event', maybeEvent);
      if (maybeEvent.kind !== 'ram.sample') this.log('info', `<- ${maybeEvent.kind}`);
      return;
    }
    this.log('info', `<- ${msg.op}`);
  }

  private onClose(code: number, reason: string): void {
    const was = this._state;
    this._state = 'closed';
    this.ws = null;
    this.log(
      was === 'connected' ? 'warn' : 'info',
      `socket closed (code=${code}${reason ? ` reason=${reason}` : ''})`,
    );
    this.emit('disconnected', { code, reason });
  }
}

/** sha256 hex fingerprint — mirrored in the bridge for the handshake payload. */
export function fingerprint(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}
