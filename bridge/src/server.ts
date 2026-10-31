/**
 * Bridge WS server.
 *
 * Binds 127.0.0.1 only. The first frame on every socket MUST be
 * `{ op: 'attach', port, token }` with the token from the lock file; anything
 * else closes the socket with 4001.
 *
 * Routed after auth:
 *   §4 `attach`      → handshake acknowledgement
 *   §4 `recycle`     → controller.recycle (close/reopen the active owned tab)
 *   §4 send/navigate → blocked with ERAMBLOCK at 100% RAM, ENOTIMPL until 1.1
 *   `ctl.*`          → BridgeRuntime (browser attach, tabs, RAM, config)
 *   anything else    → `{ ok:false, error:'ENOTIMPL: …' }` — never silence.
 *
 * Bridge→extension pushes travel as `{ op:'ctl.event', kind, t, data }`.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  BIND_HOST,
  CLOSE_CODES,
  ERRORS,
  HANDSHAKE_ID,
  HEARTBEAT_MS,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  SOCKET_MODE,
  socketPath,
  isBridgeMsg,
  isControlMsg,
  type ControlEvent,
  type ControlMsg,
  type HandshakeData,
  type WireMsg,
} from '@ai-bridge/shared';
import type { Logger } from './logger';
import type { BridgeRuntime } from './runtime';

export interface BridgeServerOptions {
  port: number;
  token: string;
  version: string;
  log: Logger;
  runtime: BridgeRuntime;
  startedAt?: number;
}

export interface BridgeServer {
  readonly port: number;
  readonly address: string;
  readonly clients: number;
  close(): Promise<void>;
}

interface ClientState {
  authed: boolean;
  alive: boolean;
  remote: string;
  connectedAt: number;
  requests: number;
}

/** Ops the bridge answers, for the ENOTIMPL message. */
const KNOWN_BUT_LATER = ['extract', 'inject', 'models'];

