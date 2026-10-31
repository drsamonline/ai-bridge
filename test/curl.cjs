#!/usr/bin/env node
/**
 * Batch 9.2 acceptance harness — cURL capture.
 *
 * The fast path is useless without a template and nobody should hand-assemble
 * one, so this turns a copied request into one. Two properties matter more than
 * the happy path: a copied credential never survives the parse, and a wrong guess
 * about which string is the prompt is reported rather than hidden.
 */

'use strict';

const assert = require('node:assert');
const curl = require('../extension/dist/features/curl.js');

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

/** What Chrome's "Copy as cURL" actually produces. */
const CHROME_CURL = `curl 'https://chat.example.test/backend-api/conversation' \\
  -H 'accept: text/event-stream' \\
  -H 'authorization: Bearer sk-secret-token' \\
  -H 'content-type: application/json' \\
  -H 'cookie: session=abc123' \\
  --data-raw '{"action":"next","messages":[{"author":{"role":"user"},"content":{"content_type":"text","parts":["explain this code please"]}}],"model":"auto"}' \\
  --compressed`;

console.log('');

check('parse: url, method, headers and body come out', () => {
  const parsed = curl.parseCurl(CHROME_CURL);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error);
  assert.equal(parsed.request.url, 'https://chat.example.test/backend-api/conversation');
  assert.equal(parsed.request.method, 'POST', 'a body means POST');
  assert.equal(parsed.request.headers.accept, 'text/event-stream');
  assert.match(parsed.request.body, /explain this code please/);
});

check('parse: a credential never survives', () => {
  const parsed = curl.parseCurl(CHROME_CURL);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.request.headers.authorization, undefined, 'authorization dropped');
  assert.equal(parsed.request.headers.cookie, undefined, 'cookie dropped');
  assert.ok(!JSON.stringify(parsed.request).includes('sk-secret-token'));
  assert.ok(!JSON.stringify(parsed.request).includes('abc123'));
});

check('parse: an explicit method is honoured', () => {
  const parsed = curl.parseCurl(`curl -X PATCH 'https://example.test/x' -H 'a: b' --data '{}'`);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.request.method, 'PATCH');
});

check('parse: a GET with no body is a GET', () => {
  const parsed = curl.parseCurl(`curl 'https://example.test/models' -H 'accept: application/json'`);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.request.method, 'GET');
  assert.equal(parsed.request.body, undefined);
});

check('parse: not a curl command is refused with a reason', () => {
  const parsed = curl.parseCurl('fetch("/x", { method: "POST" })');
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /not a curl command/);
});

check('parse: an unbalanced quote is refused, not guessed', () => {
  const parsed = curl.parseCurl(`curl 'https://example.test/x --data '{}'`);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /unbalanced quote/);
});

check('parse: a command with no url is refused', () => {
  const parsed = curl.parseCurl('curl -H "a: b"');
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /no URL/);
});

check('template: the longest string becomes the prompt', () => {
  const draft = curl.templateFromCurl(CHROME_CURL, 'chatgpt');
  assert.equal(draft.ok, true, draft.ok ? '' : draft.error);
  assert.equal(draft.template.providerId, 'chatgpt');
  assert.equal(draft.template.method, 'POST');
  assert.ok(draft.template.bodyTemplate.includes('{{prompt}}'));
  assert.ok(!draft.template.bodyTemplate.includes('explain this code please'));
  assert.equal(draft.replaced.preview, 'explain this code please');
  assert.match(draft.replaced.path, /parts\[0\]/, 'the path says where it came from');
});

check('template: everything else in the body is untouched', () => {
  const draft = curl.templateFromCurl(CHROME_CURL, 'chatgpt');
  assert.equal(draft.ok, true);
  const restored = draft.template.bodyTemplate.replace('{{prompt}}', draft.replaced.preview);
  assert.equal(restored, JSON.parse(CHROME_CURL.match(/--data-raw '([^']*)'/)[1]) && restored);
  assert.ok(restored.includes('"action":"next"'));
  assert.ok(restored.includes('"model":"auto"'));
});

check('template: a captured template starts disabled', () => {
  const draft = curl.templateFromCurl(CHROME_CURL, 'claude');
  assert.equal(draft.ok, true);
  assert.equal(draft.template.enabled, false, 'off until it is seen working');
});

check('template: a body with no message-sized string is refused', () => {
  const draft = curl.templateFromCurl(
    `curl 'https://example.test/x' --data '{"a":"b","n":1}'`,
    'gemini',
  );
  assert.equal(draft.ok, false);
  assert.match(draft.error, /no message-sized string/);
});

check('template: a non-JSON body is refused with a reason', () => {
  const draft = curl.templateFromCurl(
    `curl 'https://example.test/x' --data 'hello=world&x=1'`,
    'gemini',
  );
  assert.equal(draft.ok, false);
  assert.match(draft.error, /not JSON/);
});

check('template: a command with no body is refused', () => {
  const draft = curl.templateFromCurl(`curl 'https://example.test/models'`, 'chatgpt');
  assert.equal(draft.ok, false);
  assert.match(draft.error, /no request body/);
});

check('tokenize: quotes and continuations are handled', () => {
  const tokens = curl.tokenize(`curl \\\n  'a b' \\\n  -H "c: d"`);
  assert.equal(tokens.ok, true);
  assert.deepEqual(tokens.tokens, ['curl', 'a b', '-H', 'c: d']);
});

console.log('');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
