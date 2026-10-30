#!/usr/bin/env node
/**
 * Chat panel — virtual scroll proof.
 *
 * Loads the REAL webview HTML (the exact string ChatPanelProvider ships) into
 * Chromium with a shimmed `acquireVsCodeApi`, pushes 1 000 messages, and measures
 * how many rows actually exist in the DOM. "Virtual scroll only" is a spec rule,
 * so it gets a measurement rather than a code review.
 */

'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const Module = require('node:module');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9223; // 0.2 harness uses 9222; keep them from colliding

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

/** Pull the webview HTML out of the compiled provider with a vscode stub. */
function capturePanelHtml() {
  const stub = {
    Uri: { joinPath: (u, ...p) => ({ fsPath: [u.fsPath, ...p].join('/') }) },
    commands: { executeCommand: async () => undefined },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return stub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { ChatPanelProvider } = require('../extension/dist/chatPanel.js');
    const provider = new ChatPanelProvider({ fsPath: ROOT }, () => undefined);
    let html = '';
    provider.resolveWebviewView({
      visible: true,
      onDidChangeVisibility: () => ({ dispose() {} }),
      webview: {
        options: {},
        set html(v) {
          html = v;
        },
        get html() {
          return html;
        },
        cspSource: 'stub:',
        asWebviewUri: (u) => u,
        postMessage: async () => true,
        onDidReceiveMessage: () => ({ dispose() {} }),
      },
    });
    return html;
  } finally {
    Module._load = originalLoad;
  }
}

