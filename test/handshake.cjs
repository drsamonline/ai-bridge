#!/usr/bin/env node
/**
 * Batch 0.1 acceptance harness — headless.
 *
 * Exercises the SAME code path the extension runs (shared/dist BridgeClient),
 * against a real bridge process, in a throwaway HOME. Proves:
 *
 *   1. lock dir 0700 / lock file 0600, correct shape
 *   2. `{ op: 'attach' }` handshake accepted, token fingerprint matches
 *   3. wrong token -> close 4001, no data leak
 *   4. non-attach first frame -> close 4001
 *   5. post-handshake unimplemented op -> { ok:false, error:'ENOTIMPL…' }
 *   6. SIGTERM removes the lock file
 */

'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WebSocket = require('ws');
const shared = require('../shared/dist/index.js');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE_ENTRY = path.join(ROOT, 'bridge', 'dist', 'main.js');
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

function waitFor(emitter, event, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
    emitter.once(event, (...args) => {
      clearTimeout(t);
      resolve(args);
    });
  });
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-home-'));
  const lockDir = path.join(home, '.ai-bridge');
  const lockFile = path.join(lockDir, 'lock.json');
  const bridgeLog = [];
  const extLog = [];

  console.log(`harness HOME=${home}`);
  console.log(`bridge entry=${BRIDGE_ENTRY}\n`);

  const child = spawn(process.execPath, [BRIDGE_ENTRY], {
    env: { ...process.env, AI_BRIDGE_HOME: home, AI_BRIDGE_PORT: '47801', AI_BRIDGE_LOG_LEVEL: 'debug' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => {
    for (const line of b.toString().split('\n')) if (line.trim()) {
      bridgeLog.push(line);
      console.log(`  [bridge] ${line}`);
    }
  });
  child.stderr.on('data', (b) => {
    for (const line of b.toString().split('\n')) if (line.trim()) {
      bridgeLog.push(`STDERR ${line}`);
      console.error(`  [bridge:err] ${line}`);
    }
  });

  // Wait for the machine-readable ready line.
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('bridge never became ready')), 15000);
    const iv = setInterval(() => {
      if (bridgeLog.some((l) => l.startsWith('AI_BRIDGE_READY '))) {
        clearTimeout(t);
        clearInterval(iv);
        resolve();
      }
    }, 50);
  });

  // ---- 1. lock file -----------------------------------------------------
  const dirMode = fs.statSync(lockDir).mode & 0o777;
  const fileMode = fs.statSync(lockFile).mode & 0o777;
  const raw = JSON.parse(fs.readFileSync(lockFile, 'utf8'));

  check('lock dir exists with mode 0700', () => assert.strictEqual(dirMode.toString(8), '700'));
  check('lock file exists with mode 0600', () => assert.strictEqual(fileMode.toString(8), '600'));
  check('lock shape is valid (v/host/port/token/pid)', () => {
    const validated = shared.validateLock(raw);
    assert.strictEqual(validated.host, '127.0.0.1');
    assert.match(validated.token, /^[0-9a-f]{64}$/);
    assert.strictEqual(validated.port, 47801);
  });
  check('lock mode is world/group inaccessible', () => assert.strictEqual(fileMode & 0o077, 0));

  // ---- 2. handshake through the real client -----------------------------
  const client = new shared.BridgeClient({ lockDir });
  client.on('log', (level, message) => {
    extLog.push(`${level.toUpperCase().padEnd(5)} ${message}`);
    console.log(`  [ext]   ${message}`);
  });

  let handshake;
  try {
    handshake = await client.connect();
  } catch (err) {
    failures += 1;
    console.log(`FAIL  handshake via BridgeClient — ${err.message}`);
    console.log('\n--- bridge log ---\n' + bridgeLog.join('\n'));
    child.kill('SIGTERM');
    process.exit(1);
  }

  check('handshake ok', () => assert.strictEqual(handshake.bridge.protocol, 1));
  check('handshake reports the real bridge pid', () =>
    assert.strictEqual(handshake.bridge.pid, child.pid));
  check('handshake token fingerprint matches lock token', () =>
    assert.strictEqual(
      handshake.tokenFingerprint,
      crypto.createHash('sha256').update(raw.token).digest('hex').slice(0, 12),
    ));
  check('client state is "connected"', () => assert.strictEqual(client.state, 'connected'));

  // ---- 3. wrong token ---------------------------------------------------
  const wrongTokenCode = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${raw.port}`);
    ws.on('open', () =>
      ws.send(JSON.stringify({ op: 'attach', port: raw.port, token: 'a'.repeat(64), rid: 'h' })));
    ws.on('close', (code) => resolve(code));
    ws.on('error', () => {});
    setTimeout(() => {
      ws.terminate();
      resolve(-1);
    }, 4000);
  });
  check('wrong token is rejected with close code 4001', () =>
    assert.strictEqual(wrongTokenCode, 4001));

  // ---- 4. non-attach first frame ---------------------------------------
  const firstFrameCode = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${raw.port}`);
    ws.on('open', () => ws.send(JSON.stringify({ op: 'health', adapterId: 'chatgpt' })));
    ws.on('close', (code) => resolve(code));
    ws.on('error', () => {});
    setTimeout(() => {
      ws.terminate();
      resolve(-1);
    }, 4000);
  });
  check('non-attach first frame rejected with 4001', () =>
    assert.strictEqual(firstFrameCode, 4001));

  // ---- 5. unimplemented op is answered, not ignored ---------------------
  let notImpl;
  try {
    notImpl = await client.request({ op: 'models', adapterId: 'chatgpt' }, 4000).then(
      () => 'resolved',
      (err) => err.message,
    );
  } catch (err) {
    notImpl = err.message;
  }
  check('unimplemented op answers ENOTIMPL', () =>
    assert.match(String(notImpl), /ENOTIMPL/));

  // ---- 6. lock removal on shutdown -------------------------------------
  client.close();
  const exited = waitFor(child, 'exit', 8000, 'bridge exit');
  child.kill('SIGTERM');
  await exited;
  check('lock file removed on SIGTERM', () => assert.strictEqual(fs.existsSync(lockFile), false));

  // ---- report -----------------------------------------------------------
  const handshakeProof = extLog.filter((l) => /handshake OK|HANDSHAKE|attach/i.test(l));
  const out = [
    '# Batch 0.1 — acceptance evidence',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Node: ${process.version} · platform: ${process.platform} ${process.arch}`,
    `Harness HOME: <tmp-home> (throwaway directory, deleted after the run)`,
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## Extension-side log (the exact lines the "AI Bridge" Output channel shows)',
    '',
    '```',
    ...extLog,
    '```',
    '',
    '## Bridge-side log (piped into the same Output channel)',
    '',
    '```',
    ...bridgeLog,
    '```',
    '',
    '## Lock file as written on disk',
    '',
    '```json',
    JSON.stringify({ ...raw, token: `${raw.token.slice(0, 4)}…${raw.token.slice(-4)} (redacted)` }, null, 2),
    '```',
    '',
    `Modes: dir 0${dirMode.toString(8)} · file 0${fileMode.toString(8)}`,
    '',
  ].join('\n');

  const scrub = (t) => t.split(ROOT).join('<repo>').split(home).join('<tmp-home>');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-0.1-acceptance.md'), scrub(out));
  fs.rmSync(home, { recursive: true, force: true });

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures > 0) {
    console.log('\n--- bridge log ---\n' + bridgeLog.join('\n'));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
