#!/usr/bin/env node
/**
 * Packaging harness — does the thing we ship actually run?
 *
 * This exists because it did not. The extension was installed, activated, and died
 * with "bridge entry not found": the packer shipped `extension/dist/extension.js`
 * and nothing else, so the bridge — a separate process the extension spawns — was
 * never in the package. Every test passed, because every test ran from the repo,
 * where the bridge is present.
 *
 * So the check is the shipped artefact itself: build the .vsix, unpack it, and
 * start the bridge the way the extension starts it.
 */

'use strict';

const assert = require('node:assert');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.dirname(__dirname);
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

// ---- build the package -------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'package.json'), 'utf8'));
const vsix = path.join(ROOT, `ai-bridge-${manifest.version}.vsix`);

try {
  execFileSync('node', ['scripts/make-vsix.mjs'], { cwd: ROOT, stdio: 'pipe' });
} catch (err) {
  console.log(`FAIL  the package builds\n      ${err.message}`);
  console.log('\n0/1 passed');
  process.exit(1);
}

check('the package builds', () => assert.ok(fs.existsSync(vsix), `${vsix} missing`));

// ---- unpack it ---------------------------------------------------------
const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-verify-'));
execFileSync('unzip', ['-q', vsix, '-d', unpacked], { stdio: 'pipe' });
const ext = path.join(unpacked, 'extension');

check('the extension bundle is in the package', () =>
  assert.ok(fs.existsSync(path.join(ext, 'dist', 'extension.js'))));

check('the bridge is in the package', () => {
  // The bug: this file was absent from every package built before 0.45.0.
  assert.ok(
    fs.existsSync(path.join(ext, 'bridge', 'dist', 'bridge.js')),
    'bridge/dist/bridge.js is not shipped — the extension cannot start',
  );
});

check('the bridge needs no workspace at runtime', () => {
  const source = fs.readFileSync(path.join(ext, 'bridge', 'dist', 'bridge.js'), 'utf8');
  assert.ok(
    !/require\("@ai-bridge\/shared"\)/.test(source),
    'the bridge requires @ai-bridge/shared, which is not in a vsix',
  );
});

check("playwright-core travels with it", () =>
  assert.ok(
    fs.existsSync(path.join(ext, 'node_modules', 'playwright-core', 'package.json')),
    'playwright-core is missing, so connectOverCDP would fail',
  ));

check('the manifest identity matches the package', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(ext, 'package.json'), 'utf8'));
  assert.strictEqual(shipped.version, manifest.version);
  assert.strictEqual(shipped.publisher, manifest.publisher);
});

// ---- start the bridge from inside the package --------------------------
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-home-'));

const started = new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(ext, 'bridge', 'dist', 'bridge.js')], {
    cwd: ext,
    env: { ...process.env, AI_BRIDGE_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const done = (ok, why) => {
    child.kill('SIGTERM');
    resolve({ ok, why, output });
  };

  const timer = setTimeout(() => done(false, 'no ready line within 25s'), 25_000);
  const onData = (chunk) => {
    output += chunk.toString();
    if (output.includes('AI_BRIDGE_READY')) {
      clearTimeout(timer);
      done(true, '');
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (err) => {
    clearTimeout(timer);
    done(false, err.message);
  });
});

(async () => {
  const result = await started;
  check('the packaged bridge starts and reports ready', () =>
    assert.ok(result.ok, `${result.why}\n${result.output.split('\n').slice(-8).join('\n')}`));

  fs.rmSync(unpacked, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });

  console.log('');
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exit(1);
  }
})();
