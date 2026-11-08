#!/usr/bin/env node
/**
 * Snapshot acceptance harness — SPEC v6 §7 and §10, work item 6.
 *
 * Two things are being proven here. That the bridge can read a repository without
 * a VS Code host (the reuse map said the shell would supply the port; a served web
 * page cannot read a disk, so the bridge owns it). And that the slice a
 * participant receives is deterministic — the auditor's objections are only
 * checkable against a fixed artifact if the same plan always produces the same
 * slice.
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { NodeFsPort, gitMeta } = require('../bridge/dist/repo/nodeFsPort.js');
const { rankSlice, sliceForRole, ROLE_SLICE_BYTES } = require('../bridge/dist/repo/slice.js');
const { RepoReader, contextWorthIt } = require('../shared/dist/index.js');

const results = [];
let failures = 0;

function check(name, fn) {
  try {
    fn();
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`FAIL  ${name}\n      ${err.message}`);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`FAIL  ${name}\n      ${err.message}`);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

const roots = [];
function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-snap-'));
  roots.push(root);
  const write = (rel, body) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  write('src/ports.ts', 'export interface FsPort {\n  list(): Promise<string[]>;\n}\n');
  write('src/reader.ts', 'import type { FsPort } from "./ports";\n\nexport class RepoReader {\n  constructor(private readonly fs: FsPort) {}\n  async index(): Promise<number> {\n    return (await this.fs.list()).length;\n  }\n}\n');
  write('src/unrelated.ts', 'export function addNumbers(a: number, b: number): number {\n  return a + b;\n}\n');
  write('docs/notes.md', '# notes\n\nSome prose about nothing in particular.\n');
  write('node_modules/junk/index.js', 'module.exports = 1;\n');
  write('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  write('.git/config', '[core]\n');
  return root;
}

/** A bundle shaped the way RepoReader produces one. */
function bundleOf(root, files) {
  return {
    root,
    query: 'ports',
    indexed: files.length,
    tokens: files.reduce((n, f) => n + f.tokens, 0),
    text: '',
    files: files.map((f) => ({
      path: f.path,
      sha: 'a'.repeat(16),
      bytes: f.bytes,
      hits: f.hits ?? 0,
      tokens: Math.ceil(f.bytes / 4),
      mode: 'body',
      signatures: f.signatures ?? [],
    })),
  };
}

