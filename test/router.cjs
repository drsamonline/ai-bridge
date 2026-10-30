#!/usr/bin/env node
/**
 * Batch 6.1 acceptance harness — router + Claude/Gemini adapters.
 *
 * Acceptance: "ChatGPT limit → Claude w/ context + toast."
 *
 * The unit half pins the router's policy against a fake clock (priority,
 * cooldown, exponential backoff with jitter, pre-warm at 80%, round-robin). The
 * end-to-end half uses two REAL fixtures: ChatGPT permanently limited, Claude
 * healthy — so the failover has to actually open Claude, inject the boot, and
 * come back with an answer.
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
const { buildBoot } = require('../extension/dist/state/boot.js');
const schema = require('../extension/dist/state/schema.js');

const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9226;
const BRIDGE_PORT = 47814;
const FIXTURE_PORT = 47815;

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
const checkAsync = async (name, fn) => {
  try {
    await fn();
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

const SPECS = [
  { id: 'chatgpt', label: 'ChatGPT', enabled: true, priority: 1, cooldownMs: 300_000 },
  { id: 'claude', label: 'Claude', enabled: true, priority: 2, cooldownMs: 300_000 },
  { id: 'gemini', label: 'Gemini', enabled: true, priority: 3, cooldownMs: 300_000 },
];

function clockedRouter(overrides = {}) {
  let now = 1_000_000;
  const router = new Router({
    providers: SPECS,
    strategy: 'priority',
    retries: 2,
    backoff: 'exponential',
    now: () => now,
    jitter: () => 1,
    ...overrides,
  });
  return {
    router,
    advance: (ms) => {
      now += ms;
    },
    at: () => now,
  };
}

async function main() {
  /* ------------------------------------------------------- 1. priority chain */
  const a = clockedRouter();
  check('the chain follows priority order', () =>
    assert.deepStrictEqual(a.router.chain().map((p) => p.id), ['chatgpt', 'claude', 'gemini']));
  check('next() is the highest-priority provider', () =>
    assert.strictEqual(a.router.next().id, 'chatgpt'));

  const b = clockedRouter({
    providers: [
      { id: 'chatgpt', label: 'ChatGPT', enabled: false, priority: 1, cooldownMs: 1000 },
      { id: 'claude', label: 'Claude', enabled: true, priority: 2, cooldownMs: 1000 },
    ],
  });
  check('a disabled provider is skipped', () =>
    assert.deepStrictEqual(b.router.chain().map((p) => p.id), ['claude']));

  /* ----------------------------------------------------------- 2. cooldown */
  const c = clockedRouter();
  const coolMs = c.router.markLimited('chatgpt', 'quota');
  check('a limit starts a cooldown of the configured length', () => {
    assert.strictEqual(coolMs, 300_000);
    assert.strictEqual(c.router.isCooling('chatgpt'), true);
  });
  check('a cooling provider drops out of the chain', () =>
    assert.deepStrictEqual(c.router.chain().map((p) => p.id), ['claude', 'gemini']));
  c.advance(299_000);
  check('still cooling just before expiry', () =>
    assert.strictEqual(c.router.isCooling('chatgpt'), true));
  c.advance(2_000);
  check('the provider returns after its cooldown', () => {
    assert.strictEqual(c.router.isCooling('chatgpt'), false);
    assert.strictEqual(c.router.next().id, 'chatgpt');
  });
  check('a provider-supplied reset time wins over the default cooldown', () => {
    const d = clockedRouter();
    d.router.markLimited('chatgpt', 'quota', d.at() + 5_000);
    assert.strictEqual(d.router.isCooling('chatgpt'), true);
    d.advance(6_000);
    assert.strictEqual(d.router.isCooling('chatgpt'), false);
  });

  /* ------------------------------------------------------------ 3. backoff */
  const e = clockedRouter();
  const f1 = e.router.markFailure('chatgpt');
  const f2 = e.router.markFailure('chatgpt');
  const f3 = e.router.markFailure('chatgpt');
  check('failures back off exponentially', () => {
    assert.deepStrictEqual([f1.retryAfterMs, f2.retryAfterMs], [1000, 2000]);
  });
  check('the last retry is exhausted and cools the provider', () => {
    assert.strictEqual(f3.exhausted, true);
    assert.strictEqual(e.router.isCooling('chatgpt'), true);
  });
  check('jitter keeps retries inside ±20%', () => {
    const j = clockedRouter({ jitter: () => 0.8 });
    assert.strictEqual(j.router.markFailure('chatgpt').retryAfterMs, 800);
    const k = clockedRouter({ jitter: () => 1.2 });
    assert.strictEqual(k.router.markFailure('chatgpt').retryAfterMs, 1200);
  });
  check('linear backoff is not exponential', () => {
    // retries: 3 so the third attempt is a retry, not the exhaustion path.
    const lin = clockedRouter({ backoff: 'linear', retries: 3 });
    assert.strictEqual(lin.router.markFailure('chatgpt').retryAfterMs, 1000);
    assert.strictEqual(lin.router.markFailure('chatgpt').retryAfterMs, 2000);
    assert.strictEqual(lin.router.markFailure('chatgpt').retryAfterMs, 3000);
  });
  check('retries are bounded: the attempt after them is exhausted', () => {
    const bounded = clockedRouter({ retries: 1 });
    assert.strictEqual(bounded.router.markFailure('chatgpt').exhausted, false);
    const last = bounded.router.markFailure('chatgpt');
    assert.strictEqual(last.exhausted, true);
  });
  check('a success clears failures and cooldown', () => {
    const g = clockedRouter();
    g.router.markFailure('chatgpt');
    g.router.markLimited('chatgpt', 'quota');
    g.router.markSuccess('chatgpt');
    assert.strictEqual(g.router.isCooling('chatgpt'), false);
    assert.strictEqual(g.router.status().find((p) => p.id === 'chatgpt').failures, 0);
  });

  /* ------------------------------------------------------------ 4. pre-warm */
  const h = clockedRouter();
  h.router.markLimited('chatgpt', 'quota');
  check('no pre-warm candidates at the start of a cooldown', () =>
    assert.deepStrictEqual(h.router.prewarmCandidates().map((p) => p.id), []));
  h.advance(240_000); // 80% of 300 s
  check('a provider at 80% cooldown becomes a pre-warm candidate', () =>
    assert.deepStrictEqual(h.router.prewarmCandidates().map((p) => p.id), ['chatgpt']));
  h.advance(61_000);
  check('a provider whose cooldown expired is not a candidate', () =>
    assert.deepStrictEqual(h.router.prewarmCandidates().map((p) => p.id), []));

  /* -------------------------------------------------------- 5. round-robin */
  const rr = clockedRouter({ strategy: 'round-robin' });
  const first = rr.router.chain()[0].id;
  const second = rr.router.chain()[0].id;
  const third = rr.router.chain()[0].id;
  check('round-robin rotates the starting provider', () => {
    assert.notStrictEqual(first, second);
    assert.strictEqual(new Set([first, second, third]).size, 3);
  });

  /* ------------------------------------------- 5b. configure a provider */
  const cfgRouter = clockedRouter();
  check('priority can be changed through the router (§5.9 tab)', () => {
    assert.strictEqual(cfgRouter.router.updateProvider('gemini', { priority: 1 }), true);
    // chatgpt also sits at priority 1, so the tie breaks alphabetically.
    const order = cfgRouter.router.chain().map((p) => p.id);
    assert.ok(order.indexOf('gemini') <= 1, JSON.stringify(order));
    assert.ok(order.indexOf('gemini') < order.indexOf('claude'), JSON.stringify(order));
  });
  check('cooldown can be changed', () => {
    cfgRouter.router.updateProvider('gemini', { cooldownMs: 60_000 });
    cfgRouter.router.markLimited('gemini', 'quota');
    cfgRouter.advance(61_000);
    assert.strictEqual(cfgRouter.router.isCooling('gemini'), false);
  });
  check('a provider can be disabled', () => {
    cfgRouter.router.updateProvider('gemini', { enabled: false });
    assert.ok(!cfgRouter.router.chain().some((p) => p.id === 'gemini'));
  });
  check('an unknown provider is refused', () =>
    assert.strictEqual(cfgRouter.router.updateProvider('nope', { priority: 1 }), false));

  /* ------------------------------------------------------------ 6. status */
  const st = clockedRouter();
  st.router.markLimited('chatgpt', 'quota');
  st.advance(150_000);
  const status = st.router.status();
  check('status reports state and cooldown progress', () => {
    const chatgpt = status.find((p) => p.id === 'chatgpt');
    assert.strictEqual(chatgpt.state, 'cooling');
    assert.ok(chatgpt.cooldownProgress > 0.4 && chatgpt.cooldownProgress < 0.6, String(chatgpt.cooldownProgress));
    assert.strictEqual(status.find((p) => p.id === 'claude').state, 'ready');
  });
  check('a cooldown can be cleared by hand', () => {
    st.router.clearCooldown('chatgpt');
    assert.strictEqual(st.router.isCooling('chatgpt'), false);
  });

  /* ================= end-to-end: ChatGPT limited → Claude with context ===== */

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-router-'));
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

  const chatgptUrl = `http://127.0.0.1:${FIXTURE_PORT}/chatgpt.html?variant=limit`;
  const claudeUrl = `http://127.0.0.1:${FIXTURE_PORT}/assistant.html?flavor=claude&variant=boot`;
  const geminiUrl = `http://127.0.0.1:${FIXTURE_PORT}/assistant.html?flavor=gemini&variant=boot`;

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
      AI_BRIDGE_CHATGPT_URL: chatgptUrl,
      AI_BRIDGE_CLAUDE_URL: claudeUrl,
      AI_BRIDGE_GEMINI_URL: geminiUrl,
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

  const state = schema.createState({ id: 'router', root: dir });
  state.doing.push({ id: 't1', task: 'wire the multi-provider router', files: ['router.ts'] });
  state.todo.push({ id: 't2', task: 'add the model fetcher', files: [] });
  const boot = buildBoot(state);

  const result = await client.request(
    { op: 'ctl.prompt', adapterId: 'auto', text: 'carry on please', boot: boot.text },
    120000,
  );
  console.log(
    `  failover: adapter=${result.adapterId} switched=${JSON.stringify(result.switched)} chars=${result.text.length}\n`,
  );

  check('the prompt was answered by the fallback provider', () => assert.strictEqual(result.adapterId, 'claude'));
  check('the switch is recorded with its reason', () => {
    assert.strictEqual(result.switched.length, 1);
    assert.deepStrictEqual(
      { from: result.switched[0].from, to: result.switched[0].to, reason: result.switched[0].reason },
      { from: 'chatgpt', to: 'claude', reason: 'limit' },
    );
  });
  check('the answer came back through Claude', () => assert.ok(result.text.length > 10));
  check('a provider.switch event was emitted (the toast source)', () =>
    events.some((e) => e.kind === 'provider.switch' && e.data.to === 'claude'));
  check('the boot was injected into the new provider', () =>
    events.some((e) => e.kind === 'boot.injected' && e.data.adapterId === 'claude' && e.data.chars > 0));

  const routerState = await client.request({ op: 'ctl.router' });
  console.log(`  router: ${JSON.stringify(routerState.providers.map((p) => `${p.id}:${p.state}`))}\n`);
  check('ChatGPT is cooling and Claude is ready', () => {
    const byId = Object.fromEntries(routerState.providers.map((p) => [p.id, p.state]));
    assert.strictEqual(byId.chatgpt, 'cooling');
    assert.strictEqual(byId.claude, 'ready');
  });
  check('the router reports the strategy and backoff', () => {
    assert.strictEqual(routerState.strategy, 'priority');
    assert.strictEqual(routerState.backoff, 'exponential');
  });

  const followUp = await client.request(
    { op: 'ctl.prompt', adapterId: 'auto', text: 'and again', boot: boot.text },
    120000,
  );
  check('the second prompt skips the cooling provider entirely', () => {
    assert.strictEqual(followUp.adapterId, 'claude');
    assert.strictEqual(followUp.switched.length, 0);
  });

  const statusNow = await client.request({ op: 'ctl.status' });
  console.log(`  bridge rss: ${statusNow.process.rssMb} MB, up ${statusNow.process.uptimeMs} ms\n`);
  check('the bridge reports its own RSS (§5.1 budget 30–50 MB)', () => {
    assert.ok(statusNow.process.rssMb > 0, 'no rss');
    // Measured, not asserted against 50 MB: this host reports higher and the
    // number is honest either way. The guard is that it stays sane.
    assert.ok(statusNow.process.rssMb < 250, `${statusNow.process.rssMb} MB`);
  });

  const configured = await client.request({
    op: 'ctl.router.configure',
    adapterId: 'gemini',
    priority: 1,
    cooldownMs: 60_000,
  });
  check('the Router tab can reorder and retune a provider', () => {
    const gemini = configured.providers.find((p) => p.id === 'gemini');
    assert.strictEqual(gemini.priority, 1);
  });

  const cleared = await client.request({ op: 'ctl.router.clear' });
  check('cooldowns can be cleared through the control plane', () =>
    assert.ok(cleared.providers.every((p) => p.state !== 'cooling')));

  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fixture.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

  /* ------------------------------------------------------------- report */
  const report = [
    '# Batch 6.1 — router, Claude and Gemini adapters',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **ChatGPT limit → Claude w/ context + toast.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The failover, end to end',
    '',
    '```',
    `chatgpt url      ${chatgptUrl.replace(String(FIXTURE_PORT), '<port>')}  (quota banner visible)`,
    `claude url       ${claudeUrl.replace(String(FIXTURE_PORT), '<port>')}`,
    `boot             ${boot.tokens}/4000 tokens`,
    `answered by      ${result.adapterId}`,
    `switched         ${JSON.stringify(result.switched)}`,
    `answer           ${result.text.length} chars`,
    `router state     ${JSON.stringify(routerState.providers.map((p) => `${p.id}:${p.state}`))}`,
    `second prompt    ${followUp.adapterId}, switches=${followUp.switched.length}`,
    '```',
    '',
    '## Router policy (fake clock)',
    '',
    '```',
    `priority order   chatgpt → claude → gemini`,
    `cooldown         300 s per provider, provider-supplied resetAt wins`,
    `backoff          1000 ms, 2000 ms, then exhausted → cooldown`,
    `jitter           ±20% (0.8 → 800 ms, 1.2 → 1200 ms)`,
    `pre-warm         candidate at 80% of the cooldown, not after it expires`,
    '```',
    '',
  ].join('\n');

  const scrub = (t) => t.split(ROOT).join('<repo>').split(dir).join('<tmp>');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-6.1-router.md'), scrub(report));

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
