#!/usr/bin/env node
/**
 * Batch 8.4b acceptance harness — a sign-in page is not a broken selector.
 *
 * The DOM path used to report "no answer" for everything, including an expired
 * session. That message sends the user hunting for a selector when the fix is to
 * sign in to the tab. These checks pin the heuristic that separates the two.
 */

'use strict';

const assert = require('node:assert');
const signin = require('../bridge/dist/adapters/signin.js');

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

console.log('');

check('signin: a provider login path is recognised', () => {
  assert.equal(signin.looksLikeSignIn('https://chatgpt.com/auth/login'), true);
  assert.equal(signin.looksLikeSignIn('https://claude.ai/login'), true);
  assert.equal(signin.looksLikeSignIn('https://chat.example.test/signin?next=/chat'), true);
  assert.equal(signin.looksLikeSignIn('https://gemini.google.com/session/new'), true);
});

check('signin: a Google account chooser is recognised', () => {
  assert.equal(
    signin.looksLikeSignIn('https://accounts.google.com/v3/signin/identifier?continue=…'),
    true,
  );
});

check('signin: a normal chat URL is not a sign-in page', () => {
  assert.equal(signin.looksLikeSignIn('https://chatgpt.com/c/abc-123'), false);
  assert.equal(signin.looksLikeSignIn('https://claude.ai/chat/8f2'), false);
  assert.equal(signin.looksLikeSignIn('https://chat.example.test/'), false);
});

check('signin: near-misses do not trip it', () => {
  // `authoring` contains "auth"; a false positive would tell a signed-in user to
  // sign in, which is worse than the vaguer message it replaced.
  assert.equal(signin.looksLikeSignIn('https://example.test/authoring/new'), false);
  assert.equal(signin.looksLikeSignIn('https://example.test/blog/login-tips'), false);
  assert.equal(signin.looksLikeSignIn('https://example.test/api/login'), false);
});

check('signin: an empty or unparseable url is not a sign-in page', () => {
  assert.equal(signin.looksLikeSignIn(''), false);
  assert.equal(signin.looksLikeSignIn('about:blank'), false);
});

check('signin: the error carries the EAUTH code and the host only', () => {
  const message = signin.signInError('chatgpt', 'https://chatgpt.com/auth/login?next=/c/secret-id');
  assert.match(message, /^EAUTH: /);
  assert.match(message, /chatgpt/);
  assert.match(message, /chatgpt\.com/);
  assert.ok(!message.includes('secret-id'), 'no path or query leaks into the message');
});

check('signin: an unparseable url still produces a usable message', () => {
  const message = signin.signInError('claude', 'about:blank');
  assert.match(message, /^EAUTH: claude/);
  assert.match(message, /unknown/);
});

console.log('');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
