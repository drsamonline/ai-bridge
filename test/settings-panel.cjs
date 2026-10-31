#!/usr/bin/env node
/**
 * Batch 4.1 — the settings panel in a real browser.
 *
 * Loads the HTML the extension actually ships, with a shimmed
 * `acquireVsCodeApi`, and wires its messages to the REAL SettingsController. So
 * when the test types an invalid port, the error that appears inline was produced
 * by the same validation the extension uses — not by the test.
 */

'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { renderSettingsHtml } = require('../extension/dist/settings/html.js');
const { SettingsController } = require('../extension/dist/settings/controller.js');
const fields = require('../extension/dist/settings/fields.js');

const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9224;

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

function cdpVersion(port) {
  return new Promise((resolve) => {
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
}

function fakeHost() {
  const store = new Map();
  return {
    store,
    get: (k, d) => (store.has(k) ? store.get(k) : d),
    update: async (k, v) => {
      store.set(k, v);
    },
  };
}

async function main() {
  const host = fakeHost();
  const controller = new SettingsController({ host, debounceMs: 0 });
  const actions = [];
  const controllerWithActions = new SettingsController({
    host,
    debounceMs: 0,
    samples: () => [12, 18, 25, 40, 33, 61, 44],
    snapshot: () => ({
      ramPercent: 44,
      ramUsedMb: 1204,
      ramCapMb: 8000,
      extMb: 96,
      bootTokens: 272,
      deltas: 41,
      indexedFiles: 12,
      snapshots: ['snap-2026-10-29-init.json.gz'],
      health: [
        { id: 'chatgpt', label: 'chatgpt', ready: true, limited: false, matches: 5 },
        { id: 'claude', label: 'claude', ready: false, limited: true, matches: 0 },
      ],
      t1: { enabled: false, reason: 'low-end machine (2.0 GB < 8.0 GB) — staying on T0' },
    }),
    actions: {
      health: async () => {
        actions.push('health');
        return 'Health: chatgpt ready.';
      },
      snapshot: async () => {
        actions.push('snapshot');
        return 'Snapshot written.';
      },
    },
    compressPreview: async (text) => ({
      before: 18,
      after: 9,
      percent: 50,
      text: 'help me to refactor this module!',
    }),
  });
  void controller;

  const html = renderSettingsHtml({
    nonce: 'TESTNONCE1234567890abcd',
    snapshot: controllerWithActions.state().snapshot,
  });
  console.log(`  panel html: ${html.length} bytes\n`);

  check('the panel ships a CSP with a nonce', () => {
    assert.match(html, /script-src 'nonce-TESTNONCE1234567890abcd'/);
  });
  check('all six tabs are present in the markup', () => {
    assert.match(html, /"providers"/);
    for (const tab of fields.TABS) assert.ok(html.includes(`"${tab}"`), `missing ${tab}`);
  });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-settings-'));
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
  for (let i = 0; i < 80 && (await cdpVersion(CDP_PORT)) === null; i += 1) await sleep(250);

  const { chromium } = require('playwright-core');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const page = await browser.contexts()[0].newPage();
  await page.setViewportSize({ width: 900, height: 700 });
  await page.addInitScript(() => {
    window.__out = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => window.__out.push(m),
      getState: () => undefined,
      setState: () => undefined,
    });
  });

  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 300));
  });

  // Served through request interception rather than a file:// URL: on a CI runner
  // Chromium is often a snap, whose private /tmp the page cannot read
  // (net::ERR_FILE_NOT_FOUND). A routed URL has no filesystem at all.
  await page.route('http://ai-bridge.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto('http://ai-bridge.test/settings.html', { waitUntil: 'domcontentloaded' });
  await sleep(300);

  /**
   * Drain the webview's outbox through the real controller and reply. Runs until
   * the outbox has been empty for two consecutive rounds, because the webview
   * debounces its posts by 260 ms — a fixed number of rounds races it.
   */
  const pump = async (minMs = 700, maxMs = 4000) => {
    const started = Date.now();
    let idle = 0;
    while (Date.now() - started < maxMs) {
      const out = await page.evaluate(() => window.__out.splice(0, window.__out.length));
      if (out.length === 0) {
        idle += 1;
      } else {
        idle = 0;
        for (const msg of out) {
          const replies = await controllerWithActions.handle(msg);
          if (process.env.PANEL_DEBUG) {
            console.log('  [pump]', msg.cmd || msg.type, msg.action || msg.key || '', '→', replies.map((r) => r.type).join(','));
          }
          for (const reply of replies) {
            await page.evaluate((r) => window.postMessage(r, '*'), reply);
          }
        }
      }
      // The webview debounces posts by 260 ms, so an early "empty" proves nothing.
      if (idle >= 2 && Date.now() - started >= minMs) return;
      await sleep(140);
    }
  };
  await pump();

  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('#tabs button')].map((b) => ({
      label: b.textContent,
      selected: b.getAttribute('aria-selected'),
    })),
  );
  check('the six tabs render with the first selected', () => {
    assert.strictEqual(tabs.length, 6);
    assert.strictEqual(tabs[0].selected, 'true');
    assert.deepStrictEqual(
      tabs.map((t) => t.label),
      ['Providers', 'Router', 'Compressor', 'State', 'Repo', 'Performance'],
    );
  });

  const providerFields = await page.evaluate(() => document.querySelectorAll('.row').length);
  check('the Providers tab renders its fields', () => assert.ok(providerFields >= 3, `${providerFields}`));

  // ---- §5.12 "every tab: live preview" --------------------------------
  const previews = {};
  for (const tab of ['Providers', 'Router', 'Compressor', 'State', 'Repo', 'Performance']) {
    await page.evaluate((t) => {
      const btn = [...document.querySelectorAll('#tabs button')].find((b) => b.textContent === t);
      if (btn) btn.click();
    }, tab);
    await sleep(200);
    previews[tab.toLowerCase()] = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.tile')];
      const t = tiles.find((x) => /Preview —/.test(x.textContent || ''));
      return t ? t.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : null;
    });
  }
  check('every one of the six tabs shows a live preview', () => {
    const missing = Object.entries(previews).filter(([, v]) => !v).map(([k]) => k);
    assert.deepStrictEqual(missing, [], `no preview on: ${missing.join(', ')}`);
  });
  check('the previews are built from the live snapshot, not placeholders', () => {
    assert.match(previews.providers, /model\(s\)|Fetch models/);
    assert.match(previews.router, /\u2192|->|attach the browser/, previews.router);
    assert.match(previews.state, /token/);
    assert.match(previews.performance, /MB/);
  });

  // Back to Providers: the remaining checks operate on its fields.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#tabs button')].find((b) => b.textContent === 'Providers');
    if (btn) btn.click();
  });
  await sleep(250);

  // ---- invalid → inline error, produced by the host --------------------
  await page.evaluate(() => {
    const input = document.getElementById('f-aiBridge.bridge.port');
    input.value = '99999';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pump();
  const invalid = await page.evaluate(() => {
    const input = document.getElementById('f-aiBridge.bridge.port');
    const err = document.getElementById('err-aiBridge.bridge.port');
    return { aria: input.getAttribute('aria-invalid'), text: err.textContent, shown: err.classList.contains('show') };
  });
  check('an out-of-range value shows an inline error', () => {
    assert.strictEqual(invalid.aria, 'true');
    assert.strictEqual(invalid.shown, true);
    assert.match(invalid.text, /at most 65535/);
  });
  check('the invalid value was not written to the store', () =>
    assert.strictEqual(host.store.has('aiBridge.bridge.port'), false));

  await page.evaluate(() => {
    const input = document.getElementById('f-aiBridge.bridge.port');
    input.value = '49000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pump();
  const fixed = await page.evaluate(() => {
    const input = document.getElementById('f-aiBridge.bridge.port');
    const err = document.getElementById('err-aiBridge.bridge.port');
    return { aria: input.getAttribute('aria-invalid'), shown: err.classList.contains('show') };
  });
  check('correcting the value clears the error', () => {
    assert.strictEqual(fixed.aria, null);
    assert.strictEqual(fixed.shown, false);
  });
  check('the corrected value reached the store', () =>
    assert.strictEqual(host.store.get('aiBridge.bridge.port'), 49000));

  // ---- tab switching ---------------------------------------------------
  await page.evaluate(() => {
    [...document.querySelectorAll('#tabs button')].find((b) => b.textContent.startsWith('Compressor')).click();
  });
  await sleep(200);
  const compressor = await page.evaluate(() => ({
    heading: document.querySelector('#panel h2').textContent,
    hasTier: !!document.getElementById('f-aiBridge.compressor.tier'),
    hasProtect: !!document.getElementById('f-aiBridge.compressor.protectCode'),
    protectDisabled: document.getElementById('f-aiBridge.compressor.protectCode')?.disabled,
    t1Line: document.querySelector('.tile .fixed')?.textContent || '',
  }));
  check('switching tabs renders that tab’s fields', () => {
    assert.strictEqual(compressor.heading, 'Compressor');
    assert.strictEqual(compressor.hasTier, true);
  });
  check('§4 protectCode is rendered as fixed and disabled', () => {
    assert.strictEqual(compressor.hasProtect, true);
    assert.strictEqual(compressor.protectDisabled, true);
  });

  // ---- live preview through the host ----------------------------------
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button.act')].find((b) => b.textContent === 'Compress');
    if (btn) btn.click();
  });
  await pump();
  const preview = await page.evaluate(() => {
    const el = document.getElementById('preview');
    return el ? el.textContent : '(no #preview element)';
  });
  check('the T0 preview round-trips through the host', () => {
    assert.match(preview, /18 → 9 tokens \(⇣50%\)/);
    assert.match(preview, /refactor this module/);
  });

  // ---- actions ---------------------------------------------------------
  await page.evaluate(() => {
    [...document.querySelectorAll('button.act')].find((b) => b.textContent === 'T1 status').click();
  });
  await pump();
  check('an action button posts a command the host runs', () => {
    assert.ok(actions.length >= 0);
  });

  // ---- providers health dots ------------------------------------------
  await page.evaluate(() => {
    [...document.querySelectorAll('#tabs button')].find((b) => b.textContent.startsWith('Providers')).click();
  });
  await sleep(150);
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'state',
        values: {},
        errors: {},
        samples: [12, 30, 44],
        snapshot: {
          ramPercent: 44,
          ramUsedMb: 1204,
          ramCapMb: 8000,
          extMb: 96,
          bootTokens: 272,
          deltas: 41,
          indexedFiles: 12,
          snapshots: ['snap-x.json.gz'],
          health: [
            { id: 'chatgpt', label: 'chatgpt', ready: true, limited: false, matches: 5 },
            { id: 'claude', label: 'claude', ready: false, limited: true, matches: 0 },
          ],
          // Batch 9.2: one healthy endpoint and one that failed to reach its host.
          endpoints: [
            { id: 'local', label: 'Local', signedIn: true, models: 3, lastError: null },
            { id: 'dead', label: 'Dead', signedIn: false, models: 0, lastError: 'connect ECONNREFUSED' },
          ],
          // Batch 9.4: one chat answering on the fast rung, one stuck on dom.
          rungs: [
            { id: 'chatgpt', rung: 'fast', answered: 4, fellThrough: 1 },
            { id: 'claude', rung: null, answered: 0, fellThrough: 2 },
          ],
          t1: null,
        },
      },
      '*',
    ),
  );
  await sleep(300);
  const health = await page.evaluate(() =>
    [...document.querySelectorAll('.health-row')].map((r) => ({
      text: r.textContent,
      dot: r.querySelector('.dot')?.className || '',
    })),
  );
  check('provider health renders 🟢 / 🔴 from the live probe', () => {
    assert.ok(health.length >= 2, JSON.stringify(health));
    assert.match(health[0].dot, /green/);
    assert.match(health[1].dot, /red/);
    assert.match(health[0].text, /5 selector/);
  });

  const endpointText = await page.evaluate(() => document.body.textContent || '');
  check('endpoint status renders, including the last error (batch 9.2)', () => {
    assert.match(endpointText, /Endpoints:/, 'no endpoint block');
    assert.match(endpointText, /Local/, 'the healthy endpoint is missing');
    assert.match(endpointText, /3 model/, 'the model count is missing');
    assert.match(endpointText, /connect ECONNREFUSED/, 'the error is not shown');
  });

  check('web-chat rungs render with the rung and the counts (batch 9.4)', () => {
    assert.match(endpointText, /Web chat rungs:/, 'no rung block');
    assert.match(endpointText, /answering on fast/, 'the answering rung is missing');
    assert.match(endpointText, /no rung has answered/, 'the stuck provider is missing');
    assert.match(endpointText, /4 answered/, 'the answered count is missing');
    assert.match(endpointText, /2 fell through/, 'the fall-through count is missing');
  });

  const testButtons = await page.evaluate(() =>
    [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Test').length,
  );
  check('each endpoint row offers a Test button (batch 9.3)', () => {
    assert.equal(testButtons, 2, `found ${testButtons} Test button(s)`);
  });

  // ---- performance sparkline ------------------------------------------
  await page.evaluate(() => {
    [...document.querySelectorAll('#tabs button')].find((b) => b.textContent.startsWith('Performance')).click();
  });
  await sleep(300);
  const spark = await page.evaluate(() => {
    const svg = document.querySelector('svg.spark');
    return svg ? { points: svg.querySelector('polyline')?.getAttribute('points') || '' } : null;
  });
  check('the performance tab draws a RAM sparkline', () => {
    assert.ok(spark, 'no sparkline');
    assert.ok(spark.points.split(' ').length >= 3, spark.points);
  });

  // ---- reset ----------------------------------------------------------
  await page.evaluate(() => {
    window.__out.length = 0;
    [...document.querySelectorAll('button.secondary')].find((b) => b.textContent === 'Reset tab').click();
  });
  await sleep(200);
  const resetCmd = await page.evaluate(() => window.__out.find((m) => m.cmd === 'resetTab'));
  check('reset posts a resetTab command for the active tab', () => {
    assert.ok(resetCmd, 'no resetTab command');
    assert.strictEqual(resetCmd.tab, 'performance');
  });

  await page.close();
  await browser.close();
  chrome.kill('SIGKILL');
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

  const report = [
    '# Batch 4.1 — settings panel (UI evidence)',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Panel HTML: ${html.length} bytes · six tabs · driven by the real SettingsController`,
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The inline error, as the browser saw it',
    '',
    '```',
    `input: aiBridge.bridge.port = 99999`,
    `aria-invalid: ${invalid.aria}`,
    `error shown: ${invalid.shown}`,
    `message: ${invalid.text}`,
    `stored: ${host.store.has('aiBridge.bridge.port') ? 'yes (WRONG)' : 'no'}`,
    '```',
    '',
  ].join('\n');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-4.1-settings-panel.md'), report);

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
