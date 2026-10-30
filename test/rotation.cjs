#!/usr/bin/env node
/**
 * Batch 5.1 acceptance harness — session rotation.
 *
 * Acceptance: "Simulated limit → context preserved, preview shown."
 *
 * Two halves. The unit half drives the rotator with fakes to pin every branch
 * (no limit, cancelled preview, edited boot, ack retry, injection error). The
 * end-to-end half uses a REAL limit: the fixture's quota banner, detected by the
 * real adapter through the real bridge, then a real rotation into a fresh page
 * whose restatement is checked against a real ProjectState.
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
const { SessionRotator } = require('../extension/dist/rotation/rotator.js');
const { buildBoot, verifyAck } = require('../extension/dist/state/boot.js');
const schema = require('../extension/dist/state/schema.js');

const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9225;
const BRIDGE_PORT = 47812;
const FIXTURE_PORT = 47813;

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

/* ------------------------------------------------------------- unit ports */

function fakePorts(overrides = {}) {
  const calls = { detect: 0, boot: 0, preview: 0, newPage: 0, inject: 0, ack: 0 };
  const injected = [];
  return {
    calls,
    injected,
    async detectLimit() {
      calls.detect += 1;
      return overrides.limit ?? { limited: true, kind: 'quota' };
    },
    async buildBoot() {
      calls.boot += 1;
      return overrides.boot ?? { text: 'BOOT', tokens: 120, budgetTokens: 4000 };
    },
    ...(overrides.noPreview
      ? {}
      : {
          async preview(boot) {
            calls.preview += 1;
            if (overrides.cancel) return null;
            return overrides.editTo ?? boot;
          },
        }),
    async newPage() {
      calls.newPage += 1;
      return { id: overrides.tabId ?? 'tab9' };
    },
    async inject(prompt) {
      calls.inject += 1;
      injected.push(prompt);
      if (overrides.injectThrows) throw new Error(overrides.injectThrows);
      return overrides.answers?.[calls.inject - 1] ?? 'DOING:\n- item';
    },
    ack() {
      calls.ack += 1;
      const ok = overrides.ackOk ?? true;
      return { ok, found: ok ? ['item'] : [], missing: ok ? [] : ['item'] };
    },
    log() {},
  };
}

