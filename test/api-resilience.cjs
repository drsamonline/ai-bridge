#!/usr/bin/env node
/**
 * Batch 8.4 acceptance harness — free-tier resilience.
 *
 * Acceptance: "a dead credential cannot cool the whole chain; a cancel is not a
 * failure; a stalled stream fails in seconds, not never."
 *
 * Everything runs through `BridgeRuntime.control()`, against a real loopback
 * server, because the thing under test is what the router learns from a failure
 * — not what a helper returns in isolation.
 */

'use strict';

const assert = require('node:assert');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const results = [];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`FAIL  ${name}\n      ${err.message}`);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ fetch *
 * Same shim as the other 8.x harnesses: this sandbox's undici cannot allocate
 * the WASM memory its HTTP parser needs, and the client takes an injectable
 * fetch for exactly that reason.
 */

const { resolveFetch } = require('./helpers/fetch-shim.cjs');
const fetchImpl = resolveFetch();

/* ----------------------------------------------------------------- server */

const state = { slowClosed: false, slowFrames: 0 };

function frame(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

function startServer() {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;

    if (path === '/ok/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(frame('fine') + 'data: [DONE]\n\n');
      return;
    }

    if (path === '/limited/v1/chat/completions') {
      res.writeHead(429, { 'retry-after': '2' });
      res.end('slow down');
      return;
    }

    if (path === '/limitednh/v1/chat/completions') {
      res.writeHead(429);
      res.end('slow down');
      return;
    }

    if (path === '/bad/v1/chat/completions') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"sign in"}');
      return;
    }

    if (path === '/slow/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.on('error', () => {}); // a client that walks away is not an error
      res.on('close', () => {
        state.slowClosed = true;
      });
      let sent = 0;
      const timer = setInterval(() => {
        if (res.destroyed) {
          clearInterval(timer);
          return;
        }
        sent += 1;
        state.slowFrames = sent;
        res.write(frame(`tick ${sent} `));
        if (sent >= 30) {
          clearInterval(timer);
          res.end('data: [DONE]\n\n');
        }
      }, 100);
      return;
    }

    res.writeHead(404);
    res.end('no route');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ base: `http://127.0.0.1:${server.address().port}`, server });
    });
  });
}

