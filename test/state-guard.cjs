#!/usr/bin/env node
/**
 * Batch 2.3 acceptance harness — locked-decision guard + bootstrap ack retry.
 *
 * Acceptance: "Locked edit held + banner + approval flow."
 *
 * Covers, in order: the 2.3 migration off the interim store, the guard reading
 * §4 `ProjectState.decisions`, the hold, the approval flow (waive → re-plan →
 * apply) with its audit delta, path-scoped decisions, the ack retry (unit and
 * end-to-end through the real bridge against a fixture that refuses to restate),
 * and the panel's banner + Approve button.
 */

'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const shared = require('../shared/dist/index.js');
const schema = require('../extension/dist/state/schema.js');
const decisionsMod = require('../extension/dist/state/decisions.js');
const { bootstrapChat, RETRY_PREAMBLE } = require('../extension/dist/state/bootstrap.js');
const { verifyAck } = require('../extension/dist/state/boot.js');
const { EditApplier } = require('../extension/dist/repo/applier.js');
const { parseProposal } = require('../extension/dist/repo/proposal.js');

const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9222;
const BRIDGE_PORT = 47809;
const FIXTURE_PORT = 47810;

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

/* --------------------------------------------------------------- fixtures */

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-guard-'));
  const write = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  write(
    'src/policy.ts',
    [
      '// DO NOT REMOVE THIS LINE: audit trail required',
      'export const POLICY = "retain";',
      'export const SCOPE = "local";',
      '',
    ].join('\n'),
  );
  write('src/other.ts', ['// DO NOT REMOVE THIS LINE: audit trail required', 'export const X = 1;', ''].join('\n'));
  return root;
}

function nodeFsPort(root) {
  const abs = (rel) => path.join(root, rel);
  const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16);
  return {
    root,
    async list() {
      return ['src/policy.ts', 'src/other.ts'];
    },
    async read(rel) {
      return fs.readFileSync(abs(rel), 'utf8');
    },
    async stat(rel) {
      try {
        const st = fs.statSync(abs(rel));
        const text = fs.readFileSync(abs(rel), 'utf8');
        return { path: rel, sha: sha(text), size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    },
    async search() {
      return [];
    },
  };
}

function applyPort(root) {
  const calls = [];
  return {
    calls,
    async apply(edits) {
      calls.push(edits.map((e) => e.path));
      for (const e of edits) fs.writeFileSync(path.join(root, e.path), e.after);
      return { ok: true };
    },
  };
}

const REMOVE_POLICY = parseProposal(
  [
    '```edit path=src/policy.ts',
    '<<<<<<< SEARCH',
    '// DO NOT REMOVE THIS LINE: audit trail required',
    '=======',
    '',
    '>>>>>>> REPLACE',
    '```',
  ].join('\n'),
  'p-guard',
);

const REMOVE_OTHER = parseProposal(
  [
    '```edit path=src/other.ts',
    '<<<<<<< SEARCH',
    '// DO NOT REMOVE THIS LINE: audit trail required',
    '=======',
    '// trimmed',
    '>>>>>>> REPLACE',
    '```',
  ].join('\n'),
  'p-other',
);

function serveFixture() {
  const dir = path.join(ROOT, 'test', 'fixtures');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = path.join(dir, path.basename(url.pathname) || 'chatgpt.html');
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end('nf');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    });
  });
  return new Promise((r) => server.listen(FIXTURE_PORT, '127.0.0.1', () => r(server)));
}

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

