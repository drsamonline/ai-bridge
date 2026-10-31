#!/usr/bin/env node
/**
 * Batch 9.0 acceptance harness — the fast path.
 *
 * Acceptance: "when the fast path is challenged, the same request is replayed in
 * the tab we already own and the user sees one answer — no error, no second
 * prompt."
 *
 * The replay is exercised for real: `window` and `fetch` are installed as
 * globals, so the page-side functions run exactly as they would inside a tab,
 * against a fake transport that streams. A mock of `evaluate` would prove nothing
 * about the two-evaluate handshake, which is the part that can go wrong.
 */

'use strict';

const assert = require('node:assert');
const fastpath = require('../bridge/dist/fastpath/index.js');

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

/* ------------------------------------------------------------------ detect */

async function main() {
  await check('detect: an SSE answer is a stream', () => {
    const verdict = fastpath.classifyResponse({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    });
    assert.equal(verdict.verdict, 'stream');
  });

  await check('detect: an HTML body on a stream endpoint is a challenge', () => {
    const verdict = fastpath.classifyResponse({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>verify</body></html>',
    });
    assert.equal(verdict.verdict, 'challenge');
    assert.match(verdict.reason, /HTML body/);
  });

  await check('detect: an Aliyun WAF challenge is recognised by marker', () => {
    const verdict = fastpath.classifyResponse({
      status: 200,
      contentType: 'application/json',
      body: '{"error":{"code":"FAIL_SYS_USER_VALIDATE","x5sec":"..."}}',
    });
    assert.equal(verdict.verdict, 'challenge');
    assert.equal(verdict.marker, 'x5sec');
    assert.match(verdict.reason, /aliyun/);
  });

  await check('detect: an RGV587 body is recognised', () => {
    const verdict = fastpath.classifyResponse({
      status: 200,
      contentType: 'application/json',
      body: '{"RGV587_ERROR":{}}',
    });
    assert.equal(verdict.verdict, 'challenge');
  });

  await check('detect: a Cloudflare interstitial is recognised', () => {
    const verdict = fastpath.classifyResponse({
      status: 403,
      contentType: 'text/html',
      body: '<title>Just a moment...</title>',
    });
    assert.equal(verdict.verdict, 'challenge');
    assert.match(verdict.reason, /cloudflare/);
  });

  await check('detect: a 401 is auth, not a challenge', () => {
    const verdict = fastpath.classifyResponse({ status: 401, body: '{}' });
    assert.equal(verdict.verdict, 'auth');
  });

  await check('detect: a bare 403 is an error, never "signed out"', () => {
    // Every WAF answers 403 for a challenge it has already decided against.
    // Calling that auth would send the user to a login page that changes nothing.
    const verdict = fastpath.classifyResponse({ status: 403, body: 'denied' });
    assert.equal(verdict.verdict, 'error');
    assert.match(verdict.reason, /403/);
  });

  await check('detect: a 429 is a rate limit, not a challenge', () => {
    const verdict = fastpath.classifyResponse({ status: 429, body: 'slow down' });
    assert.equal(verdict.verdict, 'error');
    assert.match(verdict.reason, /429/);
  });

  await check('detect: an unexpected content-type is an error', () => {
    const verdict = fastpath.classifyResponse({
      status: 200,
      contentType: 'application/octet-stream',
      body: '??',
    });
    assert.equal(verdict.verdict, 'error');
    assert.match(verdict.reason, /content-type/);
  });

  await check('detect: a challenge and an auth failure fall through, a stream does not', () => {
    assert.equal(fastpath.shouldFallThrough({ verdict: 'challenge', reason: '' }), true);
    assert.equal(fastpath.shouldFallThrough({ verdict: 'auth', reason: '' }), true);
    assert.equal(fastpath.shouldFallThrough({ verdict: 'stream', reason: '' }), false);
    assert.equal(fastpath.shouldFallThrough({ verdict: 'error', reason: '' }), false);
  });

  /* --------------------------------------------------------------- templates */

  await check('template: a valid one is accepted and off by default', () => {
    const verdict = fastpath.validateTemplate({
      providerId: 'chatgpt',
      url: 'https://example.test/backend-api/conversation',
      bodyTemplate: '{"prompt":"{{prompt}}"}',
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.config.enabled, false, 'a template is opt-in');
    assert.equal(verdict.config.method, 'POST');
  });

  await check('template: one without {{prompt}} is rejected', () => {
    const verdict = fastpath.validateTemplate({
      providerId: 'chatgpt',
      url: 'https://example.test/x',
      bodyTemplate: '{"prompt":"nothing"}',
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.error, /must contain \{\{prompt\}\}/);
  });

  await check('template: a non-http url is rejected', () => {
    const verdict = fastpath.validateTemplate({
      providerId: 'x',
      url: 'file:///etc/passwd',
      bodyTemplate: '{{prompt}}',
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.error, /http/);
  });

  await check('template: a bad provider id is rejected', () => {
    const verdict = fastpath.validateTemplate({
      providerId: 'my chat',
      url: 'https://example.test/x',
      bodyTemplate: '{{prompt}}',
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.error, /providerId/);
  });

  await check('template: placeholders are escaped for the JSON body', () => {
    const body = fastpath.renderTemplate('{"prompt":"{{prompt}}","model":"{{model}}"}', {
      prompt: 'say "hi"\nthen stop\\',
      model: 'gpt-4o',
    });
    const parsed = JSON.parse(body);
    assert.equal(parsed.prompt, 'say "hi"\nthen stop\\');
    assert.equal(parsed.model, 'gpt-4o');
  });

  await check('template: an unknown placeholder is left alone', () => {
    const body = fastpath.renderTemplate('{"a":"{{prompt}}","b":"{{nope}}"}', { prompt: 'x' });
    assert.match(body, /\{\{nope\}\}/);
  });

  /* ------------------------------------------------------------------ rungs */

  await check('rungs: the cheapest available rung is chosen', () => {
    const policy = new fastpath.RungPolicy();
    assert.equal(policy.choose('chatgpt', ['dom', 'replay', 'fast']), 'fast');
    assert.equal(policy.choose('claude', ['dom', 'replay']), 'replay');
    assert.equal(policy.choose('gemini', ['dom']), 'dom');
    assert.equal(policy.choose('none', []), undefined);
  });

  await check('rungs: the rung that last worked is preferred next time', () => {
    const policy = new fastpath.RungPolicy();
    policy.record('chatgpt', 'replay');
    // `fast` is available again, but the last answer came from `replay`.
    assert.equal(policy.choose('chatgpt', ['fast', 'replay', 'dom']), 'replay');
  });

  await check('rungs: a remembered rung that is no longer available is skipped', () => {
    const policy = new fastpath.RungPolicy();
    policy.record('chatgpt', 'fast');
    assert.equal(policy.choose('chatgpt', ['dom']), 'dom');
  });

  await check('rungs: a fall-through is counted, an answer is counted', () => {
    const policy = new fastpath.RungPolicy();
    policy.recordFallThrough('chatgpt', 'fast');
    policy.record('chatgpt', 'replay');
    const status = policy.status().find((entry) => entry.providerId === 'chatgpt');
    assert.equal(status.fellThrough.fast, 1);
    assert.equal(status.answered.replay, 1);
    assert.equal(status.rung, 'replay');
  });

  /* ----------------------------------------------------------------- replay */

  // The page-side functions run against these globals, exactly as they would
  // inside a tab.
  globalThis.window = globalThis;

  let seenInit = null;
  const encoder = new TextEncoder();

  const streamOf = (chunks, { fail = false, stall = false, status = 200 } = {}) => ({
    status,
    body: new ReadableStream({
      async start(controller) {
        if (fail) {
          controller.error(new Error('network down'));
          return;
        }
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
          await sleep(5);
        }
        if (!stall) controller.close();
      },
    }),
  });

  const fakePage = (respond) => ({
    async evaluate(fn, arg) {
      // Runs the real page-side function with our globals standing in.
      return fn(arg);
    },
    respond,
  });

  await check('replay: the answer streams out in order', async () => {
    globalThis.fetch = async (url, init) => {
      seenInit = { url, init };
      return streamOf(['data: one\n\n', 'data: two\n\n', 'data: [DONE]\n\n']);
    };
    const page = fakePage();
    const parts = [];
    for await (const chunk of fastpath.replayInPage(
      page,
      { url: 'https://example.test/x', body: '{"prompt":"hi"}' },
      { pollMs: 5 },
    )) {
      parts.push(chunk);
    }
    assert.equal(parts.join(''), 'data: one\n\ndata: two\n\ndata: [DONE]\n\n');
    assert.ok(parts.length >= 2, 'it arrived in pieces, not one buffer');
  });

  await check('replay: the request is sent with the session cookies', async () => {
    assert.equal(seenInit.init.credentials, 'include');
    assert.equal(seenInit.url, 'https://example.test/x');
    assert.equal(seenInit.init.method, 'POST');
    assert.equal(seenInit.init.body, '{"prompt":"hi"}');
  });

  await check('replay: a stalled answer fails on the idle timeout', async () => {
    globalThis.fetch = async () => streamOf(['data: one\n\n'], { stall: true });
    await assert.rejects(
      async () => {
        for await (const _chunk of fastpath.replayInPage(
          fakePage(),
          { url: 'https://example.test/x' },
          { pollMs: 5, idleTimeoutMs: 60 },
        )) {
          /* consume */
        }
      },
      (err) => {
        assert.equal(err.code, 'EIDLE');
        return true;
      },
    );
  });

  await check('replay: a transport failure surfaces as EREPLAY', async () => {
    globalThis.fetch = async () => streamOf([], { fail: true });
    await assert.rejects(
      async () => {
        for await (const _chunk of fastpath.replayInPage(
          fakePage(),
          { url: 'https://example.test/x' },
          { pollMs: 5 },
        )) {
          /* consume */
        }
      },
      (err) => {
        assert.equal(err.code, 'EREPLAY');
        assert.match(err.message, /network down/);
        return true;
      },
    );
  });

  await check('replay: a cancellation stops the read', async () => {
    globalThis.fetch = async () => streamOf(['a', 'b', 'c', 'd', 'e'], { stall: true });
    const controller = new AbortController();
    let seen = 0;
    for await (const _chunk of fastpath.replayInPage(
      fakePage(),
      { url: 'https://example.test/x' },
      { pollMs: 5, signal: controller.signal },
    )) {
      seen += 1;
      if (seen === 1) controller.abort();
    }
    assert.ok(seen <= 2, `stopped after ${seen} chunks`);
  });

  /* ------------------------------------------------------------------ total */

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
