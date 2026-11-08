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
import * as path from 'node:path';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { corsHeaders, NonceStore, route } from './server/guard';
import {
  BIND_HOST,
  CLOSE_CODES,
  ERRORS,
  HANDSHAKE_ID,
  HEARTBEAT_MS,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  SOCKET_MODE,
  assertOwnerOnly,
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

  // §13. The nonce is a one-time key to open the page; the protocol token is
  // exchanged for it at /auth and never appears in a URL, where it would end up in
  // history and in any Referer.
  const nonces = new NonceStore();
  let guardPort = opts.port;

  /**
   * The served shell: one HTML file, injected with a one-time nonce.
   *
   * Read from `dist/` rather than inlined, so the same file can be bundled into the
   * extension for Option A — one UI, two hosts. If it is missing the bridge still
   * answers, because a shell that 500s tells you less than a page that says why.
   */
  const shellPage = (nonce: string): string => {
    const file = path.join(__dirname, 'server', 'panel.html');
    try {
      const html = fs.readFileSync(file, 'utf8');
      const config = JSON.stringify({ nonce, wsUrl: `ws://127.0.0.1:${guardPort}/` }).replace(/</g, '\\u003c');
      return html.replace('</head>', `<script>window.__BRIDGE__ = ${config};</script>\n</head>`);
    } catch (err) {
      log.warn('panel.html missing; serving the fallback page', { file, error: (err as Error).message });
      return fallbackPage(nonce);
    }
  };

  const fallbackPage = (nonce: string): string => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>AI Bridge Debate</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#0a0b0f;color:#ece7dd;
display:grid;place-items:center;min-height:100vh}main{max-width:44ch;padding:32px}
code{background:#161a22;padding:2px 6px;border-radius:4px;font-size:13px}
p{color:#9a958a}</style></head>
<body><main><h1>AI Bridge Debate</h1>
<p id="status">Exchanging the one-time key…</p>
<p>The debate interface is not built yet. This page exists so the shell's
authorisation path is real rather than described.</p>
<p><code id="fingerprint"></code></p>
<script>
const nonce = ${JSON.stringify(nonce)};
fetch('/auth', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ nonce }) })
  .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
  .then((data) => {
    document.getElementById('status').textContent = 'Key exchanged. Protocol token held in memory.';
    document.getElementById('fingerprint').textContent = 'token ' + data.tokenFingerprint;
    sessionStorage.setItem('ai-bridge-token', data.token);
  })
  .catch((err) => { document.getElementById('status').textContent = 'Refused: ' + err.message; });
</script></main></body></html>`;

  const tcpServer = createServer((req, res) => {
    const decision = route(
      { method: req.method, url: req.url, headers: req.headers as Record<string, string | undefined> },
      guardPort,
    );
    const forAuth = decision.action === 'auth';
    const headers = { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders(req, guardPort, forAuth) };

    if (decision.action === 'deny') {
      log.warn('served-shell request refused', { status: decision.status, reason: decision.reason });
      res.writeHead(decision.status, headers).end(decision.reason);
      return;
    }

    if (decision.action === 'serve-shell') {
      const nonce = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('nonce') ?? '';
      if (!nonces.verify(nonce)) {
        res.writeHead(403, headers).end('a live nonce is required — use the URL the bridge printed');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(shellPage(nonce));
      return;
    }

    // /auth: the only route that changes anything, and the only one that spends
    // the nonce.
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      let presented = '';
      try {
        presented = (JSON.parse(body) as { nonce?: string }).nonce ?? '';
      } catch {
        presented = '';
      }
      if (!nonces.consume(presented)) {
        res.writeHead(403, headers).end('nonce already used or invalid');
        return;
      }
      res.writeHead(200, { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(
        JSON.stringify({
          token: opts.token,
          tokenFingerprint: createHash('sha256').update(opts.token).digest('hex').slice(0, 12),
        }),
      );
    });
  });

  const upgradeWith = (viaSocket: boolean) => (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    if (!viaSocket) {
      // Same rules as HTTP: a socket transport is authorised by its own
      // permissions, a loopback TCP upgrade is not.
      const decision = route(
        { method: 'GET', url: req.url, headers: req.headers as Record<string, string | undefined> },
        guardPort,
      );
      if (decision.action === 'deny') {
        log.warn('websocket upgrade refused', { status: decision.status, reason: decision.reason });
        socket.end(`HTTP/1.1 ${decision.status} Refused\r\nConnection: close\r\n\r\n`);
        return;
      }
    }
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
      // Best effort attempt; assertOwnerOnly below is the actual decision.
    }
    // The socket is the only thing authenticating a client now, so an
    // un-tightenable mode means the bridge must not run.
    assertOwnerOnly(socketFile, 'bridge socket');
  }

  let boundPort = opts.port;
  if (useTcp) {
    await new Promise<void>((resolve, reject) => {
      tcpServer.once('error', reject);
      tcpServer.listen(opts.port, BIND_HOST, () => resolve());
    });
    const addr = tcpServer.address();
    boundPort = addr && typeof addr === 'object' ? addr.port : opts.port;
    guardPort = boundPort;

    const nonce = nonces.issue();
    log.info(`served shell: http://127.0.0.1:${boundPort}/?nonce=${nonce}`, {
      expiresInMs: 5 * 60 * 1000,
      note: 'single use; exchange it at /auth for the protocol token',
    });
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
        log.info(viaSocket ? 'handshake OK — socket peer' : 'handshake OK — token accepted', {
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
