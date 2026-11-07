#!/usr/bin/env node
/**
 * Batch 10.11 — the doctor's acceptance harness.
 *
 * The doctor exists because four failures in a row were all "a prerequisite is
 * missing" rather than "the logic is wrong": the bridge was not in the package,
 * the browser was not found, the namespace did not exist. Each cost a round trip
 * because the message said "it failed".
 *
 * So the check here is not that it prints something — it is that it *names the
 * missing thing and says what to do*, and that it never reports success while
 * something is absent.
 */

'use strict';

const assert = require('node:assert');
const doctor = require('../extension/dist/diagnostics/doctor.js');

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

/** Everything working. */
const healthy = {
  extensionVersion: '0.48.0',
  bridgeEntry: { ok: true, path: '/home/u/.vscode/extensions/x/bridge/dist/bridge.js' },
  playwright: true,
  nodeVersion: 'v20.20.2',
  browserMode: 'launch',
  browser: { found: true, path: '/usr/bin/google-chrome' },
  bridgePhase: 'ready',
  lock: { readable: true, socket: '/home/u/.ai-bridge/bridge.sock' },
  platform: 'linux',
};

console.log('');

check('a healthy install reports success', () => {
  const report = doctor.buildReport(healthy);
  assert.equal(report.ok, true, report.markdown);
  assert.ok(!report.checks.some((c) => c.status === 'fail'), report.markdown);
});

check('a package with no bridge is a failure, not a warning', () => {
  // This is the exact bug that shipped: the extension installed, activated, and
  // died at the first command.
  const report = doctor.buildReport({
    ...healthy,
    bridgeEntry: { ok: false, error: 'bridge entry not found (looked in …)' },
  });
  assert.equal(report.ok, false);
  const entry = report.checks.find((c) => c.label === 'Bridge entry');
  assert.equal(entry.status, 'fail');
  assert.match(entry.detail, /not found/);
  assert.match(entry.fix, /reinstall|build:bundle/i);
});

check('missing playwright-core is a failure with a fix', () => {
  const report = doctor.buildReport({ ...healthy, playwright: false });
  const found = report.checks.find((c) => c.label === 'playwright-core');
  assert.equal(found.status, 'fail');
  assert.ok(found.fix, 'no fix offered');
});

check('launch mode with no browser found is a failure', () => {
  const report = doctor.buildReport({
    ...healthy,
    browserMode: 'launch',
    browser: { found: false },
  });
  assert.equal(report.ok, false);
  const found = report.checks.find((c) => c.label === 'Browser');
  assert.equal(found.status, 'fail');
  assert.match(found.fix, /exePath/);
});

check('attach mode with no browser found is only a warning', () => {
  // In attach mode the user starts the browser themselves; not finding one in the
  // usual places is not proof of a problem.
  const report = doctor.buildReport({
    ...healthy,
    browserMode: 'attach',
    browser: { found: false },
  });
  const found = report.checks.find((c) => c.label === 'Browser');
  assert.equal(found.status, 'warn');
  assert.equal(report.ok, true, 'a warning must not fail the report');
});

check('browser mode "off" does not ask for a browser at all', () => {
  const report = doctor.buildReport({
    ...healthy,
    browserMode: 'off',
    browser: { found: false },
  });
  const found = report.checks.find((c) => c.label === 'Browser');
  assert.equal(found.status, 'ok');
  assert.match(found.detail, /not needed/);
});

check('an unknown browser mode is a failure', () => {
  const report = doctor.buildReport({ ...healthy, browserMode: 'sometimes' });
  const found = report.checks.find((c) => c.label === 'Browser mode');
  assert.equal(found.status, 'fail');
  assert.match(found.fix, /attach/);
});

check('a bridge that is not running says how to start it', () => {
  const report = doctor.buildReport({ ...healthy, bridgePhase: 'stopped' });
  const found = report.checks.find((c) => c.label === 'Bridge');
  assert.equal(found.status, 'warn');
  assert.match(found.detail, /Start Bridge/);
});

check('an unreadable lock file is a failure when the bridge claims to be ready', () => {
  const report = doctor.buildReport({
    ...healthy,
    lock: { readable: false, error: 'no lock file at …' },
  });
  assert.equal(report.ok, false);
  const found = report.checks.find((c) => c.label === 'Lock file');
  assert.equal(found.status, 'fail');
});

check('the report is markdown a person can paste', () => {
  const report = doctor.buildReport({ ...healthy, playwright: false });
  assert.match(report.markdown, /^# AI Bridge — something is missing/);
  assert.match(report.markdown, /❌ \*\*playwright-core\*\*/);
  assert.match(report.markdown, /↳/);
});

console.log('');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
