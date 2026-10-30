#!/usr/bin/env node
/**
 * Batch 1.1 acceptance harness — the ChatGPT adapter against its DOM contract.
 *
 * chatgpt.com cannot be logged into from CI, so this runs the REAL adapter,
 * through REAL CDP, against `test/fixtures/chatgpt.html`, which reproduces the
 * DOM the selector chain targets: composer, send/stop buttons, assistant turns
 * with `.markdown`, the copy-turn sentinel, `.result-streaming`, and the
 * usage-cap banner.
 *
 * Proves: selector chain (primary → fallback → aria), prompt submission,
 * streamed deltas, settle detection by sentinel / stop-button / debounce,
 * first token < 3 s, limit detection, and the health report.
 */

'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const shared = require('../shared/dist/index.js');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE_ENTRY = path.join(ROOT, 'bridge', 'dist', 'main.js');
const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9222;
const BRIDGE_PORT = 47804;
const FIXTURE_PORT = 47805;

const results = [];
let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`FAIL  ${name}\n      ${err.message}`);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function serveFixture() {
  const dir = path.join(ROOT, 'test', 'fixtures');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = path.join(dir, path.basename(url.pathname) || 'chatgpt.html');
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    });
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(server)));
}

function cdpVersion(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(res.statusCode === 200 ? JSON.parse(body) : null));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-chat-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-chat-prof-'));
  const fixture = await serveFixture();
  const baseUrl = `http://127.0.0.1:${FIXTURE_PORT}/chatgpt.html`;
  console.log(`fixture served at ${baseUrl}`);

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  await waitFor(async () => (await cdpVersion(CDP_PORT)) !== null, 20000, 'chromium CDP endpoint');

  const bridgeLog = [];
  const bridge = spawn(process.execPath, [BRIDGE_ENTRY], {
    env: {
      ...process.env,
      AI_BRIDGE_HOME: home,
      AI_BRIDGE_PORT: String(BRIDGE_PORT),
      AI_BRIDGE_CDP_PORTS: String(CDP_PORT),
      AI_BRIDGE_RAM_CAP_MB: '8000',
      AI_BRIDGE_POLL_MS: '2000',
      AI_BRIDGE_LOG_LEVEL: 'debug',
      AI_BRIDGE_CHATGPT_URL: baseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (b) => {
    for (const line of b.toString().split('\n')) if (line.trim()) bridgeLog.push(line);
  });
  bridge.stderr.on('data', (b) => {
    for (const line of b.toString().split('\n')) if (line.trim()) bridgeLog.push(`STDERR ${line}`);
  });
  await waitFor(() => bridgeLog.some((l) => l.startsWith('AI_BRIDGE_READY ')), 15000, 'bridge ready');

  const client = new shared.BridgeClient({ lockDir: path.join(home, '.ai-bridge') });
  const deltas = [];
  const events = [];
  client.on('event', (e) => {
    events.push(e);
    if (e.kind === 'stream.delta') deltas.push(e);
  });
  await client.connect();
  await client.request({ op: 'ctl.attach', ports: [CDP_PORT] }, 25000);
  console.log('attached\n');

  /** Fresh tab on a fixture variant; returns the tab id. */
  const openVariant = async (query) => {
    const status = await client.request({ op: 'ctl.status' });
    for (const tab of status.browser.tabs) await client.request({ op: 'ctl.tab.close', tabId: tab.id });
    const tab = await client.request({ op: 'ctl.tab.open', url: `${baseUrl}${query}` });
    return tab;
  };

  // ---- 1. default variant: prompt → stream → sentinel ---------------------
  await openVariant('');
  deltas.length = 0;
  events.length = 0;
  const r1 = await client.request(
    { op: 'ctl.prompt', adapterId: 'chatgpt', text: 'Say something about foxes' },
    60000,
  );

  check('prompt returns the assistant text', () =>
    assert.match(r1.text, /quick brown fox/i));
  check('answer streamed rather than arriving at once', () => assert.ok(deltas.length >= 2, `${deltas.length} deltas`));
  check('deltas grow monotonically', () => {
    for (let i = 1; i < deltas.length; i += 1) {
      if (deltas[i].data.text.length < deltas[i - 1].data.text.length) {
        throw new Error(`delta ${i} shrank`);
      }
    }
  });
  check('first token under 3 s (§NFR)', () =>
    assert.ok(r1.firstTokenMs !== null && r1.firstTokenMs < 3000, `${r1.firstTokenMs} ms`));
  check('settled by the copy-button sentinel', () => assert.strictEqual(r1.settledBy, 'sentinel'));
  check('stream.start and stream.end events emitted', () => {
    assert.ok(events.some((e) => e.kind === 'stream.start'));
    assert.ok(events.some((e) => e.kind === 'stream.end'));
  });
  check('turn counted against the recycle budget', () => assert.ok(r1.turns >= 1));

  // ---- 2. health / selector chain ---------------------------------------
  const h1 = await client.request({ op: 'ctl.health', adapterId: 'chatgpt' });
  const via = (role) => (h1.matches.find((m) => m.role === role) || {}).via;
  check('health reports the adapter ready', () => assert.strictEqual(h1.ready, true));
  check('composer resolved via primary selector', () => assert.strictEqual(via('composer'), 'primary'));
  check('send resolved via primary selector', () => assert.strictEqual(via('send'), 'primary'));

  // ---- 3. fallback path: send button without data-testid -----------------
  await openVariant('?variant=no-primary-send');
  const h2 = await client.request({ op: 'ctl.health', adapterId: 'chatgpt' });
  const via2 = (role) => (h2.matches.find((m) => m.role === role) || {}).via;
  check('send falls back when the primary selector is missing', () =>
    assert.strictEqual(via2('send'), 'fallback'));
  const r2 = await client.request(
    { op: 'ctl.prompt', adapterId: 'chatgpt', text: 'fallback path please' },
    60000,
  );
  check('prompt still works through the fallback selector', () =>
    assert.match(r2.text, /quick brown fox/i));

  // ---- 4. fallback path: composer without an id --------------------------
  await openVariant('?variant=no-composer-id');
  const h3 = await client.request({ op: 'ctl.health', adapterId: 'chatgpt' });
  const via3 = (h3.matches.find((m) => m.role === 'composer') || {}).via;
  console.log('  no-composer-id matches:', JSON.stringify(h3.matches));
  check('composer falls back when #prompt-textarea is absent', () =>
    assert.ok(['fallback', 'accessibility'].includes(via3), `via=${via3}`));

  // ---- 5. no copy sentinel → settles on the stop button disappearing ------
  await openVariant('?variant=no-copy');
  const r3 = await client.request(
    { op: 'ctl.prompt', adapterId: 'chatgpt', text: 'no copy button here' },
    60000,
  );
  check('settles without the copy sentinel (stop-gone)', () =>
    assert.strictEqual(r3.settledBy, 'stop-gone'));
  check('text still captured without the sentinel', () => assert.match(r3.text, /fox/i));

  // ---- 6. streaming flag never clears → debounce fallback ----------------
  await openVariant('?variant=stuck');
  const r4 = await client.request(
    { op: 'ctl.prompt', adapterId: 'chatgpt', text: 'never settles cleanly', debounceMs: 700 },
    60000,
  );
  check('degrades to the debounce rule when nothing signals completion', () =>
    assert.strictEqual(r4.settledBy, 'debounce'));
  check('partial text preserved in the degraded path', () => assert.ok(r4.text.length > 10));

  // ---- 7. limit detection ------------------------------------------------
  await openVariant('?variant=limit');
  const h4 = await client.request({ op: 'ctl.health', adapterId: 'chatgpt' });
  check('health detects the usage-cap banner', () => assert.strictEqual(h4.limited, true));
  check('limit kind classified as quota', () => assert.strictEqual(h4.limitKind, 'quota'));
  const limitErr = await client
    .request({ op: 'ctl.prompt', adapterId: 'chatgpt', text: 'should not send' }, 30000)
    .then(
      () => null,
      (err) => err.message,
    );
  check('prompt refuses while limited (ELIMIT)', () => assert.match(String(limitErr), /ELIMIT/));

  // ---- 8. unknown adapter is a clean error -------------------------------
  const badAdapter = await client
    .request({ op: 'ctl.prompt', adapterId: 'nope', text: 'x' }, 10000)
    .then(
      () => null,
      (err) => err.message,
    );
  check('unknown adapter fails with ENOADAPTER', () => assert.match(String(badAdapter), /ENOADAPTER/));

  // ---- teardown ----------------------------------------------------------
  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fixture.close();

  const scrub = (t) =>
    t.split(ROOT).join('<repo>').split(home).join('<tmp-home>').split(profile).join('<tmp-profile>');
  const report = [
    '# Batch 1.1 — ChatGPT adapter acceptance evidence',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Node ${process.version} · fixture ${baseUrl.replace(String(FIXTURE_PORT), '<port>')}`,
    '',
    'The adapter runs unmodified through real CDP; only the page is a fixture that',
    'reproduces ChatGPT\'s DOM contract. **Live-account selector verification is still',
    'outstanding** — see the README section "Selectors need one live run".',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    `First token: ${r1.firstTokenMs} ms · total ${r1.totalMs} ms · deltas ${deltas.length} · settled by ${r1.settledBy}`,
    '',
    '## Selector matches (default variant)',
    '',
    '```',
    ...h1.matches.map((m) => `${m.role.padEnd(14)} ${m.via.padEnd(13)} ${m.matched}`),
    '```',
    '',
    '## Bridge log (tail)',
    '',
    '```',
    ...bridgeLog.slice(-40),
    '```',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-1.1-adapter.md'), scrub(report));
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures > 0) {
    console.log('\n--- bridge log tail ---\n' + bridgeLog.slice(-30).join('\n'));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