async function main() {
  /* ------------------------------------------------------------ unit: happy */
  const p1 = fakePorts();
  const r1 = await new SessionRotator(p1).rotate('limit');
  console.log(`  happy: rotated=${r1.rotated} preview=${r1.previewShown} ack=${r1.ackOk} ${r1.reason}\n`);
  check('a detected limit triggers a rotation', () => assert.strictEqual(r1.rotated, true));
  check('the boot preview is shown on failover', () => {
    assert.strictEqual(r1.previewShown, true);
    assert.strictEqual(p1.calls.preview, 1);
  });
  check('a fresh page is opened', () => assert.strictEqual(p1.calls.newPage, 1));
  check('the boot is injected into the new page', () => {
    assert.strictEqual(p1.calls.inject, 1);
    assert.strictEqual(p1.injected[0], 'BOOT');
  });
  check('context is reported preserved when the chat restates it', () => {
    assert.strictEqual(r1.ackOk, true);
    assert.strictEqual(r1.contextPreserved, true);
  });
  check('the result names the new tab and the boot size', () => {
    assert.strictEqual(r1.newTabId, 'tab9');
    assert.strictEqual(r1.tokens, 120);
  });

  /* ---------------------------------------------------- unit: no limit */
  const p2 = fakePorts({ limit: { limited: false } });
  const r2 = await new SessionRotator(p2).rotate('limit');
  check('no limit means no rotation', () => {
    assert.strictEqual(r2.rotated, false);
    assert.strictEqual(p2.calls.newPage, 0);
    assert.match(r2.reason, /no limit detected/);
  });
  check('a manual rotation does not require a limit', async () => {});
  const p2b = fakePorts({ limit: { limited: false } });
  const r2b = await new SessionRotator(p2b).rotate('manual');
  check('manual rotation proceeds without a limit', () => assert.strictEqual(r2b.rotated, true));

  /* ------------------------------------------------- unit: preview cancel */
  const p3 = fakePorts({ cancel: true });
  const r3 = await new SessionRotator(p3).rotate('limit');
  check('cancelling the preview keeps the page and injects nothing', () => {
    assert.strictEqual(r3.rotated, false);
    assert.strictEqual(r3.previewShown, true);
    assert.strictEqual(p3.calls.newPage, 0);
    assert.strictEqual(p3.calls.inject, 0);
    assert.match(r3.reason, /cancelled/);
  });

  /* ---------------------------------------------------- unit: edited boot */
  const p4 = fakePorts({ editTo: 'EDITED BOOT' });
  const r4 = await new SessionRotator(p4).rotate('limit');
  check('an edited boot is what gets injected', () => {
    assert.strictEqual(r4.edited, true);
    assert.strictEqual(p4.injected[0], 'EDITED BOOT');
  });

  /* ------------------------------------------- unit: preview can be skipped */
  const p5 = fakePorts({ noPreview: true });
  const r5 = await new SessionRotator(p5).rotate('limit');
  check('the preview can be turned off', () => {
    assert.strictEqual(r5.previewShown, false);
    assert.strictEqual(r5.rotated, true);
  });

  /* ------------------------------------------------- unit: ack retry */
  const p6 = fakePorts({ ackOk: false });
  const r6 = await new SessionRotator(p6, { maxRetries: 1 }).rotate('limit');
  check('a chat that does not restate is retried once', () => {
    assert.strictEqual(p6.calls.inject, 2);
    assert.strictEqual(r6.attempts, 2);
  });
  check('the retry prompt carries the stricter preamble', () =>
    assert.match(p6.injected[1], /did not restate the project state/));
  check('failure to restate is reported honestly', () => {
    assert.strictEqual(r6.rotated, true);
    assert.strictEqual(r6.ackOk, false);
    assert.strictEqual(r6.contextPreserved, false);
    assert.ok(r6.missing.length > 0);
  });

  /* ------------------------------------------------ unit: injection error */
  const p7 = fakePorts({ injectThrows: 'page crashed' });
  const r7 = await new SessionRotator(p7, { maxRetries: 0 }).rotate('limit');
  check('an injection error is reported, not swallowed', () => {
    assert.strictEqual(r7.rotated, true);
    assert.match(r7.reason, /page crashed/);
    assert.strictEqual(r7.contextPreserved, false);
  });

  /* ------------------------------------------------ unit: empty boot */
  const p8 = fakePorts({ boot: { text: '   ', tokens: 0, budgetTokens: 4000 } });
  const r8 = await new SessionRotator(p8).rotate('limit');
  check('an empty boot stops the rotation before touching the page', () => {
    assert.strictEqual(r8.rotated, false);
    assert.strictEqual(p8.calls.newPage, 0);
  });

  /* ============================ end-to-end: a real limit, a real rotation ==== */

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-rotation-'));
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
  const baseUrl = `http://127.0.0.1:${FIXTURE_PORT}/chatgpt.html`;

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
      AI_BRIDGE_CHATGPT_URL: baseUrl,
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

  const closeAllTabs = async () => {
    const status = await client.request({ op: 'ctl.status' });
    for (const tab of status.browser.tabs) await client.request({ op: 'ctl.tab.close', tabId: tab.id });
  };

  // A state with real DOING/TODO so "context preserved" means something.
  const state = schema.createState({ id: 'rot', root: dir });
  state.doing.push({ id: 't1', task: 'finish the rotation flow', files: ['src/rotation.ts'] });
  state.todo.push({ id: 't2', task: 'wire the manual rotate command', files: [] });
  state.decisions.push({ id: 'd1', what: 'never rotate on a hunch', why: 'test', locked: true });
  const deltasBefore = state.deltas.length;

  await closeAllTabs();
  const limitTab = await client.request({ op: 'ctl.tab.open', url: `${baseUrl}?variant=limit` });

  const limit = await client.request({ op: 'ctl.limit', adapterId: 'chatgpt' });
  console.log(`  e2e limit probe: ${JSON.stringify(limit)}\n`);
  check('the real adapter detects the quota banner', () => {
    assert.strictEqual(limit.limited, true);
    assert.strictEqual(limit.kind, 'quota');
  });

  const promptErr = await client
    .request({ op: 'ctl.prompt', adapterId: 'chatgpt', text: 'does this send?' }, 30000)
    .then(
      () => null,
      (err) => err.message,
    );
  check('a prompt is refused while limited', () => assert.match(String(promptErr), /ELIMIT/));

  const boot = buildBoot(state);
  const rotator = new SessionRotator(
    {
      detectLimit: async () => client.request({ op: 'ctl.limit', adapterId: 'chatgpt' }),
      buildBoot: async () => ({ text: boot.text, tokens: boot.tokens, budgetTokens: boot.budgetTokens }),
      // The extension shows an editable document; here we accept it unchanged.
      preview: async (text) => text,
      newPage: async () => {
        await closeAllTabs();
        // The fresh session: a new chat page, no quota banner.
        const tab = await client.request({ op: 'ctl.tab.open', url: `${baseUrl}?variant=boot` });
        return { id: tab.id };
      },
      inject: async (text) => {
        const res = await client.request({ op: 'ctl.prompt', adapterId: 'chatgpt', text }, 90000);
        return res.text;
      },
      ack: (answer) => verifyAck(state, answer),
      log: () => {},
    },
    { maxRetries: 1 },
  );

  const rotation = await rotator.rotate('limit');
  console.log(
    `  e2e rotation: rotated=${rotation.rotated} preview=${rotation.previewShown} ack=${rotation.ackOk} tab=${rotation.newTabId} ${rotation.tookMs} ms\n`,
  );

  check('the rotation ran against the real limit', () => assert.strictEqual(rotation.rotated, true));
  check('the boot preview was shown', () => assert.strictEqual(rotation.previewShown, true));
  check('a different page was opened', () => {
    assert.ok(rotation.newTabId, 'no new tab');
    assert.notStrictEqual(rotation.newTabId, limitTab.id);
  });
  check('the fresh chat restated the state (context preserved)', () => {
    assert.strictEqual(rotation.ackOk, true, `missing: ${rotation.missing.join(' | ')}`);
    assert.strictEqual(rotation.contextPreserved, true);
  });
  check('the boot stayed inside the 4k budget', () =>
    assert.ok(rotation.tokens <= 4000, `${rotation.tokens}`));
  check('rotation did not disturb the project state', () =>
    assert.strictEqual(state.deltas.length, deltasBefore));

  // The new session must actually be usable — that is the point of rotating.
  const followUp = await client.request(
    { op: 'ctl.prompt', adapterId: 'chatgpt', text: 'continue please' },
    90000,
  );
  check('the rotated session accepts new prompts', () => assert.ok(followUp.text.length > 10));

  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fixture.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

  /* ------------------------------------------------------------- report */
  const report = [
    '# Batch 5.1 — session rotation',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **Simulated limit → context preserved, preview shown.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The end-to-end rotation',
    '',
    '```',
    `limit probe      ${JSON.stringify(limit)}`,
    `prompt while limited → ${promptErr}`,
    `boot             ${rotation.tokens}/4000 tokens`,
    `preview shown    ${rotation.previewShown}`,
    `new tab          ${rotation.newTabId} (was ${limitTab.id})`,
    `ack              ok=${rotation.ackOk}, missing=${rotation.missing.length}`,
    `context preserved ${rotation.contextPreserved}`,
    `state deltas     ${state.deltas.length} (unchanged: ${state.deltas.length === deltasBefore})`,
    `follow-up prompt ${followUp.text.length} chars`,
    '```',
    '',
    '## The boot that carried the context',
    '',
    '```',
    boot.text,
    '```',
    '',
  ].join('\n');

  const scrub = (t) => t.split(ROOT).join('<repo>').split(dir).join('<tmp>');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-5.1-rotation.md'), scrub(report));

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
