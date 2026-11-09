#!/usr/bin/env node
/**
 * Served-shell end-to-end harness — SPEC v6 §13, over a real socket.
 *
 * `server-guard.cjs` tests the policy as pure functions. This tests that the
 * server *uses* it: a real TCP listener, real headers, a real nonce, and a real
 * token exchange. The distinction matters because the guard is a module the
 * server could stop calling, and a pure test would not notice.
 *
 * The threat being modelled: any page the user has open can POST to loopback, and
 * DNS rebinding makes its own hostname resolve to 127.0.0.1 — so the connection
 * genuinely arrives and only the Host header gives it away.
 */

'use strict';

const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const results = [];
let failures = 0;

function check(name, fn) {
  try {
    fn();
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`FAIL  ${name}\n      ${err.message}`);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

const TOKEN = 'a'.repeat(64);

/** A request with full control of Host and Origin, which fetch will not give us. */
function request(port, { method = 'GET', url = '/', host, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (host !== null) headers.host = host ?? `127.0.0.1:${port}`;
    if (origin) headers.origin = origin;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

// The bridge server holds a unix socket and a WebSocket server open, so the
// process will not exit on its own. A watchdog turns a hang into a failure with
// output, which is the difference between a test and a mystery.
const watchdog = setTimeout(() => {
  console.log('\nTIMEOUT — the shell suite did not finish in 25s');
  process.exit(1);
}, 25_000);

(async () => {
  console.log('');

  // os.tmpdir(), not '/tmp': Windows has no /tmp, and the suite failed there
  // with ENOENT: mkdtemp '/tmp/abs-shell-XXXXXX' before it ever started.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-shell-'));
  process.env.AI_BRIDGE_HOME = home;
  // `main.ts` creates this before starting the server; calling startBridgeServer
  // directly means the socket's directory does not exist yet, and listen() reports
  // that as EACCES rather than ENOENT.
  fs.mkdirSync(path.join(home, '.ai-bridge'), { recursive: true, mode: 0o700 });
  process.env.AI_BRIDGE_TRANSPORT = 'tcp';

  const logged = [];
  const log = {
    info: (msg) => logged.push(String(msg)),
    warn: (msg) => logged.push(String(msg)),
    error: (msg) => logged.push(String(msg)),
    debug: () => {},
    child() {
      return this;
    },
  };

  const { startBridgeServer } = require('../bridge/dist/server.js');
  const { EventEmitter } = require('node:events');

  const server = await startBridgeServer({
    port: 0,
    token: TOKEN,
    version: '0.0.0-test',
    log,
    // The HTTP side needs none of the runtime; the connection handler subscribes
    // to the bus, so that much has to exist.
    runtime: { bus: new EventEmitter() },
  });

  const port = server.port;
  const line = logged.find((m) => m.includes('served shell:')) ?? '';
  const nonce = /nonce=([A-Za-z0-9_-]+)/.exec(line)?.[1] ?? '';

  /* ---------------------------------------------------------------- the nonce */

  check('shell: the bridge prints a nonce URL at startup', () => {
    assert.ok(port > 0, 'the server must bind a port');
    assert.ok(nonce.length >= 40, `expected a nonce in the log, got: ${line}`);
  });

  /* ------------------------------------------------------------ host and origin */

  await (async () => {
    const res = await request(port, { host: 'evil.test' });
    check('shell: a rebinding Host is refused before the route is looked at', () => {
      assert.equal(res.status, 421);
      assert.match(res.body, /host/);
    });
  })();

  await (async () => {
    const res = await request(port, { method: 'POST', url: '/auth', origin: 'https://evil.test', body: { nonce } });
    check('shell: a cross-origin POST to /auth is refused', () => {
      assert.equal(res.status, 403);
    });
  })();

  /* ------------------------------------------------------------------ the page */

  await (async () => {
    const res = await request(port, {});
    check('shell: the page is not served without a nonce', () => {
      assert.equal(res.status, 403);
      assert.match(res.body, /nonce/);
    });
  })();

  await (async () => {
    const res = await request(port, { url: `/?nonce=${nonce}` });
    check('shell: the page is served against a live nonce, and carries no token', () => {
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /text\/html/);
      assert.ok(res.body.includes(nonce), 'the page needs the nonce to exchange it');
      assert.ok(!res.body.includes(TOKEN), 'the protocol token must never be in the HTML');
      assert.equal(res.headers['cache-control'], 'no-store');
    });
  })();

  /* ------------------------------------------------------------------ the auth */

  await (async () => {
    const res = await request(port, { method: 'POST', url: '/auth', origin: `http://127.0.0.1:${port}`, body: { nonce } });
    check('shell: /auth exchanges the nonce for the token, once', () => {
      assert.equal(res.status, 200);
      const payload = JSON.parse(res.body);
      assert.equal(payload.token, TOKEN);
      assert.equal(payload.tokenFingerprint.length, 12, 'the fingerprint is 12 hex characters');
      assert.equal(res.headers['access-control-allow-origin'], `http://127.0.0.1:${port}`);
    });
  })();

  await (async () => {
    const res = await request(port, { method: 'POST', url: '/auth', origin: `http://127.0.0.1:${port}`, body: { nonce } });
    check('shell: the same nonce cannot be spent twice', () => {
      assert.equal(res.status, 403);
    });
  })();

  await (async () => {
    const res = await request(port, { url: `/?nonce=${nonce}` });
    check('shell: a spent nonce no longer opens the page', () => {
      assert.equal(res.status, 403);
    });
  })();

  /* ---------------------------------------------------------------- everything else */

  await (async () => {
    const res = await request(port, { url: '/nope' });
    check('shell: an unknown route is a 404, not the page', () => {
      assert.equal(res.status, 404);
    });
  })();

  await (async () => {
    const res = await request(port, { method: 'POST', url: '/auth', origin: `http://127.0.0.1:${port}`, body: {} });
    check('shell: /auth with no nonce is refused', () => {
      assert.equal(res.status, 403);
    });
  })();

  await server.close();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

  clearTimeout(watchdog);
  console.log('');
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (failures > 0) console.log(`${failures} FAILED`);
  process.exit(failures > 0 ? 1 : 0);
})();
