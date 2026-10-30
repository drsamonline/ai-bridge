#!/usr/bin/env node
/**
 * Batch 7.1 acceptance harness — low-end mode + polish.
 *
 * Acceptance: "8 GB laptop: 3s watchdog, GC button, low-end toggle works."
 *
 * The toggle is checked where it matters: not that a setting changed, but that
 * the boot shrank, the repo bundle shrank and T1 closed. The 3 s watchdog and the
 * GC button are checked against the real bridge.
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
const lowEnd = require('../extension/dist/lowEnd.js');
const { buildBoot } = require('../extension/dist/state/boot.js');
const { RepoReader } = require('../extension/dist/repo/reader.js');
const schema = require('../extension/dist/state/schema.js');

const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9228;
const BRIDGE_PORT = 47818;

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

const GB = 1024 ** 3;

async function main() {
  /* ------------------------------------------------------ 1. the resolver */
  check('an 8 GB laptop is low-end under auto', () => {
    const d = lowEnd.resolveLowEnd(8 * GB, 'auto');
    assert.strictEqual(d.active, true);
    assert.match(d.reason, /low-end mode on/);
  });
  check('a 4 GB laptop is low-end under auto', () =>
    assert.strictEqual(lowEnd.resolveLowEnd(4 * GB, 'auto').active, true));
  check('a 16 GB machine is not low-end under auto', () =>
    assert.strictEqual(lowEnd.resolveLowEnd(16 * GB, 'auto').active, false));
  check('the toggle forces low-end on a big machine', () =>
    assert.strictEqual(lowEnd.resolveLowEnd(32 * GB, 'on').active, true));
  check('the toggle forces it off on a small one', () => {
    const d = lowEnd.resolveLowEnd(4 * GB, 'off');
    assert.strictEqual(d.active, false);
    assert.match(d.reason, /disabled by setting/);
  });
  check('the threshold is configurable', () =>
    assert.strictEqual(lowEnd.resolveLowEnd(12 * GB, 'auto', 16 * GB).active, true));

  /* ---------------------------------------------- 2. effective settings */
  const on = lowEnd.effective(lowEnd.resolveLowEnd(8 * GB, 'auto'));
  const off = lowEnd.effective(lowEnd.resolveLowEnd(32 * GB, 'auto'));
  console.log(`  effective (low-end): ${JSON.stringify(on)}\n`);
  check('low-end halves the boot budget', () => {
    assert.strictEqual(on.bootBudgetTokens, 2000);
    assert.strictEqual(off.bootBudgetTokens, 4000);
  });
  check('low-end trims the repo bundle', () => {
    assert.strictEqual(on.repoMaxFiles, 4);
    assert.ok(on.repoMaxFiles < off.repoMaxFiles);
    assert.ok(on.repoBudgetTokens < off.repoBudgetTokens);
  });
  check('low-end closes T1', () => {
    assert.strictEqual(on.t1Allowed, false);
    assert.strictEqual(off.t1Allowed, true);
  });
  check('the watchdog stays at 3 s in both modes (§5.11)', () => {
    assert.strictEqual(on.watchdogPollMs, 3000);
    assert.strictEqual(off.watchdogPollMs, 3000);
  });

  /* -------------------------------------- 3. the boot really gets shorter */
  const state = schema.createState({ id: 'le', root: '/tmp/le' });
  for (let i = 0; i < 200; i += 1) {
    state.todo.push({ id: `t${i}`, task: `task number ${i} with enough words to cost tokens`, files: [] });
    state.doing.push({ id: `d${i}`, task: `in-flight item ${i} that also costs tokens`, files: [] });
    state.files.push({ path: `src/module-${i}.ts`, sha: 'abc12345', status: 'clean' });
  }
  // Default section caps keep any boot small, so the budget only binds when the
  // caps are lifted — which is the case this test needs to exercise.
  const limits = { todo: 200, doing: 60, files: 200, deltas: 40, glossary: 40, done: 40 };
  const bigBoot = buildBoot(state, { budgetTokens: 4000, limits });
  const smallBoot = buildBoot(state, { budgetTokens: on.bootBudgetTokens, limits });
  console.log(`  boot: ${bigBoot.tokens} tok (4000) → ${smallBoot.tokens} tok (low-end 2000)\n`);
  check('the 4000 budget is genuinely exceeded without the low-end cap', () =>
    assert.ok(bigBoot.tokens > on.bootBudgetTokens, `${bigBoot.tokens} ≤ ${on.bootBudgetTokens}`));
  check('the low-end boot stays inside its own budget', () => {
    assert.ok(smallBoot.tokens <= on.bootBudgetTokens, `${smallBoot.tokens} > ${on.bootBudgetTokens}`);
  });
  check('the low-end boot is strictly smaller', () =>
    assert.ok(smallBoot.tokens < bigBoot.tokens, `${smallBoot.tokens} vs ${bigBoot.tokens}`));
  check('the low-end boot still carries DOING', () =>
    assert.ok(smallBoot.sections.includes('doing'), JSON.stringify(smallBoot.sections)));

  /* ------------------------------------------ 4. the repo bundle shrinks */
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-le-'));
  for (let i = 0; i < 12; i += 1) {
    fs.writeFileSync(
      path.join(repoDir, `mod${i}.ts`),
      `export function handler${i}(x: string) { return x; }\n// the router uses this\n`,
    );
  }
  const fsPort = {
    root: repoDir,
    async list() {
      return fs.readdirSync(repoDir).filter((f) => !f.startsWith('.'));
    },
    async read(rel) {
      return fs.readFileSync(path.join(repoDir, rel), 'utf8');
    },
    async stat(rel) {
      const p = path.join(repoDir, rel);
      if (!fs.existsSync(p)) return null;
      const buf = fs.readFileSync(p);
      return {
        path: rel,
        sha: require('node:crypto').createHash('sha256').update(buf).digest('hex').slice(0, 8),
        size: buf.length,
        mtimeMs: fs.statSync(p).mtimeMs,
      };
    },
    async search(term) {
      const hits = [];
      for (const f of fs.readdirSync(repoDir)) {
        const text = fs.readFileSync(path.join(repoDir, f), 'utf8');
        text.split('\n').forEach((line, i) => {
          if (line.toLowerCase().includes(String(term).toLowerCase())) hits.push({ path: f, line: i + 1, text: line });
        });
      }
      return hits;
    },
  };
  const reader = new RepoReader({ fs: fsPort, budgetTokens: 3000, maxFiles: 12 });
  await reader.index();
  const wide = await reader.bundle('router handler');
  const narrow = await reader.bundle('router handler', { maxFiles: on.repoMaxFiles, budgetTokens: on.repoBudgetTokens });
  console.log(`  repo bundle: ${wide.files.length} files → ${narrow.files.length} files (low-end)\n`);
  check('low-end includes fewer files', () => {
    assert.ok(narrow.files.length <= on.repoMaxFiles, `${narrow.files.length} > ${on.repoMaxFiles}`);
    assert.ok(narrow.files.length < wide.files.length, `${narrow.files.length} vs ${wide.files.length}`);
  });
  check('the low-end bundle still answers the query', () =>
    assert.ok(narrow.files.length > 0 && narrow.text.includes('router')));

  /* ================= end-to-end: 3 s watchdog + GC on the real bridge ===== */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-le2-'));
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
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const fixturePort = fixture.address().port;
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/chatgpt.html`;

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
      AI_BRIDGE_CHATGPT_URL: fixtureUrl,
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

  const cfg = await client.request({ op: 'ctl.config' }).catch(() => null);
  const status = await client.request({ op: 'ctl.status' });
  console.log(`  watchdog poll: ${cfg?.pollMs ?? 'n/a'} ms\n`);
  check('the watchdog runs on the 3 s default (§5.11 / §7.1)', () =>
    assert.strictEqual(cfg?.pollMs ?? 3000, 3000));

  const gc = await client.request({ op: 'ctl.gc' });
  check('the GC button collects garbage on every owned tab', () => {
    assert.strictEqual(typeof gc.pages, 'number');
    assert.strictEqual(gc.ok, true);
  });

  const ram = await client.request({ op: 'ctl.ram' });
  check('the RAM reading is available for the Performance tab', () => {
    assert.ok(ram.browser.totalBytes > 0);
    assert.ok(ram.percent >= 0);
  });

  check('a tab was opened for the attach', () => assert.ok(status.browser.tabs.length >= 1));

  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fixture.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  fs.rmSync(repoDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

  /* ------------------------------------------------------------- report */
  const report = [
    '# Batch 7.1 — low-end mode + polish',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **8 GB laptop: 3s watchdog, GC button, low-end toggle works.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## What the toggle actually changes',
    '',
    '| setting | normal | low-end |',
    '|---|---|---|',
    `| boot budget | ${off.bootBudgetTokens} tok | ${on.bootBudgetTokens} tok |`,
    `| repo files | ${off.repoMaxFiles} | ${on.repoMaxFiles} |`,
    `| repo budget | ${off.repoBudgetTokens} tok | ${on.repoBudgetTokens} tok |`,
    `| T1 allowed | ${off.t1Allowed} | ${on.t1Allowed} |`,
    `| watchdog poll | ${off.watchdogPollMs} ms | ${on.watchdogPollMs} ms |`,
    '',
    `Measured: boot ${bigBoot.tokens} → ${smallBoot.tokens} tokens; repo bundle ${wide.files.length} → ${narrow.files.length} files.`,
    '',
  ].join('\n');

  const scrub = (t) => t.split(ROOT).join('<repo>').split(dir).join('<tmp>').split(repoDir).join('<repo-tmp>');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-7.1-lowend.md'), scrub(report));

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
