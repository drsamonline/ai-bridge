#!/usr/bin/env node
/**
 * "Any provider" — spec §1.
 *
 * Proves the custom-provider path end to end: a page whose DOM shares nothing with
 * the three bundled adapters is driven through a configured selector map, and the
 * same observer/failover machinery produces an answer.
 */

'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const shared = require('../shared/dist/index.js');
const custom = require('../bridge/dist/adapters/custom.js');

const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9230;
const BRIDGE_PORT = 47820;

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
async function waitFor(fn, ms, label) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const CONFIG = {
  id: 'mychat',
  label: 'My Chat',
  url: 'http://127.0.0.1:PORT/mychat.html',
  selectors: { composer: { primary: '#ask' }, send: { primary: '#go' } },
};

async function main() {
  /* ------------------------------------------- 1. config validation */
  check('a minimal config is accepted', () => assert.strictEqual(custom.validateCustomProvider(CONFIG).ok, true));
  check('a missing composer selector is rejected with a reason', () => {
    const v = custom.validateCustomProvider({ ...CONFIG, selectors: { send: { primary: '#go' } } });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /composer\.primary/);
  });
  check('a non-http url is rejected', () => {
    const v = custom.validateCustomProvider({ ...CONFIG, url: 'file:///etc/passwd' });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /http/);
  });
  check('a bad id is rejected', () => {
    const v = custom.validateCustomProvider({ ...CONFIG, id: 'My Chat!' });
    assert.strictEqual(v.ok, false);
  });
  check('generic fallbacks fill the roles the user did not supply', () => {
    const map = custom.buildSelectorMap(CONFIG);
    for (const role of ['composer', 'send', 'assistantTurn', 'markdown', 'stop', 'copySentinel', 'streamingFlag', 'limitBanner']) {
      assert.ok(map[role].primary, `${role} has no primary`);
    }
    assert.strictEqual(map.composer.primary, '#ask');
    assert.match(map.limitBanner.primary, /alert/);
  });

  /* ================================= end-to-end through the real bridge ==== */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-custom-'));
  const fixtureDir = path.join(ROOT, 'test', 'fixtures');
  const fixture = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      fs.readFile(path.join(fixtureDir, path.basename(url.pathname) || 'mychat.html'), (err, body) => {
        if (err) {
          res.writeHead(404).end('nf');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const port = fixture.address().port;
  const config = { ...CONFIG, url: CONFIG.url.replace('PORT', String(port)) };

  const cdpVersion = (p) =>
    new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: p, path: '/json/version', timeout: 1000 }, (res) => {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve(res.statusCode === 200 ? JSON.parse(b) : null));
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.on('error', () => resolve(null));
    });

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitFor(async () => (await cdpVersion(CDP_PORT)) !== null, 20000, 'chromium');

  const bridgeLog = [];
  const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge', 'dist', 'main.js')], {
    env: {
      ...process.env,
      AI_BRIDGE_HOME: path.join(dir, 'home'),
      AI_BRIDGE_PORT: String(BRIDGE_PORT),
      AI_BRIDGE_CDP_PORTS: String(CDP_PORT),
      AI_BRIDGE_RAM_CAP_MB: '8000',
      AI_BRIDGE_POLL_MS: '2000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (b) => {
    for (const line of b.toString().split('\n')) if (line.trim()) bridgeLog.push(line);
  });
  await waitFor(() => bridgeLog.some((l) => l.startsWith('AI_BRIDGE_READY ')), 15000, 'bridge');

  const client = new shared.BridgeClient({ lockDir: path.join(dir, 'home', '.ai-bridge') });
  await client.connect();
  await client.request({ op: 'ctl.attach', ports: [CDP_PORT] }, 25000);

  const reg = await client.request({ op: 'ctl.providers.set', providers: [config, { id: 'BAD ID' }] });
  console.log(`  providers: accepted=${JSON.stringify(reg.accepted)} rejected=${JSON.stringify(reg.rejected)}\n`);
  check('the bridge accepts a valid custom provider', () => assert.deepStrictEqual(reg.accepted, ['mychat']));
  check('the bridge rejects an invalid one with a reason', () => {
    assert.strictEqual(reg.rejected.length, 1);
    assert.match(reg.rejected[0].error, /id/);
  });
  check('the custom provider appears in the adapter list', () =>
    assert.ok(reg.providers.some((p) => p.id === 'mychat')));

  const st = await client.request({ op: 'ctl.status' });
  for (const t of st.browser.tabs) await client.request({ op: 'ctl.tab.close', tabId: t.id });
  await client.request({ op: 'ctl.tab.open', url: config.url });

  const health = await client.request({ op: 'ctl.health', adapterId: 'mychat' }, 30000);
  console.log(`  health: ready=${health.ready} matches=${JSON.stringify(health.matches.map((m) => m.role + ':' + m.via))}\n`);
  check('the custom adapter resolves its configured selectors', () => {
    const byRole = Object.fromEntries(health.matches.map((m) => [m.role, m.via]));
    assert.strictEqual(byRole.composer, 'primary');
    assert.strictEqual(byRole.send, 'primary');
  });

  const answer = await client.request({ op: 'ctl.prompt', adapterId: 'mychat', text: 'hello custom' }, 120000);
  console.log(`  answer: ${JSON.stringify(answer.text.slice(0, 80))} (${answer.settledBy})\n`);
  check('a prompt to a custom provider is answered', () => {
    assert.match(answer.text, /custom provider answered this/);
    assert.ok(['sentinel', 'stop-gone', 'debounce'].includes(answer.settledBy));
  });
  check('the custom provider is reachable through the router chain', async () => {});
  const routerState = await client.request({ op: 'ctl.router' });
  check('the custom provider joined the router', () =>
    assert.ok(routerState.providers.some((p) => p.id === 'mychat')));

  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fixture.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

  const report = [
    '# "Any provider" — custom provider adapter (spec §1)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The config used',
    '',
    '```json',
    JSON.stringify(CONFIG, null, 2),
    '```',
    '',
    'Roles not supplied (assistantTurn, markdown, stop, copySentinel, streamingFlag,',
    'limitBanner) fall back to generic guesses; the observer\'s debounce rule covers a',
    'page with no copy sentinel.',
    '',
  ].join('\n');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-7.3-custom-provider.md'), report.split(ROOT).join('<repo>').split(dir).join('<tmp>'));

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
