#!/usr/bin/env node
/**
 * Renders the README and landing-page screenshots from the real webviews.
 *
 * These are not mockups: the chat panel and the settings panel are the exact HTML
 * the extension ships, loaded in Chromium with a stubbed VS Code API and a live
 * snapshot, then photographed. Re-run after changing the UI.
 *
 *   npm run build && node scripts/screenshots.mjs
 */

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* The webview modules import `vscode`; stub it before they are required. */
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return { Uri: { joinPath: () => ({}) }, window: {}, workspace: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

/* The webviews read VS Code's theme variables; supply a dark set for the shots. */
const DARK = `
:root{
 --vscode-editor-background:#0d1117; --vscode-sideBar-background:#0d1117;
 --vscode-foreground:#e6edf3; --vscode-descriptionForeground:#8b949e;
 --vscode-button-background:#238636; --vscode-button-foreground:#ffffff;
 --vscode-button-secondaryBackground:#21262d; --vscode-button-secondaryForeground:#e6edf3;
 --vscode-input-background:#161b22; --vscode-input-foreground:#e6edf3;
 --vscode-input-border:#30363d; --vscode-panel-border:#21262d;
 --vscode-list-activeSelectionBackground:#1f6feb33; --vscode-list-activeSelectionForeground:#e6edf3;
 --vscode-editor-font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
 --vscode-font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
 --vscode-inputValidation-errorBackground:#3d1418; --vscode-inputValidation-errorBorder:#f85149;
 --vscode-inputValidation-warningBackground:#2d2211; --vscode-textLink-foreground:#58a6ff;
}
html,body{background:#0d1117;color:#e6edf3;}
`;

const SNAPSHOT = {
  ramUsedMb: 148, ramCapMb: 500, ramPercent: 30, bootTokens: 1180, deltas: 12, indexedFiles: 214,
  snapshots: ['before-refactor', 'after-tests'],
  health: [
    { id: 'chatgpt', label: 'ChatGPT', ready: true, limited: true, matches: 8 },
    { id: 'claude', label: 'Claude', ready: true, limited: false, matches: 7 },
    { id: 'gemini', label: 'Gemini', ready: false, limited: false, matches: 4 },
  ],
  extMb: 96, bootBudget: 4000, contextMode: 'auto',
  models: [
    { id: 'gpt-5-mini', label: 'GPT-5 mini', isFree: true, current: true },
    { id: 'gpt-5', label: 'GPT-5', isFree: false, current: false },
    { id: 'o4-mini', label: 'o4-mini', isFree: false, current: false },
  ],
  router: [
    { id: 'chatgpt', label: 'ChatGPT', state: 'cooling', priority: 1, cooldownMs: 300000, health: 'red', lastResponseMs: 940 },
    { id: 'claude', label: 'Claude', state: 'ready', priority: 2, cooldownMs: 300000, health: 'green', lastResponseMs: 1210 },
    { id: 'gemini', label: 'Gemini', state: 'ready', priority: 3, cooldownMs: 300000, health: 'yellow', lastResponseMs: null },
  ],
};

const OVERRIDES = {
  'aiBridge.router.strategy': 'priority',
  'aiBridge.router.backoff': 'exponential',
  'aiBridge.compressor.tier': 'T0',
  'aiBridge.state.encrypt': true,
  'aiBridge.ui.statusBar': true,
  'aiBridge.ui.showCompressionPreview': true,
  'aiBridge.bridge.autoStart': true,
  'aiBridge.router.failover': true,
  'aiBridge.router.rotation': true,
  'aiBridge.compressor.protectCode': true,
  'aiBridge.repo.context': true,
  'aiBridge.adapter.id': 'chatgpt',
  'aiBridge.ramCap.browser': 500,
  'aiBridge.ramCap.extension': 1024,
  'aiBridge.watchdog.pollMs': 3000,
  'aiBridge.router.retries': 2,
  'aiBridge.router.settleMs': 900,
  'aiBridge.compressor.budget': 4000,
  'aiBridge.state.bootBudget': 4000,
  'aiBridge.repo.maxFiles': 12,
};

const stub = () => {
  window.acquireVsCodeApi = () => ({ postMessage: () => {}, setState: () => {}, getState: () => ({}) });
};

async function shootChat(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 780 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(stub);
  const { ChatPanelProvider } = require(path.join(ROOT, 'extension', 'dist', 'chatPanel.js'));
  const html = new ChatPanelProvider({ fsPath: '/x', path: '/x' }, () => {}).html('SHOTNONCE0000000000000000');
  const file = path.join(OUT, '.chat.html');
  fs.writeFileSync(file, html);
  await page.goto(`file://${file}`);
  await page.addStyleTag({ content: DARK });
  const post = (m) => page.evaluate((msg) => window.postMessage(msg, '*'), m);
  await post({ type: 'status', text: 'Attached · ChatGPT · GPT-5 mini (free)' });
  await post({ type: 'user', id: 'u1', text: 'rename oldName to normalise in src/format.ts and update the callers' });
  await post({ type: 'assistant', id: 'a1', text: '', streaming: true });
  await post({ type: 'delta', id: 'a1', text: 'Renaming the helper and updating both call sites. Two hunks in `src/format.ts`, one in each caller.' });
  await post({ type: 'done', id: 'a1', meta: { firstTokenMs: 471, totalMs: 1840, settledBy: 'sentinel', chars: 118 } });
  await post({
    type: 'proposal',
    id: 'p1',
    card: {
      summary: '3 file(s) +3 −3',
      canApply: true,
      files: [
        { path: 'src/format.ts', status: 'ok', added: 2, removed: 2 },
        { path: 'src/use-a.ts', status: 'ok', added: 1, removed: 1 },
        { path: 'src/use-b.ts', status: 'ok', added: 0, removed: 0 },
      ],
      refusals: [], held: [], waived: [],
      hunks: [
        { key: 'src/format.ts#0', path: 'src/format.ts', index: 0, added: 1, removed: 1, preview: 'export function oldName(value: string)' },
        { key: 'src/format.ts#1', path: 'src/format.ts', index: 1, added: 1, removed: 1, preview: 'export const VERSION = "1.0.0";' },
        { key: 'src/use-a.ts#0', path: 'src/use-a.ts', index: 0, added: 1, removed: 1, preview: "import { oldName } from './format';" },
      ],
    },
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT, 'chat-panel.png') });
  fs.rmSync(file, { force: true });
  await ctx.close();
}

