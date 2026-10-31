#!/usr/bin/env node
/**
 * Batch 8.0 acceptance harness — the OpenAI-compatible API transport.
 *
 * Acceptance: "a free endpoint streams text, reasoning, tool calls and usage
 * over the loopback socket; a 429 cools for exactly as long as the provider
 * asked; a request that stalls errors instead of hanging."
 *
 * The server below is a real HTTP server, not a stubbed fetch: the socket path,
 * the SSE framing and the idle timeout are the things under test, and a stub
 * would prove none of them. Every stream is written in 3-byte pieces so a
 * record boundary always falls inside a chunk.
 *
 * Provenance: the canned-stream idea is from `test/providers/openai.test.ts` of
 * AppsGanin/ai-free-vscode (MIT). The harness shape is ours.
 */

'use strict';

const assert = require('node:assert');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const api = require('../bridge/dist/api/index.js');

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

/** Writes a string in 3-byte pieces, so every SSE boundary is split. */
async function dribble(res, text, delayMs = 1) {
  for (let i = 0; i < text.length; i += 3) {
    res.write(text.slice(i, i + 3));
    if (delayMs) await sleep(delayMs);
  }
}

const SSE_STREAM = [
  { choices: [{ delta: { reasoning_content: 'weighing it up…' } }] },
  { choices: [{ delta: { content: 'Hello' } }] },
  { choices: [{ delta: { content: ' world' } }] },
  {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              function: { name: 'read_file', arguments: '{"pa' },
            },
          ],
        },
      },
    ],
  },
  {
    choices: [
      { delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"src/a.ts"}' } }] } },
    ],
  },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } },
];

let server;
let base;

function startServer() {
  server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;

    if (path === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'free-model-a' }, { id: 'pro-model-b' }] }));
      return;
    }

    if (path === '/bare/v1/models') {
      // A catalogue that carries a name and no id, to prove the fallback.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'llama-free' }] }));
      return;
    }

    if (path === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const frames = SSE_STREAM.map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join('');
      await dribble(res, frames);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (path === '/bad/v1/chat/completions') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"sign in"}');
      return;
    }

    if (path === '/limited/v1/chat/completions') {
      res.writeHead(429, { 'retry-after': '2' });
      res.end('slow down');
      return;
    }

    if (path === '/dated/v1/chat/completions') {
      const when = new Date(Date.now() + 5000).toUTCString();
      res.writeHead(429, { 'retry-after': when });
      res.end('slow down');
      return;
    }

    if (path === '/stall/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
      return; // never ends: this is what the idle timeout is for
    }

    res.writeHead(404);
    res.end('no route');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

function endpoint(id, path, extra = {}) {
  return { id, name: id, baseUrl: `${base}${path}`, ...extra };
}

/* ------------------------------------------------------------------ fetch *
 * The client takes an injectable fetch so the transport can be driven over a
 * plain socket. That is used here: this sandbox cannot allocate the WASM memory
 * undici needs, so the global fetch is unusable and would crash the process
 * rather than reject. The shim below implements only the surface the transport
 * reads — status, headers.get, a body stream, json — so framing, chunk
 * boundaries and the idle timeout are still exercised for real.
 *
 * On a machine where the global fetch works, it is used and nothing changes.
 */

/**
 * Whether the global fetch actually works here.
 *
 * Probed in a child process on purpose: when undici cannot allocate its WASM
 * llhttp module it throws from a microtask, which crashes the process instead of
 * rejecting, so the parent cannot try it and catch it. A child that exits 0 has
 * a usable fetch; anything else means the shim.
 *
 * Override with `AI_BRIDGE_TEST_FETCH=global|shim`.
 */
const { resolveFetch } = require('./helpers/fetch-shim.cjs');
const fetchImpl = resolveFetch();

const newRegistry = (opts = {}) =>
  new api.ApiRegistry({ ...(fetchImpl ? { fetchImpl } : {}), ...opts });

