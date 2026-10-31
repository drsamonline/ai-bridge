#!/usr/bin/env node
/**
 * Batch 10.0 acceptance harness — launching a browser, when asked.
 *
 * Acceptance: "launch mode starts a debugging browser with a profile of its own,
 * and never touches the one the user is browsing in."
 *
 * Nothing here starts a real browser: the assertions are the arguments we would
 * pass, plus the failure path for a binary that does not exist. That is the part
 * that can be wrong silently — a missing `--user-data-dir` works on old Chrome
 * and fails on new, which is the bug worth pinning.
 */

'use strict';

const assert = require('node:assert');
const launch = require('../bridge/dist/cdp/launch.js');

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

console.log('');

(async () => {
  await check('args: the debugging port is set', () => {
    const args = launch.buildLaunchArgs({ port: 9333 });
    assert.ok(args.includes('--remote-debugging-port=9333'), args.join(' '));
  });

  await check('args: a profile folder is always passed', () => {
    // Recent Chrome ignores the debugging port on the default profile, so this
    // flag is what makes launch mode work at all.
    const args = launch.buildLaunchArgs({ port: 9222 });
    const profile = args.find((arg) => arg.startsWith('--user-data-dir='));
    assert.ok(profile, 'no --user-data-dir');
    assert.ok(profile.length > '--user-data-dir='.length, 'an empty profile path');
  });

  await check('args: the profile defaults to one of its own', () => {
    const args = launch.buildLaunchArgs({ port: 9222 });
    const profile = args.find((arg) => arg.startsWith('--user-data-dir=')).split('=')[1];
    assert.match(profile, /\.ai-bridge/);
    assert.match(profile, /browser-profile/);
  });

  await check('args: windowed by default, headless on request', () => {
    assert.ok(!launch.buildLaunchArgs({}).some((arg) => arg.startsWith('--headless')));
    const headless = launch.buildLaunchArgs({ headless: true });
    assert.ok(headless.includes('--headless=new'));
    assert.ok(headless.includes('--disable-gpu'), 'headless without --disable-gpu still composites');
  });

  await check('args: extra flags are appended, not replacing', () => {
    const args = launch.buildLaunchArgs({ extraArgs: ['--lang=en'] });
    assert.ok(args.includes('--lang=en'));
    assert.ok(args.includes('--no-first-run'), 'the defaults survived');
  });

  await check('args: a custom profile folder is used verbatim', () => {
    const args = launch.buildLaunchArgs({ profileDir: '/tmp/my-profile' });
    assert.ok(args.includes('--user-data-dir=/tmp/my-profile'));
  });

  await check('detect: candidates exist for each platform', () => {
    // The Windows roots live in environment variables that only exist there, so
    // they are injected — otherwise this check passes on Windows and is empty on
    // every other platform, which is how it was first written.
    const winEnv = { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };
    assert.ok(launch.candidateBrowsers('win32', winEnv).some((p) => /chrome\.exe$/.test(p)));
    assert.ok(launch.candidateBrowsers('win32', winEnv).some((p) => /msedge\.exe$/.test(p)));
    assert.deepEqual(launch.candidateBrowsers('win32', {}), [], 'no roots, no guesses');
    assert.ok(launch.candidateBrowsers('darwin').some((p) => p.includes('Google Chrome.app')));
    assert.ok(launch.candidateBrowsers('linux').some((p) => p.includes('chromium')));
  });

  await check('detect: an unknown platform yields nothing', () => {
    assert.deepEqual(launch.candidateBrowsers('plan9'), []);
    assert.equal(launch.detectBrowserPath('plan9'), undefined);
  });

  await check('failure: a binary that does not exist is reported, not thrown', async () => {
    const result = await launch.launchBrowser({
      executablePath: '/nonexistent/browser-that-is-not-there',
      profileDir: '/tmp/ai-bridge-launch-test',
      port: 9,
      timeoutMs: 300,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /ESPAWN|ENOBROWSER/);
    assert.ok(result.port === 9, 'the port is reported even on failure');
  });

  await check('failure: an unusable profile folder is reported', async () => {
    const result = await launch.launchBrowser({
      executablePath: process.execPath, // a real binary, but not a browser
      profileDir: '/proc/definitely-not-writable/profile',
      port: 9,
      timeoutMs: 300,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /ECANNOTPROFILE|ENOPORT|ESPAWN/);
  });

  console.log('');
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exit(1);
  }
})();
