#!/usr/bin/env node
/**
 * The packaged artifact must load.
 *
 * `extension/dist/extension.js` is bundled by esbuild so the .vsix is
 * self-contained. This loads the REAL bundle with a stubbed `vscode` module and
 * asserts it exports an activate/deactivate pair — the failure this catches is a
 * vsix that installs and then refuses to activate because a dependency was left
 * in node_modules.
 */

'use strict';

const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE = path.join(ROOT, 'extension', 'dist', 'extension.js');

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

function stubVscode() {
  const disposable = { dispose() {} };
  const handler = { event: () => disposable, dispose() {} };
  const api = {
    version: '1.94.0-stub',
    ViewColumn: { Active: -1, One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    ThemeColor: class { constructor() {} },
    MarkdownString: class { constructor() {} appendMarkdown() { return this; } },
    Uri: {
      joinPath: (...a) => ({ fsPath: a.join('/'), path: a.join('/'), toString: () => a.join('/') }),
      file: (p) => ({ fsPath: p, path: p, toString: () => p }),
    },
    EventEmitter: class { constructor() { this.event = () => disposable; } fire() {} dispose() {} },
    window: {
      createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),
      createStatusBarItem: () => ({ text: '', tooltip: '', command: '', show() {}, hide() {}, dispose() {} }),
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      showQuickPick: async () => undefined,
      showInputBox: async () => undefined,
      showSaveDialog: async () => undefined,
      showTextDocument: async () => ({}),
      createWebviewPanel: () => ({
        webview: { options: {}, html: '', cspSource: '', asWebviewUri: (u) => u, postMessage: async () => true, onDidReceiveMessage: () => disposable },
        reveal() {},
        onDidDispose: () => disposable,
        dispose() {},
      }),
      registerWebviewViewProvider: () => disposable,
      onDidChangeTextDocument: () => disposable,
    },
    workspace: {
      workspaceFolders: undefined,
      textDocuments: [],
      fs: { readFile: async () => new Uint8Array(), writeFile: async () => {}, stat: async () => ({}) },
      getConfiguration: () => ({ get: (_k, d) => d, update: async () => {} }),
      openTextDocument: async () => ({ getText: () => '', lineCount: 1 }),
      findFiles: async () => [],
      onDidChangeConfiguration: () => disposable,
    },
    commands: { registerCommand: () => disposable, executeCommand: async () => undefined },
    env: { clipboard: { writeText: async () => {} }, openExternal: async () => true },
  };
  return api;
}

const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return stubVscode();
  return original.apply(this, arguments);
};

check('the bundle exists (run npm run build:bundle first)', () => assert.ok(fs.existsSync(BUNDLE), BUNDLE));

const src = fs.existsSync(BUNDLE) ? fs.readFileSync(BUNDLE, 'utf8') : '';
check('the bundle is self-contained — no shared/ws require survives', () => {
  assert.ok(!/require\(["']@ai-bridge\/shared["']\)/.test(src), 'shared is required at runtime');
  assert.ok(!/require\(["']ws["']\)/.test(src), 'ws is required at runtime');
});
check('the bundle still leaves vscode to the host', () =>
  assert.match(src, /require\(["']vscode["']\)/));

let mod = null;
check('the bundle loads without throwing', () => {
  mod = require(BUNDLE);
});
check('the bundle exports activate and deactivate', () => {
  assert.ok(mod, 'module did not load');
  assert.strictEqual(typeof mod.activate, 'function');
  assert.strictEqual(typeof mod.deactivate, 'function');
});

const report = [
  '# Bundled artifact (`.vsix` prerequisite)',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Bundle: ${(src.length / 1024).toFixed(1)} KB · self-contained · loads with a stubbed host`,
  '',
  '```',
  ...results,
  '```',
  '',
  `Result: ${results.length - failures}/${results.length} passed.`,
  '',
].join('\n');
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'bundle.md'), report);

console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