export async function startBridgeServer(opts: BridgeServerOptions): Promise<BridgeServer> {
  const { log, runtime } = opts;
  const startedAt = opts.startedAt ?? Date.now();
  const tokenHash = createHash('sha256').update(opts.token).digest();
  const states = new Map<WebSocket, ClientState>();

  // Batch 9.5: the transport is a local socket, and its permissions are the
  // authorisation — 0600 on POSIX, a user-scoped pipe on Windows. That is what
  // lets the session token stop being a file on disk.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
    perMessageDeflate: false,
    clientTracking: true,
  });

  const socketFile = socketPath();
  const socketServer = createServer();
  const tcpServer = createServer();

  const upgradeWith = (viaSocket: boolean) => (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (viaSocket) (ws as WebSocket & { viaSocket?: boolean }).viaSocket = true;
      wss.emit('connection', ws, req);
    });
  };
  socketServer.on('upgrade', upgradeWith(true));
  tcpServer.on('upgrade', upgradeWith(false));

  // The TCP fallback stays for one release: if the socket path misbehaves on a
  // machine I cannot test, one environment variable restores the old transport.
  const useTcp = process.env.AI_BRIDGE_TRANSPORT === 'tcp';

  if (process.platform !== 'win32') {
    // A bridge that was killed leaves the socket behind, and listen() refuses.
    try {
      fs.unlinkSync(socketFile);
    } catch {
      /* not there */
    }
  }

  await new Promise<void>((resolve, reject) => {
    socketServer.once('error', reject);
    socketServer.listen(socketFile, () => resolve());
  });
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(socketFile, SOCKET_MODE);
    } catch {
      /* best effort: a filesystem that refuses chmod */
    }
  }

  let boundPort = opts.port;
  if (useTcp) {
    await new Promise<void>((resolve, reject) => {
      tcpServer.once('error', reject);
      tcpServer.listen(opts.port, BIND_HOST, () => resolve());
    });
    const addr = tcpServer.address();
    boundPort = addr && typeof addr === 'object' ? addr.port : opts.port;
  }

  log.info(
    useTcp ? `listening on ${socketFile} and ws://${BIND_HOST}:${boundPort}` : `listening on ${socketFile}`,
    { protocol: PROTOCOL_VERSION, maxPayload: MAX_PAYLOAD_BYTES },
  );

  const tokenOk = (candidate: unknown): boolean => {
    if (typeof candidate !== 'string' || !/^[0-9a-f]{64}$/.test(candidate)) return false;
    const got = createHash('sha256').update(candidate).digest();
    return got.length === tokenHash.length && timingSafeEqual(got, tokenHash);
  };

  const send = (ws: WebSocket, payload: unknown): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const deny = (ws: WebSocket, code: number, reason: string, detail: string): void => {
    log.warn(`rejected client: ${detail}`, { code, reason });
    send(ws, { op: 'result', id: HANDSHAKE_ID, ok: false, error: detail });
    ws.close(code, reason);
  };

  /** Route one authenticated message. Throws to produce a `result` with `ok:false`. */
  const dispatch = async (msg: WireMsg | ControlMsg): Promise<unknown> => {
    if (isControlMsg(msg)) {
      if (runtime.blocked && msg.op === 'ctl.tab.open') {
        throw new Error(
          `${ERRORS.ERAMBLOCK}: RAM cap reached — close a tab or raise the cap before opening another`,
        );
      }
      return runtime.control(msg);
    }

    switch (msg.op) {
      case 'attach':
        // The socket file outlives the process otherwise, and the next start would
  // find it and refuse to listen.
  const cleanupSocket = () => {
    try {
      socketServer.close();
      tcpServer.close();
      if (process.platform !== 'win32') fs.unlinkSync(socketFile);
    } catch {
      /* already gone */
    }
  };
  process.once('exit', cleanupSocket);

  return { note: 'already attached', status: runtime.status() };
      case 'recycle':
        return runtime.controller.recycle('user');
      case 'navigate':
      case 'send':
        if (runtime.blocked) {
          throw new Error(`${ERRORS.ERAMBLOCK}: RAM cap reached — requests are blocked`);
        }
        return msg.op === 'navigate' ? runtime.navigate(msg) : runtime.send(msg);
      case 'observe':
        return runtime.observe(msg);
      case 'health':
        return runtime.health(msg.adapterId);
      default:
        if (KNOWN_BUT_LATER.includes(msg.op)) {
          throw new Error(`${ERRORS.ENOTIMPL}: op "${msg.op}" lands in a later batch`);
        }
        throw new Error(`${ERRORS.ENOTIMPL}: op "${msg.op}" is not implemented`);
    }
  };

  // ---- pushes -----------------------------------------------------------
  const onEvent = (event: ControlEvent) => {
    let delivered = 0;
    for (const ws of wss.clients) {
      if (states.get(ws)?.authed) {
        send(ws, event);
        delivered += 1;
      }
    }
    if (delivered === 0 && event.kind !== 'ram.sample') {
      log.debug(`event ${event.kind} had no subscribers`);
    }
  };
  runtime.bus.on('event', onEvent);

  // ---- connections ------------------------------------------------------
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const remote = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    const state: ClientState = {
      authed: false,
      alive: true,
      remote,
      connectedAt: Date.now(),
      requests: 0,
    };
    states.set(ws, state);
    log.info(`client connected ${remote}`, { clients: wss.clients.size });

    const authTimer = setTimeout(() => {
      if (!state.authed) deny(ws, CLOSE_CODES.TIMEOUT, 'no-handshake', 'ETIMEOUT: no attach within 5s');
    }, 5_000);

    ws.on('pong', () => {
      state.alive = true;
    });

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        deny(ws, CLOSE_CODES.PROTOCOL_ERROR, 'binary', 'EPROTO: binary frames unsupported');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        deny(ws, CLOSE_CODES.PROTOCOL_ERROR, 'bad-json', 'EPROTO: frame is not JSON');
        return;
      }
      if (!isBridgeMsg(parsed) && !isControlMsg(parsed)) {
        deny(ws, CLOSE_CODES.PROTOCOL_ERROR, 'bad-op', 'EPROTO: unknown op');
        return;
      }

      const msg = parsed as WireMsg | ControlMsg;
      state.requests += 1;

      if (!state.authed) {
        if (msg.op !== 'attach') {
          deny(ws, CLOSE_CODES.UNAUTHORIZED, 'not-authed', 'EAUTH: attach required first');
          return;
        }
        clearTimeout(authTimer);
        // Batch 9.5: a peer that reached the socket is already authorised — the
        // OS refused everyone else. The token is only meaningful on the TCP
        // fallback, where nothing else distinguishes one local user from another.
        const viaSocket = (ws as WebSocket & { viaSocket?: boolean }).viaSocket === true;
        if (!viaSocket && !tokenOk((msg as { token?: unknown }).token)) {
          deny(ws, CLOSE_CODES.UNAUTHORIZED, 'bad-token', 'EAUTH: token mismatch');
          return;
        }
        state.authed = true;
        const data: HandshakeData = {
          bridge: {
            pid: process.pid,
            version: opts.version,
            protocol: PROTOCOL_VERSION,
            startedAt,
            uptimeMs: Date.now() - startedAt,
          },
          // Batch 9.5: an empty fingerprint says "no credential was presented",
          // which is the truth for a socket peer.
          tokenFingerprint: viaSocket
            ? ''
            : createHash('sha256').update(opts.token).digest('hex').slice(0, 12),
          capabilities: ['attach', 'recycle', 'navigate', 'send', 'observe', 'health', 'ctl.*'],
        };
        log.info('handshake OK — token accepted', {
          remote,
          pid: process.pid,
          protocol: PROTOCOL_VERSION,
          fingerprint: data.tokenFingerprint,
        });
        send(ws, { op: 'result', id: (msg as WireMsg).rid ?? HANDSHAKE_ID, ok: true, data });
        return;
      }

      const rid = (msg as WireMsg).rid ?? `srv${state.requests}`;
      void (async () => {
        try {
          const data = await dispatch(msg);
          send(ws, { op: 'result', id: rid, ok: true, data: data ?? null });
        } catch (err) {
          const message = (err as Error).message;
          if (!message.startsWith(ERRORS.ENOTIMPL)) {
            log.warn(`op ${msg.op} failed: ${message}`);
          }
          send(ws, { op: 'result', id: rid, ok: false, error: message });
        }
      })();
    });

    ws.on('close', (code, reason) => {
      clearTimeout(authTimer);
      states.delete(ws);
      log.info(`client disconnected ${remote}`, {
        code,
        reason: reason.toString(),
        requests: state.requests,
        clients: wss.clients.size,
      });
    });

    ws.on('error', (err) => {
      log.error(`socket error from ${remote}: ${err.message}`);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const st = states.get(ws);
      if (!st) continue;
      if (!st.alive) {
        log.warn(`terminating unresponsive client ${st.remote}`);
        ws.terminate();
        continue;
      }
      st.alive = false;
      try {
        ws.ping();
      } catch {
        /* next sweep will collect it */
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    port: boundPort,
    address: `ws://${BIND_HOST}:${boundPort}`,
    get clients() {
      return wss.clients.size;
    },
    async close() {
      clearInterval(heartbeat);
      runtime.bus.off('event', onEvent);
      for (const ws of wss.clients) ws.close(CLOSE_CODES.GOING_AWAY, 'bridge-shutdown');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      log.info('server closed');
    },
  };
}