async function main() {
  const { base, server } = await startServer();
  const { BridgeRuntime } = require('../bridge/dist/runtime.js');
  const { createLogger } = require('../bridge/dist/logger.js');
  const quiet = createLogger({ level: 'error', sink: () => {} });

  const runtime = new BridgeRuntime({
    log: quiet,
    ...(fetchImpl ? { apiFetchImpl: fetchImpl } : {}),
  });
  const events = [];
  runtime.bus.on('event', (event) => events.push(event));

  const endpoint = (id, path, extra = {}) => ({
    id,
    name: id,
    baseUrl: `${base}${path}/v1`,
    noApiKey: true,
    ...extra,
  });

  await runtime.control({
    op: 'ctl.api.providers.set',
    providers: [
      endpoint('ok', '/ok'),
      endpoint('limited', '/limited'),
      endpoint('limitednh', '/limitednh'),
      endpoint('bad', '/bad', { noApiKey: false }),
      endpoint('slow', '/slow'),
    ],
    keys: { bad: 'sk-dead' },
  });

  const routerOf = async (id) => {
    const status = await runtime.control({ op: 'ctl.api.status' });
    return status.router.find((entry) => entry.id === `api:${id}`);
  };

  const ask = (id, extra = {}) =>
    runtime.control({
      op: 'ctl.api.prompt',
      model: `custom:${id}/m`,
      messages: [{ role: 'user', content: 'hi' }],
      ...extra,
    });

  /* ---------------------------------------------------------------- router */

  await check('router: every endpoint gets a router entry', async () => {
    const status = await runtime.control({ op: 'ctl.api.status' });
    assert.equal(status.router.length, 5);
    assert.ok(status.router.every((entry) => entry.state === 'ready'));
    assert.ok(
      status.router.every((entry) => entry.priority >= 101),
      'endpoints never outrank a web chat',
    );
  });

  await check('router: a success marks the endpoint ready', async () => {
    const answer = await ask('ok');
    assert.equal(answer.textChars, 'fine'.length);
    const entry = await routerOf('ok');
    assert.equal(entry.state, 'ready');
    assert.equal(entry.failures, 0);
  });

  await check('router: a 429 with retry-after cools for exactly that long', async () => {
    await assert.rejects(() => ask('limited'), /ERATELIMIT|rate limited/);
    const entry = await routerOf('limited');
    assert.equal(entry.state, 'cooling');
    const remaining = entry.cooldownUntil - Date.now();
    assert.ok(remaining > 900 && remaining <= 2100, `cooling ${remaining} ms, not ~2000`);
  });

  await check('router: a cooling endpoint fails fast, without a request', async () => {
    const before = (await runtime.control({ op: 'ctl.api.status' })).recent.length;
    await assert.rejects(() => ask('limited'), /ERATELIMIT: limited is cooling/);
    const after = (await runtime.control({ op: 'ctl.api.status' })).recent.length;
    assert.equal(after, before, 'no request was recorded, so none was made');
  });

  await check('router: a 429 without retry-after uses the configured cooldown', async () => {
    await assert.rejects(() => ask('limitednh'), /rate limited/);
    const entry = await routerOf('limitednh');
    const remaining = entry.cooldownUntil - Date.now();
    assert.ok(remaining > 200_000, `cooling ${remaining} ms, i.e. the 300 s default`);
  });

  await check('router: the limit is announced as an event', async () => {
    const limited = events.filter((event) => event.kind === 'api.limited');
    assert.ok(limited.length >= 1);
    assert.equal(limited[0].data.providerId, 'limited');
    assert.equal(limited[0].data.retryAfterMs, 2000);
  });

  /* ------------------------------------------------------------------ auth */

  await check('auth: a refused credential is forgotten', async () => {
    await assert.rejects(() => ask('bad'), /sign-in expired/);
    const status = await runtime.control({ op: 'ctl.api.status' });
    const bad = status.providers.find((provider) => provider.id === 'bad');
    assert.equal(bad.signedIn, false, 'the dead key was deleted, not kept');
  });

  await check('auth: the next request reports signed out, not a 401 loop', async () => {
    await assert.rejects(
      () => ask('bad'),
      (err) => {
        assert.equal(err.code, 'EAUTH');
        assert.equal(err.status, 0, 'no request was made, so there is no status');
        return true;
      },
    );
  });

  await check('auth: the refusal is announced as an event', async () => {
    const refused = events.filter((event) => event.kind === 'api.auth');
    assert.ok(refused.length >= 1);
    assert.equal(refused[0].data.providerId, 'bad');
    assert.equal(refused[0].data.forgotten, true);
  });

  await check('auth: an auth failure does not cool the endpoint', async () => {
    const entry = await routerOf('bad');
    assert.equal(entry.state, 'ready', 'a dead key is not a rate limit');
  });

  /* ---------------------------------------------------------------- cancel */

  await check('cancel: an aborted request stops the upstream', async () => {
    const pending = ask('slow', { requestId: 'r1' });
    await sleep(220);
    const cancelled = await runtime.control({ op: 'ctl.api.cancel', requestId: 'r1' });
    assert.equal(cancelled.cancelled, true);

    let answer;
    try {
      answer = await pending;
    } catch (err) {
      answer = { cancelled: /abort/i.test(err.message) };
    }
    assert.equal(answer.cancelled, true, 'the caller is told it was cancelled');
    await sleep(150);
    assert.equal(state.slowClosed, true, 'the connection was closed under the server');
    assert.ok(state.slowFrames < 30, `the server stopped after ${state.slowFrames} frames`);
  });

  await check('cancel: a cancel is not counted as a failure', async () => {
    const entry = await routerOf('slow');
    assert.equal(entry.failures, 0, 'the provider did nothing wrong');
    assert.equal(entry.state, 'ready');
  });

  await check('cancel: an unknown request id is a no-op', async () => {
    const result = await runtime.control({ op: 'ctl.api.cancel', requestId: 'nope' });
    assert.equal(result.cancelled, false);
  });

  /* -------------------------------------------------------------- telemetry */

  await check('report: every request is recorded with its outcome', async () => {
    const status = await runtime.control({ op: 'ctl.api.status' });
    assert.ok(status.recent.length >= 4, `only ${status.recent.length} records`);
    const limited = status.recent.find((entry) => entry.code === 'ERATELIMIT');
    assert.ok(limited, 'the rate limit is on record');
    assert.equal(limited.retryAfterMs, 2000);
    assert.equal(limited.status, 429);
    assert.ok(limited.ms >= 0);
    assert.ok(
      status.recent.some((entry) => entry.code === 'ECANCELLED'),
      'the cancel is on record, without being a failure',
    );
    assert.ok(
      status.recent.some((entry) => entry.ok === true),
      'the success is on record',
    );
  });

  await check('report: the record is bounded', async () => {
    for (let i = 0; i < 25; i += 1) {
      try {
        await ask('ok');
      } catch {
        /* a bounded ring is the point */
      }
    }
    const status = await runtime.control({ op: 'ctl.api.status' });
    assert.ok(status.recent.length <= 20, `ring grew to ${status.recent.length}`);
  });

  /* ------------------------------------------------------ the report (8.4b) */

  const breakage = require('../extension/dist/diagnostics/breakage.js');

  const reportInput = (extra = {}) => ({
    adapterId: 'chatgpt',
    url: 'https://chat.example.test/c/abc123',
    role: 'composer',
    tried: ['#prompt-textarea'],
    matched: null,
    via: 'none',
    error: 'ENOSELECTOR: composer did not resolve',
    extensionVersion: '1.2.3',
    platform: 'linux-x64',
    nodeVersion: 'v20.0.0',
    ...extra,
  });

  const apiRecent = async () => (await runtime.control({ op: 'ctl.api.status' })).recent;

  await check('report: a record keeps its code, status and retry-after', () => {
    const report = breakage.buildReport(
      reportInput({
        requests: [
          {
            t: 1,
            model: 'custom:ep/m',
            ok: false,
            ms: 12,
            code: 'ERATELIMIT',
            status: 429,
            retryAfterMs: 2000,
          },
          { t: 2, model: 'custom:ep/m', ok: true, ms: 8 },
        ],
      }),
    );
    assert.equal(report.requests.length, 2);
    assert.equal(report.requests[0].code, 'ERATELIMIT');
    assert.equal(report.requests[0].status, 429);
    assert.equal(report.requests[0].retryAfterMs, 2000);
    assert.equal(report.requests[1].ok, true);
    assert.equal(report.requests[1].code, undefined, 'a success carries no code');
  });

  await check('report: the live records flow through, bounded', async () => {
    // The ring is capped at 20, so the check counts what the bridge has rather
    // than assuming a particular record survived the earlier checks.
    const live = await apiRecent();
    const report = breakage.buildReport(reportInput({ requests: live }));
    assert.equal(report.requests.length, Math.min(20, live.length));
    assert.ok(report.requests.length > 0, 'the bridge had records to give');
  });

  await check('report: only allow-listed fields survive', () => {
    const report = breakage.buildReport(
      reportInput({
        requests: [
          { model: 'custom:x/y', ok: true, ms: 5, prompt: 'secret chat text', answer: 'secret' },
        ],
      }),
    );
    assert.equal(report.requests.length, 1);
    assert.equal(report.requests[0].model, 'custom:x/y');
    assert.equal(report.requests[0].prompt, undefined, 'an unknown key is not copied');
    assert.equal(report.requests[0].answer, undefined);
  });

  await check('report: the no-chat guard still passes with records present', async () => {
    const report = breakage.buildReport(reportInput({ requests: await apiRecent() }));
    const guard = breakage.assertNoChatContent(report, ['hi', 'read it']);
    assert.equal(guard.ok, true, `leaked: ${guard.leaked.join(', ')}`);
  });

  await check('report: chat text smuggled into a record is caught by the guard', () => {
    const report = breakage.buildReport(
      reportInput({ requests: [{ model: 'please summarise my private notes', ok: true, ms: 1 }] }),
    );
    const guard = breakage.assertNoChatContent(report, ['summarise my private notes']);
    assert.equal(guard.ok, false, 'the guard covers the new field too');
  });

  await check('report: the summary counts endpoint failures', () => {
    const report = breakage.buildReport(
      reportInput({ requests: [{ ok: false, ms: 1 }, { ok: true, ms: 2 }] }),
    );
    assert.match(breakage.summarise(report), /1\/2 endpoint request\(s\) failed/);
  });

  await check('report: a report with no endpoints says nothing about them', () => {
    const report = breakage.buildReport(reportInput());
    assert.deepEqual(report.requests, []);
    assert.ok(!breakage.summarise(report).includes('endpoint request'));
  });

  /* ------------------------------------------------------------------ total */

  server.close();
  console.log('');
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
