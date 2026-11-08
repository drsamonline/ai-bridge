#!/usr/bin/env node
/**
 * Session lifecycle acceptance harness — the layer that makes the engine
 * reachable.
 *
 * Every check here goes through SessionManager rather than constructing a
 * SessionRunner directly, because the manager is what the control plane calls and
 * the manager is what was missing. A fake dispatch stands in for the page.
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SessionManager } = require('../bridge/dist/runtime/sessions.js');
const { BridgeRuntime } = require('../bridge/dist/runtime/index.js');
const { sessionDir } = require('../bridge/dist/runtime/session.js');

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
const tempRoot = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-mgr-'));
  roots.push(dir);
  return dir;
};

/** Only what the manager actually calls on its collaborators. */
function manager(root, over = {}) {
  return new SessionManager({
    root,
    controller: { pinTab: () => true, unpinTab: () => {}, activePage: null },
    adapters: { get: async () => { throw new Error('no adapters in this test'); } },
    relay: { sendAndObserve: async () => { throw new Error('no relay in this test'); } },
    log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
    ...over,
  });
}

const roster = () => [
  { index: 0, role: 'planner', label: 'planner', providers: ['chatgpt'], tier: 'visible' },
  { index: 1, role: 'auditor', label: 'auditor', providers: ['sarvam'], tier: 'visible' },
  { index: 2, role: 'debater', label: 'd1', providers: ['claude'], tier: 'background' },
  { index: 3, role: 'debater', label: 'd2', providers: ['gemini'], tier: 'background' },
];

const plannerTurn = (plan, tok = '[[REPLY]]') => `Revised.\n\n\`\`\`plan\n${plan}\n\`\`\`\n\n${tok}`;

const agreeing = async (req) => ({
  settledBy: 'sentinel',
  text: req.participant.role === 'planner' ? plannerTurn('# agreed', '[[CONSENSUS]]') : 'agreed\n[[CONSENSUS]]',
});

(async () => {
  console.log('');

  await checkAsync('manager: create validates the roster and writes a record', async () => {
    const m = manager(tempRoot());
    const created = await m.create({ participants: roster(), ramCapBytes: 2000 * 1024 * 1024 });
    assert.equal(created.ok, true, created.detail);
    assert.equal(created.record.state, 'INITIALIZING');
    assert.equal(m.state(created.record.id).id, created.record.id);
    assert.equal(m.list().length, 1);
  });

  await checkAsync('manager: an invalid roster is refused and writes nothing', async () => {
    const root = tempRoot();
    const m = manager(root);
    const bad = await m.create({ participants: [{ index: 0, role: 'debater', label: 'x', providers: ['a'], tier: 'visible' }] });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'ROLE_MISSING');
    assert.deepEqual(m.list(), []);
  });

  await checkAsync('manager: create freezes the repo it will be judged against', async () => {
    const root = tempRoot();
    const repo = tempRoot();
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src/ports.ts'), 'export interface FsPort {}\n');

    const m = manager(root);
    const created = await m.create({ participants: roster(), ramCapBytes: 2000 * 1024 * 1024, repoRoot: repo });
    assert.equal(created.ok, true, created.detail);
    const meta = m.snapshotMeta(created.record.id);
    assert.ok(meta, 'a snapshot must be captured at create, not per turn');
    assert.equal(meta.files, 1);
    assert.equal(meta.sha256.length, 64);
  });

  await checkAsync('manager: a session runs to consensus and bundles', async () => {
    const root = tempRoot();
    const m = manager(root);
    const created = await m.create({ participants: roster(), ramCapBytes: 2000 * 1024 * 1024 });
    assert.equal(created.ok, true);

    const result = await m.run(created.record.id, agreeing);
    assert.equal(result.state, 'CONSENSUS');

    const out = m.bundle(created.record.id);
    assert.equal(out.ok, true);
    const files = fs.readdirSync(out.bundle.dir).sort();
    assert.deepEqual(files, ['manifest.json', 'objections-resolved.md', 'plan.md', 'questions.md', 'transcript.md']);
    assert.equal(out.bundle.manifest.state, 'AWAITING_HANDOFF_CONFIRM');
    assert.match(fs.readFileSync(path.join(out.bundle.dir, 'plan.md'), 'utf8'), /agreed/);
  });

  await checkAsync('manager: a bundle is refused before consensus', async () => {
    const root = tempRoot();
    const m = manager(root);
    const created = await m.create({ participants: roster(), ramCapBytes: 2000 * 1024 * 1024 });
    await m.run(created.record.id, async (req) => ({
      settledBy: 'sentinel',
      text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
    }));
    assert.equal(m.bundle(created.record.id).ok, false);
  });

  await checkAsync('manager: abort stops the session and unpins its tabs', async () => {
    const root = tempRoot();
    const unpinned = [];
    const m = manager(root, {
      controller: { pinTab: () => true, unpinTab: (id) => unpinned.push(id), activePage: null },
    });
    const created = await m.create({ participants: roster(), ramCapBytes: 2000 * 1024 * 1024 });
    m.bindTab(created.record.id, 0, 'tab-a');
    await m.run(created.record.id, async (req) => ({
      settledBy: 'sentinel',
      text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
    }));
    assert.equal(m.abort(created.record.id, 'changed my mind'), true);
    assert.deepEqual(unpinned, ['tab-a'], 'an aborted session must release what it pinned');
    assert.equal(m.state(created.record.id).state, 'ABORTED');
  });

  await checkAsync('manager: run and resume on an unknown session return null', async () => {
    const m = manager(tempRoot());
    assert.equal(await m.run('nope', agreeing), null);
    assert.equal(await m.resume('nope'), null);
    assert.equal(m.bundle('nope').ok, false);
    assert.equal(m.abort('nope'), false);
  });

  await checkAsync('ctl.session.*: the ops reach the manager over the control plane', async () => {
    const root = tempRoot();
    const runtime = new BridgeRuntime({
      log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
      sessionsRoot: root,
    });

    const created = await runtime.control({ op: 'ctl.session.create', roster: { participants: roster(), ramCapBytes: 2000 * 1024 * 1024 } });
    assert.equal(created.ok, true, created.detail);

    const state = await runtime.control({ op: 'ctl.session.state', id: created.record.id });
    assert.equal(state.id, created.record.id);
    assert.equal(state.state, 'INITIALIZING');

    const listed = await runtime.control({ op: 'ctl.session.list' });
    assert.equal(listed.length, 1, 'the session must be discoverable, not just addressable');

    // Bundle before consensus is refused, and says so rather than throwing.
    const refused = await runtime.control({ op: 'ctl.session.bundle', id: created.record.id });
    assert.equal(refused.ok, false);

    // A session that was created and never run must still close, or it sits in
    // INITIALIZING until the startup sweep mislabels it as interrupted.
    const aborted = await runtime.control({ op: 'ctl.session.abort', id: created.record.id, reason: 'test' });
    assert.equal(aborted.ok, true);
    const after = await runtime.control({ op: 'ctl.session.state', id: created.record.id });
    assert.equal(after.state, 'ABORTED');
    assert.equal(after.reason, 'test');

    await runtime.stop();
  });

  await checkAsync('manager: startup reconstructs and collects', async () => {
    const root = tempRoot();
    const m = manager(root);
    const created = await m.create({ participants: roster(), ramCapBytes: 2000 * 1024 * 1024 });
    assert.ok(fs.existsSync(sessionDir(root, created.record.id)));
    const out = m.startup();
    assert.deepEqual(out.collected, [], 'a live session is not collected');
    assert.ok(Array.isArray(out.suspended));
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
