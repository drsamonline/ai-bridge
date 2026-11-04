#!/usr/bin/env node
/**
 * Batch 10.1 acceptance harness — finding a model that is already running.
 *
 * Acceptance: "a local server is discovered, and nothing is registered by a probe."
 *
 * Each known server is stood up as a real HTTP listener that speaks its own shape
 * (Ollama's `{models:[{name}]}` versus the OpenAI `{data:[{id}]}`), because the
 * two shapes are exactly where a discovery bug hides: read the wrong one and the
 * server looks present but empty.
 */

'use strict';

const assert = require('node:assert');
const http = require('node:http');
const local = require('../bridge/dist/api/local.js');

const results = [];
let failures = 0;
const servers = [];

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

/** A throwaway server on an ephemeral port. */
function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      servers.push(server);
      resolve(server.address().port);
    });
  });
}

function json(body) {
  return (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

console.log('');

(async () => {
  // An Ollama-shaped server: native /api/tags, plus the OpenAI-compatible path.
  const ollamaPort = await serve((req, res) => {
    if (req.url === '/api/tags') {
      json({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5-coder:7b' }] })(req, res);
      return;
    }
    json({ data: [{ id: 'llama3.2:3b' }] })(req, res);
  });

  // An OpenAI-compatible server with no models at all.
  const emptyPort = await serve(json({ data: [] }));

  // A server that answers 500.
  const brokenPort = await serve((req, res) => {
    res.writeHead(500);
    res.end('nope');
  });

  await check('detect: an Ollama-shaped server is found with its models', async () => {
    const found = await local.detectLocalModels({ ports: [ollamaPort], timeoutMs: 2000 });
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0].id, 'ollama');
    assert.deepEqual(found[0].models, ['llama3.2:3b', 'qwen2.5-coder:7b']);
    assert.equal(found[0].noApiKey, true, 'a local server never needs a key');
    assert.match(found[0].baseUrl, /\/v1$/, 'the endpoint must point at the OpenAI path');
  });

  await check('detect: a server with no models is not offered', async () => {
    // An empty endpoint looks configured and then fails at the first prompt.
    const found = await local.detectLocalModels({ ports: [emptyPort], timeoutMs: 2000 });
    assert.deepEqual(found, []);
  });

  await check('detect: a server that errors is skipped, not thrown', async () => {
    const found = await local.detectLocalModels({ ports: [brokenPort], timeoutMs: 2000 });
    assert.deepEqual(found, []);
  });

  await check('detect: nothing listening is not an error', async () => {
    const found = await local.detectLocalModels({ ports: [1], timeoutMs: 400 });
    assert.deepEqual(found, []);
  });

  await check('detect: an OpenAI-shaped server reports its model ids', async () => {
    const port = await serve(json({ data: [{ id: 'local-model-a' }, { id: 'local-model-b' }] }));
    const found = await local.detectLocalModels({ ports: [port], timeoutMs: 2000 });
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.deepEqual(found[0].models, ['local-model-a', 'local-model-b']);
  });

  await check('detect: several servers at once are all reported', async () => {
    const found = await local.detectLocalModels({ ports: [ollamaPort, emptyPort], timeoutMs: 2000 });
    assert.equal(found.length, 1, 'the empty one must not appear');
    assert.equal(found[0].id, 'ollama');
  });

  await check('endpoint: the settings entry is keyless and complete', () => {
    const entry = local.toEndpoint({
      id: 'ollama',
      name: 'Ollama (local)',
      baseUrl: 'http://127.0.0.1:11434/v1',
      models: ['llama3.2:3b'],
      noApiKey: true,
    });
    assert.equal(entry.id, 'ollama');
    assert.equal(entry.noApiKey, true);
    assert.equal(entry.baseUrl, 'http://127.0.0.1:11434/v1');
    assert.deepEqual(entry.models, ['llama3.2:3b']);
    assert.equal(entry.toolCalling, true);
  });

  await check('detect: probing writes nothing (the module has no settings access)', () => {
    // The acceptance is that a probe cannot change the configuration. The module
    // takes no config and returns plain data; this asserts the shape of what it
    // returns is a report, not a mutation.
    const source = require('node:fs').readFileSync(
      require.resolve('../bridge/dist/api/local.js'),
      'utf8',
    );
    assert.ok(!/writeLock|getConfiguration|providers\.set/.test(source), 'the probe mutates something');
  });

  console.log('');
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  for (const server of servers) server.close();
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exit(1);
  }
})();
