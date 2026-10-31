#!/usr/bin/env node
/**
 * One fetch for the 8.x harnesses.
 *
 * Four suites needed the same ~60 lines: a `node:http` stand-in for `fetch`,
 * because some sandboxes cannot allocate the WASM memory undici needs, where the
 * global fetch throws from a microtask instead of rejecting. Four copies meant a
 * fix to one would miss the other three (audit 3, F3).
 *
 * The transport takes an injectable fetch precisely so this is possible, so the
 * shim exercises the real socket path — framing, chunk boundaries, idle timeout —
 * rather than stubbing the thing under test.
 */

'use strict';

const http = require('node:http');
const { spawnSync } = require('node:child_process');

/**
 * Whether the global fetch actually works here.
 *
 * Probed in a child process on purpose: when undici cannot allocate its WASM
 * llhttp module it throws from a microtask, which crashes the process instead of
 * rejecting, so the parent cannot try it and catch it.
 *
 * Override with `AI_BRIDGE_TEST_FETCH=global|shim`.
 */
function canUseGlobalFetch() {
  const forced = process.env.AI_BRIDGE_TEST_FETCH;
  if (forced === 'shim') return false;
  if (forced === 'global') return true;
  if (typeof fetch !== 'function') return false;
  const probe = spawnSync(
    process.execPath,
    ['-e', "fetch('http://127.0.0.1:1/').then(()=>{},()=>{})"],
    { timeout: 15000, stdio: 'ignore' },
  );
  return probe.status === 0;
}

/** A `fetch` that speaks the slice of the API the transport reads. */
function nodeFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        method: init.method || 'GET',
        headers: init.headers || {},
      },
      (response) => {
        const chunks = [];
        let settle = () => {};
        const ended = new Promise((done) => {
          settle = done;
        });
        const stream = new ReadableStream({
          start(controller) {
            response.on('data', (chunk) => {
              chunks.push(Buffer.from(chunk));
              controller.enqueue(new Uint8Array(chunk));
            });
            response.on('end', () => {
              settle();
              controller.close();
            });
            response.on('error', (err) => {
              settle();
              controller.error(err);
            });
          },
          cancel() {
            response.destroy();
          },
        });
        const asText = () => ended.then(() => Buffer.concat(chunks).toString('utf8'));
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          statusText: response.statusMessage || '',
          headers: { get: (name) => response.headers[String(name).toLowerCase()] ?? null },
          body: stream,
          text: asText,
          json: () => asText().then((text) => JSON.parse(text)),
        });
      },
    );
    request.on('error', reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}

/** `undefined` when the global fetch works (so the default is used), else the shim. */
function resolveFetch() {
  return canUseGlobalFetch() ? undefined : nodeFetch;
}

module.exports = { canUseGlobalFetch, nodeFetch, resolveFetch };
