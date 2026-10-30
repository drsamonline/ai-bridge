#!/usr/bin/env node
/**
 * Batch 6.2 acceptance harness — models, isFree routing, delta-only transport.
 *
 * Acceptance: "5 failovers → boot ≤4k each, all deltas present, model list
 * populates Providers tab."
 *
 * The 5-failover loop runs against real fixtures: ChatGPT permanently limited,
 * Claude healthy and echoing back whatever delta lines it was sent, so "all
 * deltas present" is checked against the answer rather than against a log line.
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
const { Router } = require('../bridge/dist/router/router.js');
const models = require('../bridge/dist/adapters/models.js');
const transport = require('../bridge/dist/bootTransport.js');
const { buildBoot } = require('../extension/dist/state/boot.js');
const schema = require('../extension/dist/state/schema.js');

const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9227;
const BRIDGE_PORT = 47816;
const FIXTURE_PORT = 47817;

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

async function main() {
  /* ------------------------------------------------- 1. isFree classification */
  check('a "free"/"mini"/"flash" label counts as free', () => {
    assert.strictEqual(models.classifyFree('GPT-5 mini'), true);
    assert.strictEqual(models.classifyFree('Gemini 2.5 Flash'), true);
    assert.strictEqual(models.classifyFree('Claude Haiku'), true);
  });
  check('a "pro"/"opus"/"max" label counts as paid', () => {
    assert.strictEqual(models.classifyFree('Claude Opus 4'), false);
    assert.strictEqual(models.classifyFree('GPT-4o'), false);
    assert.strictEqual(models.classifyFree('Gemini 2.5 Pro'), false);
  });
  check('an explicit data-chat-model-free attribute wins', () => {
    const out = models.normaliseModels([{ id: 'x', label: 'Mystery Model', free: 'true' }]);
    assert.strictEqual(out[0].isFree, true);
  });
  check('an unknown label defaults to paid (conservative)', () =>
    assert.strictEqual(models.classifyFree('Model 7'), false));
  check('duplicates collapse and exactly one model is current', () => {
    const out = models.normaliseModels([
      { id: 'a', label: 'Alpha' },
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ]);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out.filter((m) => m.current).length, 1);
  });

  /* --------------------------------------------------- 2. router prefers free */
  const freeRouter = new Router({
    providers: [
      { id: 'chatgpt', label: 'ChatGPT', enabled: true, priority: 1, cooldownMs: 1000 },
      { id: 'claude', label: 'Claude', enabled: true, priority: 2, cooldownMs: 1000 },
      { id: 'gemini', label: 'Gemini', enabled: true, priority: 3, cooldownMs: 1000 },
    ],
    strategy: 'priority',
    now: () => 1,
    log: () => {},
  });
  freeRouter.setModelFree('claude', false);
  freeRouter.setModelFree('gemini', true);
  check('priority still wins over free-ness', () =>
    assert.deepStrictEqual(freeRouter.chain().map((p) => p.id), ['chatgpt', 'claude', 'gemini']));
  const tiedRouter = new Router({
    providers: [
      { id: 'paid', label: 'Paid', enabled: true, priority: 1, cooldownMs: 1000 },
      { id: 'free', label: 'Free', enabled: true, priority: 1, cooldownMs: 1000 },
    ],
    strategy: 'priority',
    now: () => 1,
    log: () => {},
  });
  tiedRouter.setModelFree('paid', false);
  tiedRouter.setModelFree('free', true);
  check('within one priority, a free model is tried first', () =>
    assert.deepStrictEqual(tiedRouter.chain().map((p) => p.id), ['free', 'paid']));

  /* ------------------------------------------- 3. delta-only composition */
  const boot = 'You are resuming.\n\n## DOING\n- finish 6.2\n\n## TODO\n- polish';
  const delta = '- edited router.ts\n- decided to prefer free models';
  const composed = transport.composeBoot(boot, delta);
  check('the delta is appended under its own heading', () => {
    assert.match(composed, /## Since the boot/);
    assert.ok(composed.startsWith(boot));
  });
  check('every delta line survives composition', () =>
    assert.strictEqual(transport.deltaLinesPresent(composed, delta).ok, true));
  check('no delta means the boot goes out untouched', () =>
    assert.strictEqual(transport.composeBoot(boot, ''), boot));
  check('the delta line count is reported', () => assert.strictEqual(transport.deltaLineCount(delta), 2));

  /* ======================= end-to-end: models + 5 failovers =============== */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-models-'));
  const fixtureDir = path.join(ROOT, 'test', 'fixtures');
  const fixture = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      fs.readFile(path.join(fixtureDir, path.basename(url.pathname) || 'chatgpt.html'), (err, body) => {
        if (err) {
          res.writeHead(404).end('nf');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
      });
    });
    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(server));
  });

  const base = `http://127.0.0.1:${FIXTURE_PORT}`;
  const chatgptLimit = `${base}/chatgpt.html?variant=limit`;
  const chatgptOk = `${base}/chatgpt.html`;
  const claudePicker = `${base}/assistant.html?flavor=claude&variant=boot`;
  const claudeNoPicker = `${base}/assistant.html?flavor=claude&variant=boot&no-picker=1`;

  const cdpVersion = (port) =>
    new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1000 }, (res) => {
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

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
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
      AI_BRIDGE_CHATGPT_URL: chatgptLimit,
      AI_BRIDGE_CLAUDE_URL: claudePicker,
      AI_BRIDGE_GEMINI_URL: claudeNoPicker,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (b) => {
    for (const line of b.toString().split('\n')) if (line.trim()) bridgeLog.push(line);
  });
  await waitFor(() => bridgeLog.some((l) => l.startsWith('AI_BRIDGE_READY ')), 15000, 'bridge');

  const client = new shared.BridgeClient({ lockDir: path.join(dir, 'home', '.ai-bridge') });
  const events = [];
  client.on('event', (e) => events.push(e));
  await client.connect();
  await client.request({ op: 'ctl.attach', ports: [CDP_PORT] }, 25000);

  const closeAll = async () => {
    const st = await client.request({ op: 'ctl.status' });
    for (const t of st.browser.tabs) await client.request({ op: 'ctl.tab.close', tabId: t.id });
  };

  /* ---- models: a picker account ---------------------------------------- */
  await closeAll();
  await client.request({ op: 'ctl.tab.open', url: claudePicker });
  const found = await client.request({ op: 'ctl.models', adapterId: 'claude' }, 30000);
  console.log(`  models (picker): ${JSON.stringify(found.models.map((m) => `${m.id}:${m.isFree ? 'free' : 'paid'}${m.current ? '*' : ''}`))}\n`);
  check('the model list is scraped from the picker', () => assert.ok(found.models.length >= 2));
  check('the current model is identified', () => {
    const current = found.models.find((m) => m.current);
    assert.ok(current, 'no current model');
    assert.match(current.label, /Sonnet/);
  });
  check('isFree distinguishes the free tier', () => {
    const haiku = found.models.find((m) => /haiku/i.test(m.label));
    assert.ok(haiku, 'no haiku model');
    assert.strictEqual(haiku.isFree, true);
    assert.strictEqual(found.models.find((m) => /sonnet/i.test(m.label)).isFree, false);
  });

  /* ---- models: an account with no picker -------------------------------- */
  await closeAll();
  await client.request({ op: 'ctl.tab.open', url: claudeNoPicker });
  const inferred = await client.request({ op: 'ctl.models', adapterId: 'gemini' }, 30000);
  console.log(`  models (no picker): ${JSON.stringify(inferred.models)}\n`);
  check('an account with no picker infers a single default model', () => {
    assert.strictEqual(inferred.models.length, 1);
    assert.strictEqual(inferred.models[0].current, true);
  });

  /* ---- 5 failovers, each carrying boot + delta -------------------------- */
  const state = schema.createState({ id: 'models', root: dir });
  state.doing.push({ id: 't1', task: 'finish delta-only transport', files: ['bootTransport.ts'] });
  state.todo.push({ id: 't2', task: 'polish in 7.1', files: [] });
  const bootObj = buildBoot(state);
  const deltaText = '- edited bootTransport.ts\n- decided to prefer free models';

  const rounds = [];
  for (let i = 1; i <= 5; i += 1) {
    await client.request({ op: 'ctl.router.clear' });
    await closeAll();
    await client.request({ op: 'ctl.tab.open', url: chatgptLimit });
    events.length = 0;
    const res = await client.request(
      {
        op: 'ctl.prompt',
        adapterId: 'auto',
        text: `round ${i}`,
        boot: bootObj.text,
        delta: deltaText,
      },
      120000,
    );
    const injected = events.find((e) => e.kind === 'boot.injected');
    rounds.push({
      i,
      adapter: res.adapterId,
      switched: res.switched.length,
      bootChars: res.bootChars ?? injected?.data?.bootChars ?? 0,
      deltaLines: injected?.data?.deltaLines ?? 0,
      text: res.text,
      bootAnswer: res.bootAnswer ?? '',
    });
  }
  console.log(
    `  failovers: ${rounds.map((r) => `#${r.i}→${r.adapter} boot=${r.bootChars}ch delta=${r.deltaLines}`).join('  ')}\n`,
  );

  check('all five rounds failed over to the fallback provider', () =>
    assert.ok(rounds.every((r) => r.adapter === 'claude' && r.switched === 1), JSON.stringify(rounds.map((r) => r.adapter))));
  check('every injected boot stayed inside 4k tokens', () => {
    for (const r of rounds) {
      // 4k tokens at the conservative 4 chars/token is 16 000 characters.
      assert.ok(r.bootChars > 0 && r.bootChars <= 16_000, `round ${r.i}: ${r.bootChars} chars`);
    }
  });
  check('every round carried both delta lines', () =>
    assert.ok(rounds.every((r) => r.deltaLines === 2), JSON.stringify(rounds.map((r) => r.deltaLines))));
  check('the provider echoed the deltas back (they arrived intact)', () => {
    for (const r of rounds) {
      assert.match(r.bootAnswer, /SINCE:/, `round ${r.i} had no delta echo`);
      assert.match(r.bootAnswer, /edited bootTransport\.ts/, `round ${r.i} lost delta line 1`);
      assert.match(r.bootAnswer, /prefer free models/, `round ${r.i} lost delta line 2`);
    }
  });
  check('the boot itself was restated each round', () =>
    assert.ok(rounds.every((r) => /finish delta-only transport/.test(r.bootAnswer))));

  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fixture.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

  /* ------------------------------------------------------------- report */
  const report = [
    '# Batch 6.2 — model discovery, isFree routing, delta-only transport',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **5 failovers → boot ≤4k each, all deltas present, model list populates Providers tab.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## Model discovery',
    '',
    '```',
    `picker account   ${JSON.stringify(found.models)}`,
    `no-picker account ${JSON.stringify(inferred.models)}`,
    '```',
    '',
    '## Five failovers',
    '',
    '| round | answered by | switches | boot chars | delta lines |',
    '|---|---|---|---|---|',
    ...rounds.map((r) => `| ${r.i} | ${r.adapter} | ${r.switched} | ${r.bootChars} | ${r.deltaLines} |`),
    '',
    '## What the provider said when it received the boot (round 1)',
    '',
    '```',
    rounds[0].bootAnswer,
    '```',
    '',
  ].join('\n');

  const scrub = (t) => t.split(ROOT).join('<repo>').split(dir).join('<tmp>').split(String(FIXTURE_PORT)).join('<port>');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-6.2-models.md'), scrub(report));

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