async function main() {
  await startServer();
  console.log(`fetch: ${fetchImpl ? 'node:http shim' : 'global (undici)'}`);

  /* ------------------------------------------------------------ validation */

  await check('validate: a minimal config is accepted', () => {
    const v = api.validateApiProvider({ id: 'groq', baseUrl: 'https://api.groq.com/openai/v1' });
    assert.equal(v.ok, true);
    assert.equal(v.config.name, 'groq', 'name defaults to the id');
    assert.equal(v.config.enabled, true);
  });

  await check('validate: a missing baseUrl is rejected with a reason', () => {
    const v = api.validateApiProvider({ id: 'x' });
    assert.equal(v.ok, false);
    assert.match(v.error, /baseUrl/);
  });

  await check('validate: a non-http url is rejected', () => {
    const v = api.validateApiProvider({ id: 'x', baseUrl: 'file:///etc/passwd' });
    assert.equal(v.ok, false);
    assert.match(v.error, /http/);
  });

  await check('validate: an id with spaces is rejected', () => {
    const v = api.validateApiProvider({ id: 'my endpoint', baseUrl: 'http://127.0.0.1:1/v1' });
    assert.equal(v.ok, false);
    assert.match(v.error, /invalid id/);
  });

  await check('validate: a model may be pinned as a string or an object', () => {
    const v = api.validateApiProvider({
      id: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      noApiKey: true,
      models: ['qwen2.5-coder:7b', { id: 'llama3.3', name: 'Llama 3.3 (free)', maxOutputTokens: 4096 }],
    });
    assert.equal(v.ok, true);
    assert.equal(v.config.models.length, 2);
    assert.equal(v.config.models[1].name, 'Llama 3.3 (free)');
    assert.equal(v.config.models[1].maxOutputTokens, 4096);
  });

  await check('validate: a bare origin gains /v1, an /vN base is left alone', () => {
    assert.equal(api.resolveBaseUrl('http://localhost:1234'), 'http://localhost:1234/v1');
    assert.equal(api.resolveBaseUrl('http://localhost:1234/'), 'http://localhost:1234/v1');
    assert.equal(api.resolveBaseUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1');
    assert.equal(api.resolveBaseUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com/openai/v1');
  });

  /* ----------------------------------------------------------- namespacing */

  await check('namespacing: provider and model round-trip', () => {
    const id = api.toApiModelId('groq', 'llama-3.3-70b');
    assert.equal(id, 'custom:groq/llama-3.3-70b');
    assert.deepEqual(api.fromApiModelId(id), { providerId: 'groq', upstreamId: 'llama-3.3-70b' });
  });

  await check('namespacing: an upstream id containing / round-trips', () => {
    const id = api.toApiModelId('or', 'meta-llama/Llama-3.3-70B-Instruct:free');
    assert.deepEqual(api.fromApiModelId(id), {
      providerId: 'or',
      upstreamId: 'meta-llama/Llama-3.3-70B-Instruct:free',
    });
  });

  await check('namespacing: a foreign id does not resolve', () => {
    assert.equal(api.fromApiModelId('gpt-4o'), undefined);
    assert.equal(api.fromApiModelId('custom:no-slash'), undefined);
    assert.equal(api.fromApiModelId('custom:/missing-provider'), undefined);
  });

  /* -------------------------------------------------------------- registry */

  await check('registry: a duplicate id is rejected, the first is kept', () => {
    const registry = newRegistry();
    const out = registry.setProviders([
      { id: 'a', baseUrl: 'http://127.0.0.1:1/v1' },
      { id: 'a', baseUrl: 'http://127.0.0.1:2/v1' },
    ]);
    assert.deepEqual(out.accepted, ['a']);
    assert.equal(out.rejected.length, 1);
    assert.match(out.rejected[0].error, /duplicate/);
  });

  await check('registry: an invalid endpoint is reported by id', () => {
    const registry = newRegistry();
    const out = registry.setProviders([{ id: 'ok', baseUrl: 'http://127.0.0.1:1/v1' }, { id: 'bad' }]);
    assert.deepEqual(out.accepted, ['ok']);
    assert.equal(out.rejected[0].id, 'bad');
  });

  await check('models: the catalogue is namespaced and marked free/paid', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('free', '/v1')]);
    const models = await registry.refresh();
    assert.equal(models.length, 2);
    assert.deepEqual(
      models.map((m) => m.id),
      ['custom:free/free-model-a', 'custom:free/pro-model-b'],
    );
    assert.equal(models[0].isFree, true, '"free-model-a" is free');
    assert.equal(models[1].isFree, false, '"pro-model-b" is paid');
    assert.equal(models[0].toolCalling, true, 'tool calling defaults on');
    assert.equal(models[0].maxInputTokens, 128000);
  });

  await check('models: a name-only catalogue still lists, and reads as free', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('bare', '/bare')]);
    const models = await registry.refresh();
    assert.deepEqual(models.map((m) => m.upstreamId), ['llama-free']);
    assert.equal(models[0].isFree, true);
  });

  await check('models: image input is off unless the endpoint declares it', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('noimg', '/v1')]);
    const models = await registry.refresh();
    assert.equal(models[0].imageInput, false, 'assumed off, not assumed on');
  });

  await check('models: image input is on when the endpoint declares it', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('img', '/v1', { imageInput: true })]);
    const models = await registry.refresh();
    assert.equal(models[0].imageInput, true);
  });

  await check('models: an explicit model list wins over the fetched one', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([
      endpoint('pinned', '/v1', { models: [{ id: 'only-this-one', name: 'Chosen' }] }),
    ]);
    const models = await registry.refresh();
    assert.deepEqual(models.map((m) => m.upstreamId), ['only-this-one']);
    assert.equal(models[0].label, 'Chosen');
  });

  await check('cache: re-pointing an endpoint drops the old catalogue', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('moving', '/v1')]);
    await registry.refresh();
    assert.equal(registry.modelList().length, 2);
    // Same id, new base, no catalogue yet: the stale models must not survive.
    registry.setProviders([{ id: 'moving', name: 'moving', baseUrl: `${base}/nowhere` }]);
    assert.equal(registry.modelList().length, 0);
  });

  await check('registry: a re-pointed endpoint is fetched again, not served stale', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('again', '/v1')]);
    await registry.refresh();
    registry.setProviders([{ id: 'again', name: 'again', baseUrl: `${base}/bare` }]);
    const models = await registry.refresh();
    assert.deepEqual(models.map((m) => m.upstreamId), ['llama-free']);
  });

  /* ---------------------------------------------------------------- stream */

  const freeEndpoint = () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('free', '/v1')], { free: 'sk-test' });
    return registry;
  };

  await check('stream: text deltas arrive in order', async () => {
    const registry = freeEndpoint();
    const answer = await api.collectStream(
      registry.stream({
        model: 'custom:free/free-model-a',
        messages: [{ role: 'user', content: 'hi' }],
      }),
      { modelId: 'custom:free/free-model-a', providerId: 'free' },
    );
    assert.equal(answer.text, 'Hello world');
  });

  await check('stream: reasoning is separated from the answer', async () => {
    const registry = freeEndpoint();
    const answer = await api.collectStream(
      registry.stream({
        model: 'custom:free/free-model-a',
        messages: [{ role: 'user', content: 'hi' }],
      }),
      { modelId: 'custom:free/free-model-a', providerId: 'free' },
    );
    assert.equal(answer.thinking, 'weighing it up…');
    assert.ok(!answer.text.includes('weighing'), 'reasoning never leaks into text');
  });

  await check('stream: a tool call split across chunks assembles into one call', async () => {
    const registry = freeEndpoint();
    const answer = await api.collectStream(
      registry.stream({
        model: 'custom:free/free-model-a',
        messages: [{ role: 'user', content: 'read src/a.ts' }],
        tools: [{ name: 'read_file', description: 'read a file', parameters: { type: 'object' } }],
      }),
      { modelId: 'custom:free/free-model-a', providerId: 'free' },
    );
    assert.equal(answer.toolCalls.length, 1);
    assert.equal(answer.toolCalls[0].name, 'read_file');
    assert.equal(answer.toolCalls[0].id, 'call_1');
  });

  await check('stream: tool-call arguments parse as JSON', async () => {
    const registry = freeEndpoint();
    const answer = await api.collectStream(
      registry.stream({
        model: 'custom:free/free-model-a',
        messages: [{ role: 'user', content: 'read src/a.ts' }],
      }),
      { modelId: 'custom:free/free-model-a', providerId: 'free' },
    );
    assert.deepEqual(JSON.parse(answer.toolCalls[0].arguments), { path: 'src/a.ts' });
  });

  await check('stream: usage is reported by the provider', async () => {
    const registry = freeEndpoint();
    const answer = await api.collectStream(
      registry.stream({
        model: 'custom:free/free-model-a',
        messages: [{ role: 'user', content: 'hi' }],
      }),
      { modelId: 'custom:free/free-model-a', providerId: 'free' },
    );
    assert.equal(answer.promptTokens, 12);
    assert.equal(answer.completionTokens, 7);
  });

  await check('stream: an SSE stream split into 3-byte writes still parses', async () => {
    // The whole server dribbles in 3-byte pieces; reaching here at all means the
    // record buffer survived boundaries inside JSON, inside a field and inside a
    // separator. This check states the property; the checks above prove it.
    const registry = freeEndpoint();
    const answer = await api.collectStream(
      registry.stream({
        model: 'custom:free/free-model-a',
        messages: [{ role: 'user', content: 'hi' }],
      }),
      { modelId: 'custom:free/free-model-a', providerId: 'free' },
    );
    assert.equal(answer.text, 'Hello world');
    assert.equal(answer.toolCalls.length, 1);
  });

  /* ---------------------------------------------------------------- errors */

  await check('errors: 401 becomes EAUTH', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('bad', '/bad')], { bad: 'sk-dead' });
    await assert.rejects(
      async () =>
        api.collectStream(
          registry.stream({ model: 'custom:bad/x', messages: [{ role: 'user', content: 'hi' }] }),
          { modelId: 'custom:bad/x', providerId: 'bad' },
        ),
      (err) => {
        assert.equal(err.code, 'EAUTH');
        assert.equal(err.status, 401);
        return true;
      },
    );
  });

  await check('errors: 429 becomes ERATELIMIT with the retry-after delay', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('limited', '/limited')], { limited: 'sk-test' });
    await assert.rejects(
      async () =>
        api.collectStream(
          registry.stream({
            model: 'custom:limited/x',
            messages: [{ role: 'user', content: 'hi' }],
          }),
          { modelId: 'custom:limited/x', providerId: 'limited' },
        ),
      (err) => {
        assert.equal(err.code, 'ERATELIMIT');
        assert.equal(err.retryAfterMs, 2000);
        return true;
      },
    );
  });

  await check('errors: retry-after as an HTTP date is honoured', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('dated', '/dated')], { dated: 'sk-test' });
    await assert.rejects(
      async () =>
        api.collectStream(
          registry.stream({ model: 'custom:dated/x', messages: [{ role: 'user', content: 'hi' }] }),
          { modelId: 'custom:dated/x', providerId: 'dated' },
        ),
      (err) => {
        assert.equal(err.code, 'ERATELIMIT');
        // An HTTP date has 1-second resolution, so allow the rounding.
        assert.ok(err.retryAfterMs > 3000 && err.retryAfterMs <= 5000, `got ${err.retryAfterMs}`);
        return true;
      },
    );
  });

  await check('errors: a stalled stream fails on the idle timeout', async () => {
    const registry = newRegistry({ idleTimeoutMs: 250 });
    registry.setProviders([endpoint('stall', '/stall')], { stall: 'sk-test' });
    const startedAt = Date.now();
    await assert.rejects(
      async () =>
        api.collectStream(
          registry.stream({ model: 'custom:stall/x', messages: [{ role: 'user', content: 'hi' }] }),
          { modelId: 'custom:stall/x', providerId: 'stall' },
        ),
      (err) => {
        assert.equal(err.code, 'EIDLE');
        return true;
      },
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 3000, `failed in ${elapsed} ms, not hung`);
  });

  await check('errors: no key on a keyed endpoint is EAUTH before the request', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('keyed', '/v1')]);
    await assert.rejects(
      async () =>
        api.collectStream(
          registry.stream({ model: 'custom:keyed/x', messages: [{ role: 'user', content: 'hi' }] }),
          { modelId: 'custom:keyed/x', providerId: 'keyed' },
        ),
      (err) => {
        assert.equal(err.code, 'EAUTH');
        assert.equal(err.status, 0, 'no request was made, so there is no status');
        return true;
      },
    );
  });

  await check('errors: noApiKey endpoint needs no credential', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('local', '/v1', { noApiKey: true })]);
    assert.equal(registry.statuses()[0].signedIn, true);
    const answer = await api.collectStream(
      registry.stream({ model: 'custom:local/x', messages: [{ role: 'user', content: 'hi' }] }),
      { modelId: 'custom:local/x', providerId: 'local' },
    );
    assert.equal(answer.text, 'Hello world');
  });

  await check('errors: an unknown model is a config error, not a network call', async () => {
    const registry = newRegistry();
    await assert.rejects(
      async () =>
        api.collectStream(
          registry.stream({ model: 'custom:ghost/x', messages: [] }),
          { modelId: 'custom:ghost/x', providerId: 'ghost' },
        ),
      (err) => {
        assert.equal(err.code, 'ECONFIG');
        return true;
      },
    );
  });

  await check('errors: a refused credential can be forgotten', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([endpoint('bad', '/bad')], { bad: 'sk-dead' });
    assert.equal(registry.statuses()[0].signedIn, true);
    assert.equal(registry.forgetRejected('bad'), true);
    assert.equal(registry.statuses()[0].signedIn, false, 'now reports signed out');
  });

  await check('errors: a key is kept for a surviving endpoint, dropped for a removed one', async () => {
    const registry = newRegistry();
    registry.setProviders([{ id: 'a', baseUrl: 'http://127.0.0.1:1/v1' }], { a: 'sk-a' });
    registry.setProviders([
      { id: 'a', baseUrl: 'http://127.0.0.1:1/v1' },
      { id: 'b', baseUrl: 'http://127.0.0.1:2/v1' },
    ]);
    assert.equal(registry.statuses().find((s) => s.id === 'a').signedIn, true);
    assert.equal(registry.statuses().find((s) => s.id === 'b').signedIn, false);
    registry.setProviders([{ id: 'b', baseUrl: 'http://127.0.0.1:2/v1' }]);
    assert.equal(registry.statuses().length, 1);
    assert.equal(registry.forgetRejected('a'), false, 'the key went with the endpoint');
  });

  await check('status: an endpoint that fails keeps its error, not a crash', async () => {
    const registry = newRegistry({ idleTimeoutMs: 2000 });
    registry.setProviders([{ id: 'dead', name: 'Dead', baseUrl: 'http://127.0.0.1:9/v1' }]);
    const models = await registry.refresh();
    assert.equal(models.length, 0);
    const status = registry.statuses()[0];
    assert.equal(status.signedIn, false);
    assert.ok(status.lastError, 'the failure is reported on the status');
  });

  /* --------------------------------------------------------------- summary */

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
  if (server) server.close();
  process.exit(1);
});