async function main() {
  const root = makeRepo();
  const fsPort = nodeFsPort(root);
  const apply = applyPort(root);

  /* ------------------------------------------------- 1. the 2.3 migration */
  const state = schema.createState({ id: 'guard', root });
  const legacy = [
    { id: 'd-legacy-1', what: 'DO NOT REMOVE THIS LINE: audit trail required', why: 'compliance', locked: true, paths: ['src/policy.ts'] },
    { id: 'd-legacy-2', what: 'Never commit credentials', why: 'security', locked: true },
  ];
  let cleared = false;
  const migration = await decisionsMod.migrateDecisions(legacy, state, async () => {
    cleared = true;
  });
  check('legacy decisions migrate into ProjectState.decisions', () => {
    assert.strictEqual(migration.migrated, 2);
    assert.strictEqual(state.decisions.length, 2);
    assert.strictEqual(state.decisions[0].locked, true);
  });
  check('the interim store is cleared after migration', () => assert.strictEqual(cleared, true));
  const again = await decisionsMod.migrateDecisions(legacy, state, async () => {
    cleared = 'twice';
  });
  check('migration is idempotent (no duplicates on a second run)', () => {
    assert.strictEqual(state.decisions.length, 2);
    assert.strictEqual(again.migrated, 0);
  });

  /* --------------------------------------------- 2. the guard reads the state */
  const fromState = decisionsMod.decisionsFromState(state);
  check('decisionsFromState maps every locked decision', () => {
    assert.strictEqual(fromState.length, 2);
    assert.ok(fromState.every((d) => d.locked === true));
  });
  check('a path scope in `why` becomes a paths filter', () => {
    const scoped = decisionsMod.lockDecision(schema.createState({ id: 's', root }), 'X', 'keep it', ['src/a.ts', 'src/b.ts']);
    assert.deepStrictEqual(decisionsMod.pathScope(scoped.why), ['src/a.ts', 'src/b.ts']);
    assert.deepStrictEqual(decisionsMod.decisionsFromState({ ...schema.createState({ id: 's2', root }), decisions: [scoped] })[0].paths, ['src/a.ts', 'src/b.ts']);
  });

  const applier = new EditApplier({
    fs: fsPort,
    apply,
    decisions: () => decisionsMod.decisionsFromState(state),
  });

  const heldPlan = await applier.plan(REMOVE_POLICY);
  check('an edit that removes locked text is held', () => {
    assert.strictEqual(heldPlan.ok, false);
    assert.match(heldPlan.refusals[0].reason, /ELOCKED/);
  });
  check('the plan names the decision that held it (for the banner)', () => {
    assert.strictEqual(heldPlan.held.length, 1);
    assert.match(heldPlan.held[0].what, /audit trail required/);
    assert.strictEqual(heldPlan.held[0].path, 'src/policy.ts');
  });
  check('a held plan cannot be applied', async () => {});
  const blockedApply = await applier.apply(heldPlan);
  check('apply refuses a held plan', () => assert.strictEqual(blockedApply.ok, false));
  check('nothing was written while held', () => {
    assert.match(fs.readFileSync(path.join(root, 'src/policy.ts'), 'utf8'), /audit trail required/);
    assert.strictEqual(apply.calls.length, 0);
  });

  /* ------------------------------------------- 3. the approval flow */
  const waivedPlan = await applier.plan(REMOVE_POLICY, { waiveDecisions: ['d-legacy-1'] });
  check('approving the override re-plans the change as applicable', () => {
    assert.strictEqual(waivedPlan.ok, true);
    assert.deepStrictEqual(waivedPlan.waived, ['d-legacy-1']);
  });
  check('the override is still recorded in the plan', () => {
    assert.strictEqual(waivedPlan.held.length, 1);
    assert.strictEqual(waivedPlan.held[0].decisionId, 'd-legacy-1');
  });
  const waivedApply = await applier.apply(waivedPlan);
  check('an approved override applies in one batch', () => {
    assert.strictEqual(waivedApply.ok, true);
    assert.strictEqual(apply.calls.length, 1);
    assert.ok(!fs.readFileSync(path.join(root, 'src/policy.ts'), 'utf8').includes('audit trail required'));
  });
  decisionsMod.recordOverride(state, { id: 'd-legacy-1', what: 'DO NOT REMOVE THIS LINE: audit trail required' }, ['src/policy.ts']);
  check('the override leaves an audit delta in the state', () => {
    const delta = state.deltas[state.deltas.length - 1];
    assert.strictEqual(delta.op, 'decide');
    assert.match(delta.summary, /override approved/);
    assert.match(delta.summary, /d-legacy-1/);
  });
  check('the decision itself stays locked after an override', () => {
    const d = state.decisions.find((x) => x.id === 'd-legacy-1');
    assert.strictEqual(d.locked, true);
  });

  /* ------------------------------------ 4. path-scoped decisions stay scoped */
  const scopedState = schema.createState({ id: 'scoped', root });
  decisionsMod.lockDecision(scopedState, 'DO NOT REMOVE THIS LINE: audit trail required', 'compliance', ['src/other.ts']);
  const scopedApplier = new EditApplier({
    fs: nodeFsPort(root),
    apply: applyPort(root),
    decisions: () => decisionsMod.decisionsFromState(scopedState),
  });
  const outOfScope = await scopedApplier.plan(
    parseProposal(
      [
        '```edit path=src/policy.ts',
        '<<<<<<< SEARCH',
        'export const POLICY = "retain";',
        '=======',
        'export const POLICY = "drop";',
        '>>>>>>> REPLACE',
        '```',
      ].join('\n'),
      'p-scope-ok',
    ),
  );
  check('a decision scoped to another file does not block this one', () =>
    assert.strictEqual(outOfScope.ok, true));
  const inScope = await scopedApplier.plan(REMOVE_OTHER);
  check('a decision scoped to this file does block it', () => {
    assert.strictEqual(inScope.ok, false);
    assert.match(inScope.refusals[0].reason, /ELOCKED/);
  });

  /* --------------------------------------------- 5. ack retry (unit) */
  const bootState = schema.createState({ id: 'boot', root });
  bootState.doing.push({ id: 't1', task: 'wire the state guard', files: [] });
  bootState.todo.push({ id: 't2', task: 'add the approval flow', files: [] });

  let sends = 0;
  const eventuallyComplies = await bootstrapChat({
    boot: 'BOOT',
    send: async (prompt) => {
      sends += 1;
      return sends === 1 ? 'Sure, let us begin.' : 'DOING:\n- wire the state guard\n\nTODO:\n- add the approval flow';
    },
    ack: (answer) => verifyAck(bootState, answer),
    maxRetries: 1,
  });
  check('a chat that ignores the boot is retried once', () => {
    assert.strictEqual(eventuallyComplies.attempts, 2);
    assert.strictEqual(eventuallyComplies.retried, true);
    assert.strictEqual(sends, 2);
  });
  check('the retry passes and is reported as such', () => {
    assert.strictEqual(eventuallyComplies.ok, true);
    assert.strictEqual(eventuallyComplies.ack.missing.length, 0);
  });
  check('the retry prompt carries the stricter preamble', () => {
    const second = eventuallyComplies.history[1];
    assert.ok(second.prompt.startsWith(RETRY_PREAMBLE), second.prompt.slice(0, 60));
    assert.ok(second.prompt.includes('BOOT'));
  });
  check('the attempt history records both tries', () => {
    assert.strictEqual(eventuallyComplies.history.length, 2);
    assert.strictEqual(eventuallyComplies.history[0].ok, false);
    assert.strictEqual(eventuallyComplies.history[1].ok, true);
  });

  let stubbornSends = 0;
  const stubborn = await bootstrapChat({
    boot: 'BOOT',
    send: async () => {
      stubbornSends += 1;
      return 'I have no idea what we were doing.';
    },
    ack: (answer) => verifyAck(bootState, answer),
    maxRetries: 1,
  });
  check('a chat that never complies is retried exactly once', () => {
    assert.strictEqual(stubborn.attempts, 2);
    assert.strictEqual(stubbornSends, 2);
  });
  check('failure reports what was missing', () => {
    assert.strictEqual(stubborn.ok, false);
    assert.strictEqual(stubborn.ack.missing.length, 2);
  });

  /* --------------------------- 6. ack retry end-to-end through the bridge */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-guard-e2e-'));
  const fixture = await serveFixture();
  const baseUrl = `http://127.0.0.1:${FIXTURE_PORT}/chatgpt.html`;
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

  const openVariant = async (variant) => {
    const status = await client.request({ op: 'ctl.status' });
    for (const tab of status.browser.tabs) await client.request({ op: 'ctl.tab.close', tabId: tab.id });
    await client.request({ op: 'ctl.tab.open', url: `${baseUrl}?variant=${variant}` });
  };
  const sendVia = async (prompt) => {
    const res = await client.request({ op: 'ctl.prompt', adapterId: 'chatgpt', text: prompt }, 90000);
    return res.text;
  };

  await openVariant('boot-bad');
  const stubbornE2E = await bootstrapChat({
    boot: '## DOING\n- wire the state guard\n\n## TODO\n- add the approval flow',
    send: sendVia,
    ack: (answer) => verifyAck(bootState, answer),
    maxRetries: 1,
  });
  check('a real chat that will not restate is retried through the bridge', () => {
    assert.strictEqual(stubbornE2E.attempts, 2, 'the retry did not actually re-send');
    assert.strictEqual(stubbornE2E.ok, false);
  });
  check('the second attempt really reached the page', () => {
    assert.ok(stubbornE2E.history[1].answerChars > 10, 'second answer was empty');
    assert.notStrictEqual(stubbornE2E.history[0].promptChars, stubbornE2E.history[1].promptChars);
  });

  await openVariant('boot');
  const goodE2E = await bootstrapChat({
    boot: '## DOING\n- wire the state guard\n\n## TODO\n- add the approval flow',
    send: sendVia,
    ack: (answer) => verifyAck(bootState, answer),
    maxRetries: 1,
  });
  check('a compliant chat needs no retry', () => {
    assert.strictEqual(goodE2E.attempts, 1);
    assert.strictEqual(goodE2E.retried, false);
    assert.strictEqual(goodE2E.ok, true);
  });

  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fixture.close();

  /* ------------------------------------------------------------- report */
  const report = [
    '# Batch 2.3 — locked-decision guard, approval flow, bootstrap ack retry',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **Locked edit held + banner + approval flow.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The hold',
    '',
    '```',
    ...heldPlan.refusals.map((r) => `${r.path}: ${r.reason}`),
    '```',
    '',
    `Held by: ${heldPlan.held.map((h) => `${h.decisionId} "${h.what}" in ${h.path}`).join('; ')}`,
    '',
    '## The approval flow',
    '',
    `1. plan refuses (ELOCKED) — nothing written, apply port untouched`,
    `2. user approves the override → re-plan with waived=[${waivedPlan.waived.join(', ')}] → applicable=${waivedPlan.ok}`,
    `3. apply → one batch, ${apply.calls[0] ? apply.calls[0].length : 0} file(s) written`,
    `4. audit delta: ${state.deltas[state.deltas.length - 1].summary}`,
    `5. decision stays locked: ${state.decisions.find((d) => d.id === 'd-legacy-1').locked}`,
    '',
    '## Ack retry',
    '',
    `- unit, complies on retry: attempts=${eventuallyComplies.attempts} ok=${eventuallyComplies.ok}`,
    `- unit, never complies: attempts=${stubborn.attempts} ok=${stubborn.ok} missing=${stubborn.ack.missing.length}`,
    `- e2e through the bridge (variant=boot-bad): attempts=${stubbornE2E.attempts} ok=${stubbornE2E.ok}`,
    `- e2e through the bridge (variant=boot): attempts=${goodE2E.attempts} ok=${goodE2E.ok}`,
    '',
  ].join('\n');

  const scrub = (t) => t.split(ROOT).join('<repo>').split(root).join('<tmp-repo>').split(dir).join('<tmp>');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-2.3-guard.md'), scrub(report));

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