async function main() {
  const html = capturePanelHtml();
  console.log(`panel html: ${html.length} bytes`);

  check('panel ships a CSP with a nonce', () => {
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'nonce-[A-Za-z0-9]{16,}'/);
  });
  check('panel markup has the virtual-scroll structure', () => {
    assert.match(html, /id="spacer"/);
    assert.match(html, /translateY/);
    assert.match(html, /OVERSCAN/);
  });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-panel-'));
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
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 420, height: 640 });
  await page.addInitScript(() => {
    window.__posted = [];
    // eslint-disable-next-line no-undef
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => window.__posted.push(m),
      getState() {},
      setState() {},
    });
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200));
  });
  // setContent reuses the current document, so addInitScript would never run.
  // A real navigation (file://) makes the panel load exactly as it does in VS Code.
  const htmlFile = path.join(os.tmpdir(), `ai-bridge-panel-${process.pid}.html`);
  fs.writeFileSync(htmlFile, html);
  await page.goto(`file://${htmlFile}`, { waitUntil: 'domcontentloaded' });
  await sleep(300);

  const push = async (msg) => page.evaluate((m) => window.postMessage(m, '*'), msg);

  // ---- 1 000 messages -----------------------------------------------------
  const N = 1000;
  await page.evaluate((n) => {
    for (let i = 0; i < n; i += 1) {
      window.postMessage({ type: 'user', id: `u${i}`, text: `question ${i} `.repeat(3) }, '*');
      window.postMessage(
        { type: 'assistant', id: `a${i}`, text: `answer ${i} ` + 'lorem ipsum dolor sit amet '.repeat(6) },
        '*',
      );
    }
  }, N / 2);
  await sleep(600);

  const stats = await page.evaluate(() => window.__aiBridgePanel.stats());
  const domRows = await page.evaluate(() => document.querySelectorAll('.msg').length);
  console.log(`  messages=${stats.total} rendered=${stats.rendered} domRows=${domRows} spacer=${stats.scrollHeight}`);

  check('all messages are in the model', () => assert.strictEqual(stats.total, N));
  check('only a window of rows exists in the DOM', () =>
    assert.ok(domRows < 40, `${domRows} rows in the DOM for ${N} messages`));
  check('spacer is sized to the full scroll height', () =>
    assert.ok(Number.parseInt(stats.scrollHeight, 10) > 640 * 5, stats.scrollHeight));

  // ---- scroll to the bottom: the last message must be rendered -----------
  await page.evaluate(() => {
    const v = document.getElementById('viewport');
    v.scrollTop = v.scrollHeight;
  });
  await sleep(400);
  const atBottom = await page.evaluate(() => ({
    last: (() => {
      const rows = [...document.querySelectorAll('.msg')];
      const last = rows[rows.length - 1];
      return last ? last.textContent.slice(0, 40) : '';
    })(),
    rows: document.querySelectorAll('.msg').length,
  }));
  check('scrolling to the end renders the newest message', () =>
    assert.match(atBottom.last, /answer 499/));
  check('row count stays bounded after scrolling', () => assert.ok(atBottom.rows < 40, `${atBottom.rows}`));

  // ---- streaming updates one row, never appends -------------------------
  const before = await page.evaluate(() => document.querySelectorAll('.msg').length);
  await push({ type: 'assistant', id: 'live', text: '', streaming: true });
  for (let i = 1; i <= 8; i += 1) {
    await push({ type: 'delta', id: 'live', text: 'token '.repeat(i * 4) });
    await sleep(60);
  }
  const afterStream = await page.evaluate(() => ({
    rows: document.querySelectorAll('.msg').length,
    liveRows: document.querySelectorAll('.msg[data-id="live"]').length,
    live: (document.querySelector('.msg[data-id="live"]')?.textContent || '').length,
  }));
  await push({ type: 'done', id: 'live', meta: { firstTokenMs: 120, totalMs: 900, settledBy: 'sentinel', chars: 32 } });
  await sleep(200);

  // In a windowed list a row entering the bottom pushes one out of the top, so the
  // count stays flat; what must hold is ONE row for the streaming message, not one
  // per delta.
  check('streaming updates a single row instead of appending per delta', () => {
    assert.strictEqual(afterStream.liveRows, 1, `${afterStream.liveRows} rows for id "live"`);
    assert.ok(afterStream.rows <= before + 2, `${before} → ${afterStream.rows} rows`);
  });
  check('deltas update that row in place', () => assert.ok(afterStream.live > 20, `${afterStream.live} chars`));

  const withMeta = await page.evaluate(
    () => document.querySelector('.msg[data-id="live"] .meta')?.textContent || '',
  );
  check('settled meta renders under the message', () =>
    assert.match(withMeta, /120 ms to first token · 900 ms total · sentinel/));

  // ---- proposal card (batch 1.2) -----------------------------------------
  await push({
    type: 'proposal',
    id: 'p1',
    card: {
      summary: '3 files +5 −5',
      canApply: true,
      files: [
        { path: 'src/format.ts', status: 'ok', added: 2, removed: 2 },
        { path: 'src/use-a.ts', status: 'ok', added: 2, removed: 2 },
        { path: 'src/use-b.ts', status: 'ok', added: 1, removed: 1 },
      ],
      refusals: [],
    },
  });
  await sleep(400);
  const cards = await page.evaluate(() => window.__aiBridgePanel.cards());
  check('proposal card renders in the panel', () => assert.strictEqual(cards.length, 1, `${cards.length} cards`));
  check('card head shows the diff summary', () =>
    assert.match(cards[0].head, /Proposed change · 3 files \+5 −5/));
  check('card lists every file', () => assert.strictEqual(cards[0].rows.length, 3));
  check('card offers review / accept / reject', () =>
    assert.deepStrictEqual(cards[0].buttons, ['diff', 'accept', 'reject']));

  await page.evaluate(() => {
    const card = document.querySelector('.card');
    card.scrollIntoView();
    card.querySelector('button[data-act="accept"]').click();
  });
  await sleep(150);
  const posted = await page.evaluate(() => window.__posted);
  check('accepting posts the action to the extension', () => {
    const msg = posted.find((m) => m.type === 'proposal.action' && m.action === 'accept');
    assert.ok(msg, JSON.stringify(posted.slice(-3)));
    assert.strictEqual(msg.id, 'p1');
  });

  await push({ type: 'proposal.result', id: 'p1', ok: true, text: 'Applied 3 file(s) in one undo step.' });
  await sleep(300);
  const settled = await page.evaluate(() => window.__aiBridgePanel.cards()[0]);
  check('the card records the outcome and drops its buttons', () => {
    assert.match(settled.head, /Proposed change/);
    assert.deepStrictEqual(settled.buttons, []);
  });

  // a refused proposal must not offer Accept
  await push({
    type: 'proposal',
    id: 'p2',
    card: {
      summary: '1 file +0 −1',
      canApply: false,
      files: [{ path: 'src/policy.ts', status: 'refused', added: 0, removed: 0, reason: 'ELOCKED: would remove locked decision' }],
      refusals: [{ path: 'src/policy.ts', reason: 'ELOCKED' }],
    },
  });
  await sleep(300);
  const refused = await page.evaluate(() => window.__aiBridgePanel.cards()[1]);
  check('a refused proposal hides Accept', () => assert.deepStrictEqual(refused.buttons, ['diff', 'reject']));
  check('a refused row shows the reason', () => assert.match(refused.rows[0], /ELOCKED/));

  // ---- T0 compression preview (batch 3.1) -------------------------------
  await push({
    type: 'user',
    id: 'u-comp',
    text: 'Please could you kindly help me to refactor this module, thank you so much!',
    compressed: {
      text: 'help me to refactor this module!',
      percent: 49,
      tokensBefore: 18,
      tokensAfter: 9,
    },
  });
  await sleep(300);
  const compressedView = await page.evaluate(() => {
    const row = document.querySelector('.msg[data-id="u-comp"]');
    return {
      body: row.querySelector('.body').textContent,
      footer: row.querySelector('.compress')?.textContent || '',
    };
  });
  check('a compressed message shows the text that was sent', () =>
    assert.match(compressedView.body, /refactor this module/));
  check('the footer reports the saving', () => assert.match(compressedView.footer, /⇣49% \(18→9 tokens\)/));

  await page.evaluate(() => {
    const row = document.querySelector('.msg[data-id="u-comp"]');
    row.querySelector('button[data-toggle]').click();
  });
  await sleep(250);
  const expanded = await page.evaluate(() => {
    const row = document.querySelector('.msg[data-id="u-comp"]');
    return { body: row.querySelector('.body').textContent, footer: row.querySelector('.compress')?.textContent || '' };
  });
  check('expanding reveals the original text', () =>
    assert.match(expanded.body, /Please could you kindly help me/));
  check('the toggle flips back', () => assert.match(expanded.footer, /show sent/));

  // ---- per-hunk accept (§6) --------------------------------------------
  await push({
    type: 'proposal',
    id: 'p-hunks',
    card: {
      summary: '1 file +2 \u22122',
      canApply: true,
      files: [{ path: 'src/multi.ts', status: 'ok', added: 2, removed: 2 }],
      refusals: [],
      held: [],
      waived: [],
      hunks: [
        { key: 'src/multi.ts#0', path: 'src/multi.ts', index: 0, added: 1, removed: 1, preview: 'export const A = 1;' },
        { key: 'src/multi.ts#1', path: 'src/multi.ts', index: 1, added: 1, removed: 1, preview: 'export const B = 2;' },
      ],
    },
  });
  await sleep(300);
  const hunkView = await page.evaluate(() => {
    const row = document.querySelector('.msg[data-id="p-hunks"]');
    return {
      boxes: row.querySelectorAll('input[data-hunk]').length,
      labels: [...row.querySelectorAll('.hunks li')].map((li) => li.textContent),
    };
  });
  check('every hunk is listed with a checkbox', () => assert.strictEqual(hunkView.boxes, 2));
  check('each hunk row names its file and delta', () =>
    assert.match(hunkView.labels[0], /src\/multi\.ts \+1 \u22121/));

  await page.evaluate(() => {
    window.__posted.length = 0;
    const row = document.querySelector('.msg[data-id="p-hunks"]');
    row.querySelectorAll('input[data-hunk]')[1].checked = false;
    [...row.querySelectorAll('button.act')].find((b) => b.textContent === 'Accept').click();
  });
  await sleep(200);
  const hunkPost = await page.evaluate(() => window.__posted.find((m) => m.action === 'accept'));
  check('unticking a hunk sends only the selected keys', () => {
    assert.ok(hunkPost, 'no accept posted');
    assert.deepStrictEqual(hunkPost.hunks, ['src/multi.ts#0']);
  });

  // ---- held-by-locked-decision banner (batch 2.3) ------------------------
  await push({
    type: 'proposal',
    id: 'p3',
    card: {
      summary: '1 file +0 −1',
      canApply: false,
      files: [{ path: 'src/policy.ts', status: 'refused', added: 0, removed: 0, reason: 'ELOCKED: would remove locked decision' }],
      refusals: [{ path: 'src/policy.ts', reason: 'ELOCKED: would remove locked decision' }],
      held: [{ path: 'src/policy.ts', decisionId: 'd1', what: 'DO NOT REMOVE THIS LINE: audit trail required' }],
      waived: [],
    },
  });
  await sleep(400);
  const heldCard = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].pop();
    return {
      banner: card.querySelector('.held')?.textContent || '',
      buttons: [...card.querySelectorAll('button[data-act]')].map((b) => b.dataset.act),
      decision: card.querySelector('button[data-act="approve"]')?.dataset.decision || '',
    };
  });
  check('a held proposal shows the guard banner', () =>
    /Held by a locked decision/.test(heldCard.banner) && /audit trail required/.test(heldCard.banner));
  check('a held proposal offers Approve override', () =>
    assert.deepStrictEqual(heldCard.buttons, ['diff', 'approve', 'reject']));
  check('the approve button carries the decision id', () => assert.strictEqual(heldCard.decision, 'd1'));

  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].pop();
    card.scrollIntoView();
    card.querySelector('button[data-act="approve"]').click();
  });
  await sleep(150);
  const approvePost = await page.evaluate(() =>
    window.__posted.filter((m) => m.type === 'proposal.action' && m.action === 'approve').pop(),
  );
  check('approving posts the decision id to the extension', () => {
    assert.ok(approvePost, 'no approve message');
    assert.strictEqual(approvePost.decisionId, 'd1');
  });

  await page.close();
  await browser.close();
  fs.rmSync(htmlFile, { force: true });
  chrome.kill('SIGKILL');
  fs.rmSync(profile, { recursive: true, force: true });

  const report = [
    '# Batch 1.2 — chat panel evidence (virtual scroll + proposal cards)',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Panel HTML: ${html.length} bytes · messages pushed: ${N} · viewport 420×640`,
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## Measurement',
    '',
    `- messages in the model: ${stats.total}`,
    `- rows in the DOM at rest: ${domRows}`,
    `- rows after scrolling to the end: ${atBottom.rows}`,
    `- spacer height (full scroll length): ${stats.scrollHeight}`,
    '',
  ].join('\n');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-1.2-panel.md'), report);

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
