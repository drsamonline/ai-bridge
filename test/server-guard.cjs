#!/usr/bin/env node
/**
 * Served-shell guard acceptance harness — SPEC v6 §13.
 *
 * The threat model, stated once so the checks make sense: the bridge listens on
 * loopback, and a browser will happily send a request to loopback from any page
 * the user has open. DNS rebinding makes it worse — the attacker's hostname
 * resolves to 127.0.0.1, so the request really does arrive. The `Host` header is
 * what gives that away, which is why it is checked before anything else.
 */

'use strict';

const assert = require('node:assert');
const guard = require('../bridge/dist/server/guard.js');

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

const { hostAllowed, hostnameOf, originAllowed, route, NonceStore, corsHeaders, shellOrigins } = guard;

const PORT = 47615;
const req = (over = {}) => ({
  method: 'GET',
  url: '/',
  headers: { host: `127.0.0.1:${PORT}` },
  ...over,
  ...(over.headers ? { headers: { host: `127.0.0.1:${PORT}`, ...over.headers } } : {}),
});

console.log('');

/* ------------------------------------------------------------------- host */

check('guard: loopback hosts are accepted in every form', () => {
  assert.equal(hostAllowed('127.0.0.1:47615'), true);
  assert.equal(hostAllowed('localhost:47615'), true);
  assert.equal(hostAllowed('[::1]:47615'), true, 'IPv6 loopback is still loopback');
  assert.equal(hostnameOf('[::1]:47615'), '::1');
  assert.equal(hostnameOf('127.0.0.1'), '127.0.0.1', 'a host with no port is still a host');
});

check('guard: a rebinding hostname is refused', () => {
  // This is the whole point: the name resolves to 127.0.0.1, so the connection
  // succeeds and only the Host header distinguishes it.
  assert.equal(hostAllowed('evil.test:47615'), false);
  assert.equal(hostAllowed('127.0.0.1.evil.test:47615'), false);
  assert.equal(hostAllowed('localhost.evil.test'), false);
});

check('guard: a missing Host is refused, not allowed', () => {
  assert.equal(hostAllowed(undefined), false);
  assert.equal(hostAllowed(''), false);
});

/* ----------------------------------------------------------------- origin */

check('guard: a top-level GET needs no Origin; a state change does', () => {
  assert.equal(originAllowed(req(), PORT).ok, true);
  assert.equal(originAllowed(req({ method: 'GET' }), PORT).ok, true);
  const post = originAllowed(req({ method: 'POST' }), PORT);
  assert.equal(post.ok, false, 'a cross-site POST carries no usable Origin and must be refused');
  assert.equal(post.status, 403);
});

check('guard: only the shell origin is accepted', () => {
  const shell = shellOrigins(PORT);
  assert.deepEqual(shell, ['http://127.0.0.1:47615', 'http://localhost:47615']);
  for (const origin of shell) {
    assert.equal(originAllowed(req({ method: 'POST', headers: { origin } }), PORT).ok, true);
  }
  assert.equal(originAllowed(req({ method: 'POST', headers: { origin: 'https://evil.test' } }), PORT).ok, false);
  assert.equal(originAllowed(req({ method: 'POST', headers: { origin: `http://127.0.0.1:9999` } }), PORT).ok, false,
    'a different port is a different origin');
});

/* ------------------------------------------------------------------ route */

check('guard: the host is checked before the path, so a probe learns nothing', () => {
  const decision = route(req({ url: '/auth', method: 'POST', headers: { host: 'evil.test' } }), PORT);
  assert.equal(decision.action, 'deny');
  assert.equal(decision.status, 421);
  assert.match(decision.reason, /host/);
});

check('guard: the three real routes resolve and nothing else does', () => {
  assert.equal(route(req(), PORT).action, 'serve-shell');
  assert.equal(route(req({ url: '/index.html' }), PORT).action, 'serve-shell');
  assert.equal(route(req({ url: '/auth', method: 'POST', headers: { origin: shellOrigins(PORT)[0] } }), PORT).action, 'auth');

  const notFound = route(req({ url: '/nope' }), PORT);
  assert.equal(notFound.action, 'deny');
  assert.equal(notFound.status, 404);
  assert.equal(route(req({ url: '/', method: 'POST', headers: { origin: shellOrigins(PORT)[0] } }), PORT).action, 'deny');
});

check('guard: a query string does not change the route', () => {
  assert.equal(route(req({ url: '/?nonce=abc' }), PORT).action, 'serve-shell');
});

/* ------------------------------------------------------------------ nonce */

check('guard: a nonce is verified once and consumed once', () => {
  const store = new NonceStore();
  const nonce = store.issue();
  assert.ok(nonce.length >= 40, 'a guessable nonce is not a nonce');
  assert.equal(store.verify(nonce), true);
  assert.equal(store.verify(nonce), true, 'verifying does not spend it — a reload is not an attack');
  assert.equal(store.consume(nonce), true);
  assert.equal(store.consume(nonce), false, 'the second exchange must fail');
  assert.equal(store.verify(nonce), false);
});

check('guard: a wrong or empty nonce never opens the page', () => {
  const store = new NonceStore();
  store.issue();
  assert.equal(store.verify(''), false);
  assert.equal(store.verify(undefined), false);
  assert.equal(store.verify('x'.repeat(43)), false);
  assert.equal(store.consume('nope'), false);
});

check('guard: a nonce expires', () => {
  let clock = 0;
  const store = new NonceStore(1000, () => clock);
  const nonce = store.issue();
  clock = 999;
  assert.equal(store.verify(nonce), true);
  clock = 1001;
  assert.equal(store.verify(nonce), false, 'an expired nonce is not a nonce');
  assert.equal(store.consume(nonce), false);
});

check('guard: two launches do not share a nonce', () => {
  const a = new NonceStore();
  const b = new NonceStore();
  const first = a.issue();
  const second = b.issue();
  assert.notEqual(first, second);
  assert.equal(a.verify(second), false);
});

/* ------------------------------------------------------------------- cors */

check('guard: CORS is off everywhere except /auth, and never wildcard', () => {
  const shell = shellOrigins(PORT)[0];
  assert.deepEqual(corsHeaders(req({ headers: { origin: shell } }), PORT, false), {},
    'the page route needs no CORS');
  const auth = corsHeaders(req({ headers: { origin: shell } }), PORT, true);
  assert.equal(auth['access-control-allow-origin'], shell);
  assert.equal(auth['vary'], 'origin');
  assert.ok(!JSON.stringify(auth).includes('*'), 'a wildcard here would hand any page the response');
  assert.deepEqual(corsHeaders(req({ headers: { origin: 'https://evil.test' } }), PORT, true), {});
});

console.log('');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
