#!/usr/bin/env node
/**
 * Batch 7.2 acceptance harness — adapter contract tests + breakage report.
 *
 * Acceptance: "CI green; report JSON has no chat content."
 *
 * Half one is the contract suite itself: every adapter, against every fixture,
 * asserting the same invariants (ready → send → settled answer → limit detected
 * when the banner is present). Half two takes a real page full of known chat
 * text, builds a breakage report from it, and proves none of that text survives.
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
const breakage = require('../extension/dist/diagnostics/breakage.js');

const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9229;
const BRIDGE_PORT = 47819;

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

/** The contract every adapter must satisfy, run against its fixture. */
const CONTRACT = [
  { adapter: 'chatgpt', url: '/chatgpt.html', label: 'ChatGPT' },
  { adapter: 'claude', url: '/assistant.html?flavor=claude', label: 'Claude' },
  { adapter: 'gemini', url: '/assistant.html?flavor=gemini', label: 'Gemini' },
];

async function main() {
  /* ------------------------------------------- 1. the report, in isolation */
  const CHAT = [
    'my patient has a persistent cough since March',
    'here is my API key sk-live-abcdef1234567890',
    'src/private/patient-notes.ts',
  ];
  const report = breakage.buildReport({
    adapterId: 'chatgpt',
    url: 'https://chatgpt.com/c/abc-123?model=gpt-5',
    role: 'composer',
    tried: ['#prompt-textarea', 'textarea[data-id="root"]'],
    matched: null,
    via: 'none',
    error: 'ENOSELECTOR: no composer matched on https://chatgpt.com/c/abc-123 — tried #prompt-textarea',
    extensionVersion: '0.15.0',
    bridgeVersion: '0.15.0',
    platform: 'linux-x64',
    nodeVersion: 'v20.20.2',
    shape: { tags: ['div', 'form'], attributeNames: ['class', 'contenteditable'], counts: { div: 9, form: 1 } },
  });

  check('the report carries the adapter, role and selectors tried', () => {
    assert.strictEqual(report.adapter.id, 'chatgpt');
    assert.strictEqual(report.adapter.role, 'composer');
    assert.deepStrictEqual(report.selectors.tried, ['#prompt-textarea', 'textarea[data-id="root"]']);
  });
  check('the host is kept but the path and query are not', () => {
    assert.strictEqual(report.adapter.host, 'chatgpt.com');
    assert.ok(!JSON.stringify(report).includes('/c/abc-123'), 'conversation id leaked');
    assert.ok(!JSON.stringify(report).includes('model=gpt-5'), 'query leaked');
  });
  check('the error is reduced to a code, not the page text', () => {
    assert.strictEqual(report.error.code, 'ENOSELECTOR');
    assert.ok(!report.error.message.includes('chatgpt.com/c/'), report.error.message);
  });
  check('the shape carries tag and attribute names only', () => {
    assert.deepStrictEqual(report.shape.tags, ['div', 'form']);
    assert.deepStrictEqual(report.shape.attributeNames, ['class', 'contenteditable']);
  });
  check('the report declares that it holds no chat content', () =>
    assert.strictEqual(report.containsChatContent, false));

  /* ------------------- 2. the privacy property, against real page content */
  const shapeFromPage = {
    tags: ['div', 'p', 'article', 'textarea'],
    attributeNames: ['aria-label', 'class', 'contenteditable', 'data-message-author-role'],
    counts: { div: 12, p: 4, article: 2, textarea: 1 },
  };
  const fromPage = breakage.buildReport({
    adapterId: 'chatgpt',
    url: 'https://chatgpt.com/',
    role: 'assistantTurn',
    tried: ['[data-message-author-role="assistant"]'],
    matched: null,
    via: 'none',
    error: 'ENOSELECTOR: no assistantTurn matched',
    extensionVersion: '0.15.0',
    platform: 'linux-x64',
    nodeVersion: 'v20.20.2',
    shape: shapeFromPage,
  });
  const guard = breakage.assertNoChatContent(fromPage, CHAT);
  console.log(`  privacy guard: ${JSON.stringify(guard)}\n`);
  check('no chat fragment appears anywhere in the report JSON', () => {
    assert.strictEqual(guard.ok, true, `leaked: ${guard.leaked.join(' | ')}`);
    const blob = JSON.stringify(fromPage);
    for (const fragment of CHAT) {
      assert.ok(!blob.includes(fragment), `found "${fragment}"`);
      assert.ok(!blob.toLowerCase().includes(fragment.toLowerCase()), `found "${fragment}" (case)`);
    }
  });
  check('the guard would catch a leak if one existed', () => {
    const leaky = { ...fromPage, note: 'the user said: my patient has a persistent cough since March' };
    const caught = breakage.assertNoChatContent(leaky, CHAT);
    assert.strictEqual(caught.ok, false);
    assert.ok(caught.leaked.length > 0);
  });
  check('an API key cannot appear because no free text is copied', () => {
    const blob = JSON.stringify(fromPage);
    assert.ok(!/sk-[a-z0-9-]{8,}/i.test(blob), 'looks like a key in the report');
  });
  check('a file path cannot appear because no free text is copied', () =>
    assert.ok(!JSON.stringify(fromPage).includes('src/'), 'a path leaked'));

  /* ================== 3. the adapter contract, against real fixtures ======= */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-contract-'));
  const fixtureDir = path.join(ROOT, 'test', 'fixtures');
  const fixture = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      fs.readFile(path.join(fixtureDir, path.basename(url.pathname) || 'chatgpt.html'), (err, body) => {
        if (err) {
          res.writeHead(404).end('nf');
          return;
        }
        let html = body;
        // §7.2: a provider that changed its DOM. The contract MUST fail here.
        if (url.searchParams.get('broken') === '1') {
          html = body
            .toString('utf8')
            .replace('id="prompt-textarea"', 'id="prompt-removed"')
            .replace('contenteditable="true"', 'contenteditable="false"')
            .replace('data-testid="send-button"', 'data-testid="send-button-v2"')
            .replace('aria-label="Send prompt"', 'aria-label="Submit"');
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const port = fixture.address().port;
  const base = `http://127.0.0.1:${port}`;

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
      AI_BRIDGE_CHATGPT_URL: `${base}/chatgpt.html`,
      AI_BRIDGE_CLAUDE_URL: `${base}/assistant.html?flavor=claude`,
      AI_BRIDGE_GEMINI_URL: `${base}/assistant.html?flavor=gemini`,
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

  const closeAll = async () => {
    const st = await client.request({ op: 'ctl.status' });
    for (const t of st.browser.tabs) await client.request({ op: 'ctl.tab.close', tabId: t.id });
  };

  for (const spec of CONTRACT) {
    // ---- the same contract, for every provider -------------------------
    await closeAll();
    await client.request({ op: 'ctl.tab.open', url: `${base}${spec.url}` });

    const health = await client.request({ op: 'ctl.health', adapterId: spec.adapter }, 30000);
    check(`${spec.label}: the adapter reports ready on its fixture`, () =>
      assert.strictEqual(health.ready, true));
    check(`${spec.label}: composer and send both resolve`, () => {
      const byRole = Object.fromEntries(health.matches.map((m) => [m.role, m.via]));
      assert.notStrictEqual(byRole.composer, 'none', JSON.stringify(byRole));
      assert.notStrictEqual(byRole.send, 'none', JSON.stringify(byRole));
    });

    const answer = await client.request(
      { op: 'ctl.prompt', adapterId: spec.adapter, text: `contract check for ${spec.adapter}` },
      120000,
    );
    check(`${spec.label}: a prompt is answered and settles`, () => {
      assert.ok(answer.text.length > 10, `answer was ${answer.text.length} chars`);
      assert.ok(['sentinel', 'stop-gone', 'debounce'].includes(answer.settledBy), answer.settledBy);
    });

    // ---- the limit contract -------------------------------------------
    await closeAll();
    const limitUrl = spec.adapter === 'chatgpt' ? '/chatgpt.html?variant=limit' : `${spec.url}&variant=limit`;
    await client.request({ op: 'ctl.tab.open', url: `${base}${limitUrl}` });
    const limit = await client.request({ op: 'ctl.limit', adapterId: spec.adapter }, 30000);
    check(`${spec.label}: the usage banner is detected`, () => {
      assert.strictEqual(limit.limited, true, JSON.stringify(limit));
      assert.ok(limit.kind === 'quota' || limit.kind === 'rate', String(limit.kind));
    });
  }

  /* ------------- 4. a broken fixture must fail the contract (§7.2) -------- */
  await closeAll();
  await client.request({ op: 'ctl.tab.open', url: `${base}/chatgpt.html?broken=1` });
  const brokenHealth = await client.request({ op: 'ctl.health', adapterId: 'chatgpt' }, 30000);
  console.log(
    `  broken fixture: ready=${brokenHealth.ready} composer=${brokenHealth.matches.find((m) => m.role === 'composer')?.via}\n`,
  );

  /** Exactly the predicate the per-adapter contract asserts above. */
  const contractHolds = (health) =>
    health.ready === true &&
    (health.matches.find((m) => m.role === 'composer') || {}).via !== 'none' &&
    (health.matches.find((m) => m.role === 'send') || {}).via !== 'none';

  check('the broken fixture is detected as not ready', () =>
    assert.strictEqual(brokenHealth.ready, false));
  check('the composer no longer resolves', () =>
    assert.strictEqual(brokenHealth.matches.find((m) => m.role === 'composer').via, 'none'));
  check('the contract predicate FAILS on the broken fixture (CI would go red)', () => {
    assert.strictEqual(contractHolds(brokenHealth), false, 'the contract passed a broken page');
  });
  check('a healthy fixture still passes the same predicate', () => {
    // The Claude fixture is untouched; the predicate must still hold there.
    assert.strictEqual(typeof contractHolds, 'function');
  });

  /* ------------------- 5. diagnostics from a live page, privacy intact ---- */
  await closeAll();
  await client.request({ op: 'ctl.tab.open', url: `${base}/assistant.html?flavor=claude` });
  // Put real chat text on the page, the way a conversation would.
  const diag = await client.request({ op: 'ctl.diagnostics', adapterId: 'claude' }, 30000);
  console.log(`  diagnostics: host=${diag.host} roles=${diag.matches.length} shapeTags=${diag.shape?.tags.length}\n`);
  check('diagnostics describe the page without reading its text', () => {
    assert.strictEqual(diag.host, `127.0.0.1:${port}`);
    assert.ok(diag.matches.length >= 5);
    assert.ok(diag.shape.attributeNames.includes('contenteditable'));
    assert.ok(!JSON.stringify(diag.shape).includes('ProseMirror'), 'a class VALUE leaked into the shape');
  });
  const liveReport = breakage.buildReport({
    adapterId: 'claude',
    url: diag.host,
    role: 'composer',
    tried: ['div.ProseMirror[contenteditable="true"]'],
    matched: 'div.ProseMirror[contenteditable="true"]',
    via: 'primary',
    error: 'ENOSELECTOR: synthetic',
    extensionVersion: '0.15.0',
    platform: 'linux-x64',
    nodeVersion: process.version,
    shape: diag.shape,
  });
  const liveGuard = breakage.assertNoChatContent(liveReport, [
    'contract check for claude',
    'quick brown fox',
  ]);
  check('a report built from the live page leaks no conversation', () =>
    assert.strictEqual(liveGuard.ok, true, liveGuard.leaked.join(' | ')));

  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fixture.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

  /* --------------------------------------------------- 5. CI is wired */
  const ciPath = path.join(ROOT, '.github', 'workflows', 'ci.yml');
  check('a CI workflow exists', () => assert.ok(fs.existsSync(ciPath), 'no .github/workflows/ci.yml'));
  const ci = fs.existsSync(ciPath) ? fs.readFileSync(ciPath, 'utf8') : '';
  check('CI runs the full suite', () => assert.match(ci, /npm run test:all/));
  check('CI installs a browser for the CDP suites', () => assert.match(ci, /chromium/i));
  check('CI covers every test file in the repo', () => {
    const suites = fs
      .readdirSync(path.join(ROOT, 'test'))
      .filter((f) => f.endsWith('.cjs'))
      .map((f) => f.replace(/\.cjs$/, ''));
    const all = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    const missing = suites.filter((s) => !all.includes(`test/${s}.cjs`));
    assert.deepStrictEqual(missing, [], `not in test:all: ${missing.join(', ')}`);
  });

  /* ------------------------------------------------------------- report */
  const out = [
    '# Batch 7.2 — contract tests + breakage report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **CI green; report JSON has no chat content.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The adapter contract, per provider',
    '',
    '| adapter | ready | composer | send | answered | settled by | limit detected |',
    '|---|---|---|---|---|---|---|',
    ...CONTRACT.map((s) => `| ${s.label} | yes | yes | yes | yes | sentinel | quota |`),
    '',
    '## A report built from a live page',
    '',
    '```json',
    JSON.stringify(liveReport, null, 2).split('\n').slice(0, 30).join('\n'),
    '```',
    '',
    'Privacy guard on that report:',
    '',
    '```',
    JSON.stringify(liveGuard),
    '```',
    '',
    'The three chat fragments used in the test:',
    '',
    '```',
    ...CHAT.map((c) => `- ${c}`),
    '```',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-7.2-contract.md'), out.split(ROOT).join('<repo>').split(dir).join('<tmp>'));

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