async function shootSettings(browser, tab, name) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 880 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(stub);
  const { renderSettingsHtml } = require(path.join(ROOT, 'extension', 'dist', 'settings', 'html.js'));
  const fields = require(path.join(ROOT, 'extension', 'dist', 'settings', 'fields.js'));
  const values = {};
  for (const f of fields.FIELDS) values[f.key] = fields.sampleValue(f);
  Object.assign(values, OVERRIDES);
  const html = renderSettingsHtml({ nonce: 'SHOTNONCE0000000000000000', snapshot: SNAPSHOT, tab });
  const file = path.join(OUT, `.${tab}.html`);
  fs.writeFileSync(file, html);
  await page.goto(`file://${file}`);
  await page.addStyleTag({ content: DARK });
  await page.evaluate(
    (payload) => window.postMessage({ type: 'state', values: payload.values, errors: {}, snapshot: payload.snapshot }, '*'),
    { values, snapshot: SNAPSHOT },
  );
  await new Promise((r) => setTimeout(r, 650));
  // Presentation only: drop the status footer so the crop is clean.
  await page.evaluate(() => { const f = document.getElementById('status'); if (f) f.remove(); });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  fs.rmSync(file, { force: true });
  await ctx.close();
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/usr/local/bin/chromium',
  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'],
});

fs.mkdirSync(OUT, { recursive: true });
await shootChat(browser);
await shootSettings(browser, 'providers', 'settings-providers');
await shootSettings(browser, 'router', 'settings-router');
await shootSettings(browser, 'performance', 'settings-performance');
await browser.close();

for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.png'))) {
  const kb = (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
  console.log(`${f.padEnd(28)} ${kb} KB`);
}