(async () => {
  console.log('');

  /* ------------------------------------------------------------- the port */

  await checkAsync('port: list skips vcs, node_modules and binaries', async () => {
    const port = new NodeFsPort({ root: fixtureRepo() });
    const files = await port.list();
    assert.deepEqual(files, ['docs/notes.md', 'src/ports.ts', 'src/reader.ts', 'src/unrelated.ts']);
    assert.ok(!files.some((f) => f.startsWith('node_modules')), 'node_modules must be skipped');
    assert.ok(!files.includes('assets/logo.png'), 'binaries must be skipped');
  });

  await checkAsync('port: the walk is memoised and refreshable', async () => {
    const root = fixtureRepo();
    const port = new NodeFsPort({ root });
    const first = await port.list();
    fs.writeFileSync(path.join(root, 'src/added.ts'), 'export const added = 1;\n');
    assert.deepEqual(await port.list(), first, 'the second call must come from the cache');
    port.refresh();
    assert.ok((await port.list()).includes('src/added.ts'), 'refresh must see the new file');
  });

  await checkAsync('port: stat produces a stable short sha', async () => {
    const port = new NodeFsPort({ root: fixtureRepo() });
    const a = await port.stat('src/ports.ts');
    const b = await port.stat('src/ports.ts');
    assert.equal(a.sha, b.sha);
    assert.equal(a.sha.length, 16);
    assert.ok(a.size > 0);
    assert.equal(await port.stat('src/missing.ts'), null, 'a missing file is null, not a throw');
  });

  await checkAsync('port: search is literal by default and regex on request', async () => {
    const port = new NodeFsPort({ root: fixtureRepo() });
    const literal = await port.search('RepoReader');
    assert.equal(literal.length, 1);
    assert.equal(literal[0].path, 'src/reader.ts');
    assert.equal(literal[0].line, 3);

    const re = await port.search('add(Numbers)?\\(', { regex: true });
    assert.ok(re.length >= 1);
    assert.equal(re[0].path, 'src/unrelated.ts');

    const capped = await port.search('e', { maxHits: 2 });
    assert.equal(capped.length, 2, 'maxHits must be honoured');
  });

  await checkAsync('port: a path escaping the root is refused', async () => {
    const port = new NodeFsPort({ root: fixtureRepo() });
    await assert.rejects(() => port.read('../../etc/passwd'), /EPATH/);
  });

  await checkAsync('port: git metadata is reported, and absent without git', async () => {
    const plain = await gitMeta(fixtureRepo());
    assert.deepEqual(plain, { branch: null, commit: null, dirty: false },
      'a directory that is not a repo is a valid snapshot with no git metadata');
  });

  /* -------------------------------------------------------------- the gate */

  check('slice: the gate refuses a plan that mentions nothing in the code', () => {
    const gate = contextWorthIt('thanks!');
    assert.equal(gate.attach, false);
    const slice = rankSlice(bundleOf('/r', [{ path: 'src/ports.ts', bytes: 100 }]), {
      planText: 'thanks!',
      budgetBytes: 15 * 1024,
    });
    assert.equal(slice.attach, false);
    assert.deepEqual(slice.files, []);
    assert.ok(slice.gate.length > 0, 'the refusal must explain itself');
  });

  /* ------------------------------------------------------------ the ranker */

  check('slice: a file the plan names by path outranks an unrelated one', () => {
    const bundle = bundleOf('/r', [
      { path: 'src/unrelated.ts', bytes: 200 },
      { path: 'src/ports.ts', bytes: 200 },
    ]);
    const slice = rankSlice(bundle, {
      planText: 'Step 6: extend src/ports.ts so the FsPort interface exposes rankSlice().',
      budgetBytes: 15 * 1024,
    });
    assert.equal(slice.attach, true);
    assert.equal(slice.files[0].path, 'src/ports.ts');
    assert.ok(slice.files[0].reasons.includes('path'), 'the reason must name the rule that fired');
  });

  check('slice: a declared identifier in the plan lifts a file', () => {
    const bundle = bundleOf('/r', [
      { path: 'a.ts', bytes: 100 },
      { path: 'b.ts', bytes: 100, signatures: ['export class RepoReader', 'async index(): Promise<number>'] },
    ]);
    const slice = rankSlice(bundle, {
      planText: 'The RepoReader class needs to expose index() to the bridge.',
      budgetBytes: 15 * 1024,
    });
    assert.equal(slice.files[0].path, 'b.ts');
  });

  check('slice: the budget is a hard cap and over-budget files are reported', () => {
    const files = [];
    for (let i = 0; i < 10; i += 1) files.push({ path: `src/f${i}.ts`, bytes: 2000 });
    const slice = rankSlice(bundleOf('/r', files), {
      planText: 'Update src/f3.ts and src/f4.ts — the api surface changed.',
      budgetBytes: 5000,
    });
    assert.ok(slice.bytes <= 5000, `slice is ${slice.bytes} bytes against a 5000 cap`);
    assert.ok(slice.files.length >= 1);
    assert.ok(slice.omitted.length > 0, 'the files that did not fit must be recorded');
    assert.equal(slice.files.length + slice.omitted.length, 10, 'every file is accounted for');
  });

  check('slice: a smaller file is not thrown away behind a larger one', () => {
    const bundle = bundleOf('/r', [
      { path: 'src/big.ts', bytes: 4000 },
      { path: 'src/small.ts', bytes: 200 },
    ]);
    const slice = rankSlice(bundle, {
      // big scores higher on the path match but cannot fit after the first pick
      planText: 'src/big.ts and src/small.ts both change; the api surface is affected.',
      budgetBytes: 3000,
    });
    assert.ok(slice.files.some((f) => f.path === 'src/small.ts'),
      'a file that fits must not be skipped because an earlier one did not');
  });

  check('slice: the same plan and bundle always produce the same slice', () => {
    const files = [
      { path: 'src/b.ts', bytes: 300 },
      { path: 'src/a.ts', bytes: 300 },
      { path: 'src/c.ts', bytes: 300 },
    ];
    const plan = 'Refactor the api layer in src/a.ts, src/b.ts and src/c.ts.';
    const one = rankSlice(bundleOf('/r', files), { planText: plan, budgetBytes: 1024 });
    const two = rankSlice(bundleOf('/r', [...files].reverse()), { planText: plan, budgetBytes: 1024 });
    assert.deepEqual(one.files.map((f) => f.path), two.files.map((f) => f.path),
      'input order must not change the result');
  });

  check('slice: the rationale records what went in and what stayed out', () => {
    const bundle = bundleOf('/r', [
      { path: 'src/ports.ts', bytes: 500 },
      { path: 'src/other.ts', bytes: 5000 },
    ]);
    const slice = rankSlice(bundle, {
      planText: 'Change src/ports.ts — the api surface needs a new method.',
      budgetBytes: 1000,
    });
    assert.ok(slice.rationale.included.includes('src/ports.ts'));
    assert.ok(slice.rationale.excluded.includes('src/other.ts'));
    assert.ok(slice.rationale.scoringInput.length > 0, 'the manifest must say what was ranked');
  });

  check('slice: the role budgets are the ones in the spec, and a debater gets none', () => {
    assert.deepEqual(ROLE_SLICE_BYTES, { planner: 15360, auditor: 30720, debater: 0 });
    const bundle = bundleOf('/r', [{ path: 'src/ports.ts', bytes: 100 }]);
    const debater = sliceForRole(bundle, 'Change src/ports.ts — the api surface moved.', 'debater');
    assert.equal(debater.attach, false);
    assert.equal(debater.bytes, 0);
    const auditor = sliceForRole(bundle, 'Change src/ports.ts — the api surface moved.', 'auditor');
    assert.equal(auditor.files.length, 1);
  });

  check('slice: an empty bundle is not an error', () => {
    const slice = rankSlice(bundleOf('/r', []), {
      planText: 'Change src/ports.ts — the api surface moved.',
      budgetBytes: 1024,
    });
    assert.equal(slice.attach, false);
    assert.equal(slice.bytes, 0);
  });

  /* ---------------------------------------------------------- integration */

  await checkAsync('integration: the reader runs over the bridge port, and the ranker slices it', async () => {
    const root = fixtureRepo();
    const reader = new RepoReader({ fs: new NodeFsPort({ root }), budgetTokens: 4000, maxFiles: 20 });
    await reader.index();
    const bundle = await reader.bundle('RepoReader', { budgetTokens: 4000, maxFiles: 20 });
    assert.ok(bundle.files.length > 0, 'the reader must find something');

    const slice = rankSlice(bundle, {
      planText: 'The RepoReader class in src/reader.ts must expose index() — the api surface needs it.',
      budgetBytes: ROLE_SLICE_BYTES.planner,
    });
    assert.equal(slice.attach, true);
    assert.equal(slice.files[0].path, 'src/reader.ts', 'the file the plan names must rank first');
    assert.ok(slice.bytes <= ROLE_SLICE_BYTES.planner);
  });

  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  console.log('');
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exit(1);
  }
})();
