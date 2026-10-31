#!/usr/bin/env node
/**
 * Batch 9.0b acceptance harness — the rungs inside `prompt()`.
 *
 * Acceptance: "when the fast path is challenged, the same request is replayed in
 * the tab we already own and the user sees one answer — no error, no second
 * prompt."
 *
 * This exercises the cascade through `BridgeRuntime.control()` against a real
 * loopback server. What it cannot exercise is the replay rung, which needs a page;
 * with no tab attached the cascade is `fast → dom`, and `dom` is what fails.
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

/* ------------------------------------------------------------------ fetch */

const { resolveFetch } = require('./helpers/fetch-shim.cjs');
const fetchImpl = resolveFetch();

/* ----------------------------------------------------------------- server */

const hits = { stream: 0, challenge: 0, json: 0 };

function startServer() {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;

    if (path === '/stream') {
      hits.stream += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"delta":{"text":"Hello "}}\n\n');
      res.write('data: {"delta":{"text":"world"}}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }

    if (path === '/challenge') {
      hits.challenge += 1;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<title>Just a moment...</title>');
      return;
    }

    if (path === '/json') {
      hits.json += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"content":"plain answer"}');
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

  const template = (providerId, path, extra = {}) => ({
    providerId,
    url: `${base}${path}`,
    bodyTemplate: '{"prompt":"{{prompt}}"}',
    enabled: true,
    ...extra,
  });

  const ask = (adapterId) =>
    runtime.control({ op: 'ctl.prompt', adapterId, text: 'say hello', debounceMs: 50, timeoutMs: 5000 });

  const rungsFor = async (providerId) => {
    const status = await runtime.control({ op: 'ctl.fastpath.status' });
    return status.rungs.find((entry) => entry.providerId === providerId);
  };

  /* --------------------------------------------------------------- the rungs */

  await check('rung: an enabled template answers without a browser', async () => {
    await runtime.control({ op: 'ctl.fastpath.set', templates: [template('chatgpt', '/stream')] });
    events.length = 0;
    const answer = await ask('chatgpt');
    assert.equal(answer.text, 'Hello world');
    assert.equal(answer.adapterId, 'chatgpt');
    assert.equal(answer.tabId, null, 'no tab was needed');
  });

  await check('rung: the answer streams as events, tagged with its rung', async () => {
    const kinds = events.map((event) => event.kind);
    assert.equal(kinds[0], 'stream.start');
    assert.equal(kinds[kinds.length - 1], 'stream.end');
    const deltas = events.filter((event) => event.kind === 'stream.delta');
    assert.ok(deltas.length >= 2, 'it arrived in pieces');
    assert.equal(deltas[0].data.rung, 'fast');
    assert.equal(deltas.map((event) => event.data.text).join(''), 'Hello world');
  });

  await check('rung: the rung that answered is remembered', async () => {
    const entry = await rungsFor('chatgpt');
    assert.equal(entry.rung, 'fast');
    assert.equal(entry.answered.fast, 1);
  });

  await check('rung: a second prompt reuses the remembered rung', async () => {
    const before = hits.stream;
    await ask('chatgpt');
    assert.equal(hits.stream, before + 1, 'one request, no re-learning');
  });

  await check('rung: a non-streaming JSON body is the answer', async () => {
    await runtime.control({ op: 'ctl.fastpath.set', templates: [template('jsonchat', '/json')] });
    const answer = await ask('jsonchat');
    assert.match(answer.text, /plain answer/);
  });

  /* ------------------------------------------------------------ the cascade */

  await check('cascade: a challenge falls through instead of failing the prompt', async () => {
    await runtime.control({ op: 'ctl.fastpath.set', templates: [template('claude', '/challenge')] });
    const before = hits.challenge;
    events.length = 0;
    // With no tab attached the cascade is fast → dom, and dom is what fails.
    await assert.rejects(() => ask('claude'));
    const entry = await rungsFor('claude');
    assert.equal(entry.fellThrough.fast, 1, 'the fast rung was tried once and stepped aside');
    assert.equal(entry.rung, null, 'nothing has answered yet');
    assert.equal(
      hits.challenge,
      before + 1,
      'the router retried the prompt, but not the challenged rung',
    );
  });

  await check('cascade: the challenge is not reported as a provider failure', async () => {
    const ends = events
      .filter((event) => event.kind === 'stream.end')
      .map((event) => event.data)
      .filter((data) => data.rung === 'fast' && data.failed);
    assert.equal(ends.length, 1, 'the fast rung ended once, as a fall-through');
    assert.equal(ends[0].failed, 'ChallengeError', 'recorded as a challenge, not a crash');
  });

  await check('cascade: a disabled template is never tried', async () => {
    const before = hits.challenge;
    await runtime.control({
      op: 'ctl.fastpath.set',
      templates: [template('gemini', '/challenge', { enabled: false })],
    });
    await assert.rejects(() => ask('gemini'));
    assert.equal(hits.challenge, before, 'the server was never called');
  });

  await check('cascade: no template at all leaves the DOM path untouched', async () => {
    await runtime.control({ op: 'ctl.fastpath.set', templates: [] });
    const before = hits.stream + hits.challenge + hits.json;
    await assert.rejects(() => ask('chatgpt'));
    assert.equal(hits.stream + hits.challenge + hits.json, before, 'nothing was requested');
  });

  await check('cascade: a rejected template is reported, not silently dropped', async () => {
    const result = await runtime.control({
      op: 'ctl.fastpath.set',
      templates: [{ providerId: 'broken', url: `${base}/stream`, bodyTemplate: '{}' }],
    });
    assert.deepEqual(result.accepted, []);
    assert.match(result.rejected[0].error, /\{\{prompt\}\}/);
  });

  /* -------------------------------------------------------------- extraction */

  await check('extract: the common stream shapes are read', () => {
    const { extractTextFromEvent } = require('../bridge/dist/fastpath/attempt.js');
    assert.equal(extractTextFromEvent('{"delta":{"text":"a"}}'), 'a');
    assert.equal(extractTextFromEvent('{"choices":[{"delta":{"content":"b"}}]}'), 'b');
    assert.equal(extractTextFromEvent('{"content":"c"}'), 'c');
    assert.equal(extractTextFromEvent('{"message":{"content":"d"}}'), 'd');
    assert.equal(extractTextFromEvent('[DONE]'), '');
    assert.equal(extractTextFromEvent('plain text'), 'plain text', 'passed through');
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
