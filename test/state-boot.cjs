#!/usr/bin/env node
/**
 * Batch 2.2 acceptance harness — T2, T3, buildBoot()≤4k.
 *
 * Acceptance: "New chat + boot → AI restates DOING/TODO correctly."
 *
 * The model is played by `test/fixtures/chatgpt.html` in `variant=boot`, driven
 * through the REAL bridge, adapter and CDP path: boot prompt → fresh tab →
 * streamed answer → verifyAck(). A `variant=boot-bad` page answers without
 * restating, and the check must fail there — otherwise the test proves nothing.
 *
 * Also covers: the 4k budget under pressure, T2 on its 5-turn interval, T2
 * backend failure falling back, T3 rescan against real files, and JSON parsing
 * of model answers.
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
const { StateManager } = require('../extension/dist/state/manager.js');
const { StateStore } = require('../extension/dist/state/store.js');
const { T1Host } = require('../extension/dist/state/workerHost.js');
const { buildBoot, countTokens, verifyAck } = require('../extension/dist/state/boot.js');
const t2mod = require('../extension/dist/state/t2.js');
const { rescanRepo } = require('../extension/dist/state/rescan.js');
const schema = require('../extension/dist/state/schema.js');

const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = 9222;
const BRIDGE_PORT = 47807;
const FIXTURE_PORT = 47808;

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

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function nodeFsPort(root) {
  const abs = (rel) => path.join(root, rel);
  const sha = (t) => require('node:crypto').createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16);
  const walk = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        walk(full, acc);
      } else acc.push(path.relative(root, full).split(path.sep).join('/'));
    }
    return acc;
  };
  return {
    root,
    async list() {
      return walk(root);
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
    async search(q, opts = {}) {
      const hits = [];
      for (const rel of walk(root)) {
        let text;
        try {
          text = fs.readFileSync(abs(rel), 'utf8');
        } catch {
          continue;
        }
        text.split('\n').forEach((line, i) => {
          if (line.toLowerCase().includes(String(q).toLowerCase())) hits.push({ path: rel, line: i + 1, text: line });
        });
        if (hits.length >= (opts.maxHits ?? 200)) break;
      }
      return hits;
    },
  };
}

function stateFsPort() {
  return {
    async read(p) {
      try {
        return fs.readFileSync(p);
      } catch {
        return null;
      }
    },
    async write(p, d) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, d);
    },
    async rename(a, b) {
      fs.renameSync(a, b);
    },
    async remove(p) {
      fs.rmSync(p, { force: true });
    },
    async list(dir) {
      try {
        return fs.readdirSync(dir);
      } catch {
        return [];
      }
    },
    async mkdir(dir) {
      fs.mkdirSync(dir, { recursive: true });
    },
    async stat(p) {
      try {
        const s = fs.statSync(p);
        return { size: s.size, mtimeMs: s.mtimeMs };
      } catch {
        return null;
      }
    },
  };
}

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-boot-'));
  const repoRoot = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'src/format.ts'), 'export function slug(x: string) { return x.trim(); }\n');
  fs.writeFileSync(path.join(repoRoot, 'src/api.ts'), 'export const API = "/v1";\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# demo\n');

  const stateDir = path.join(dir, 'state');
  const store = new StateStore({
    fs: stateFsPort(),
    dir: stateDir,
    encrypt: false,
    log: () => {},
    createOptions: { id: 'boot-test', root: repoRoot },
  });
  const t1 = new T1Host({ log: () => {} });
  await t1.start();
  const manager = new StateManager({
    store,
    t1,
    log: () => {},
    t2: new t2mod.HeuristicT2(),
    t2Every: 5,
    fs: nodeFsPort(repoRoot),
  });
  await manager.init();

  /* ------------------------------------------------ build a real state */
  const TURNS = [
    ['user', 'Working on src/format.ts — the slug helper needs to handle unicode.'],
    ['assistant', 'I decided to keep slug() pure. TODO: add a unicode test in src/format.test.ts.'],
    ['user', 'TODO: document the API constant in src/api.ts'],
    ['assistant', 'DONE: renamed the helper. Next I am editing src/api.ts.\n```ts\nexport const API = "/v1";\n```'],
    ['user', 'We decided to use vitest for these tests.'],
    ['assistant', 'Noted. You must not change the public export names.'],
  ];
  for (const [role, text] of TURNS) await manager.turn(role, text);

  // Give the state a DOING list the way a real run would: via T2.
  const t2Outcome = await manager.runT2();
  const state = manager.current;
  console.log(
    `  state: doing=${state.doing.length} todo=${state.todo.length} done=${state.done.length} constraints=${state.constraints.length}\n`,
  );

  /* --------------------------------------------------- 1. buildBoot */
  const boot = manager.boot();
  console.log(`  boot: ${boot.tokens}/${boot.budgetTokens} tokens, sections [${boot.sections.join(', ')}]`);
  console.log(`  boot preview:\n${boot.text.split('\n').slice(0, 12).map((l) => '    ' + l).join('\n')}\n`);

  check('boot is under 4k tokens', () => assert.ok(boot.tokens <= 4000, `${boot.tokens}`));
  check('boot carries a DOING section with the in-flight work', () => {
    assert.match(boot.text, /## DOING/);
    assert.ok(state.doing.length > 0, 'state had no DOING items to carry');
    assert.ok(state.doing.some((d) => boot.text.includes(d.task.slice(0, 30))), boot.text);
  });
  check('boot carries a TODO section', () => {
    assert.match(boot.text, /## TODO/);
    assert.ok(state.todo.length > 0, 'state had no TODO items');
    assert.ok(state.todo.some((t) => boot.text.includes(t.task.slice(0, 25))), boot.text);
  });
  check('boot instructs the model to restate before working', () =>
    assert.match(boot.text, /restate/i));
  check('boot names the repo and stack', () => {
    assert.match(boot.text, /Repo:/);
    assert.match(boot.text, /Stack:/);
  });
  check('meta.bootTokenEstimate is updated from the real boot', () =>
    assert.strictEqual(state.meta.bootTokenEstimate, boot.tokens));

  /* --------------------------------------- 2. the 4k budget under pressure */
  const huge = schema.createState({ id: 'huge', root: '/very/long/path/to/a/repo' });
  for (let i = 0; i < 500; i += 1) {
    huge.todo.push({ id: `t${i}`, task: `task number ${i} with a reasonably long description of work`, files: ['src/a.ts'] });
  }
  for (let i = 0; i < 300; i += 1) {
    huge.files.push({ path: `src/deeply/nested/module-${i}.ts`, role: 'unknown', sha: `sha${i}`, touchedBy: ['t1'] });
  }
  for (let i = 0; i < 80; i += 1) huge.glossary[`term${i}`] = `meaning of term ${i} which is fairly wordy`;
  for (let i = 0; i < 200; i += 1) {
    huge.deltas.push({ t: i, op: 'edit', path: `src/f${i}.ts`, summary: `edited file ${i} for reasons` });
  }
  huge.doing.push({ id: 'd1', task: 'CRITICAL in-flight task that must survive trimming', files: [] });
  huge.decisions.push({ id: 'dec1', what: 'Never remove the audit trail', why: 'compliance', locked: true });

  // The default per-section caps keep a big state small — that is the design. To
  // exercise the TRIM path the caps have to be lifted so the budget is genuinely
  // exceeded.
  const squeezed = buildBoot(huge, {
    limits: { todo: 500, files: 300, glossary: 80, deltas: 200, constraints: 60, done: 100 },
  });
  console.log(
    `  squeezed boot: ${squeezed.tokens} tokens, kept [${squeezed.sections.join(', ')}], trimmed [${squeezed.trimmed.join(', ')}]\n`,
  );
  check('an oversized state still fits in 4k', () => assert.ok(squeezed.tokens <= 4000, `${squeezed.tokens}`));
  check('trimming keeps DOING', () => assert.match(squeezed.text, /CRITICAL in-flight task/));
  check('trimming keeps LOCKED DECISIONS', () => assert.match(squeezed.text, /Never remove the audit trail/));
  check('trimming drops the low-priority sections', () =>
    assert.ok(squeezed.trimmed.length > 0, 'nothing was trimmed'));
  check('countTokens is conservative for code', () => {
    const code = 'const x = { a: 1, b: 2, c: 3 };\n'.repeat(20);
    assert.ok(countTokens(code) >= Math.ceil(code.length / 4));
  });

  /* ------------------------------- 3. new chat + boot → restates DOING/TODO */
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

  const openFresh = async (variant) => {
    const status = await client.request({ op: 'ctl.status' });
    for (const tab of status.browser.tabs) await client.request({ op: 'ctl.tab.close', tabId: tab.id });
    return client.request({ op: 'ctl.tab.open', url: `${baseUrl}?variant=${variant}` });
  };

  // A NEW chat tab, then the boot prompt — exactly the 2.2 scenario.
  await openFresh('boot');
  const answer = await client.request(
    { op: 'ctl.prompt', adapterId: 'chatgpt', text: boot.text },
    90000,
  );
  const ack = manager.ack(answer.text);
  console.log(`  fresh chat said:\n${answer.text.split('\n').map((l) => '    ' + l).join('\n')}`);
  console.log(`  ack: ok=${ack.ok} found=${ack.found.length} missing=${ack.missing.length}\n`);

  check('a fresh chat answered the boot prompt', () => assert.ok(answer.text.length > 20));
  check('the answer restates every DOING/TODO item', () => {
    assert.strictEqual(ack.missing.length, 0, `missing: ${ack.missing.join(' | ')}`);
    assert.ok(ack.found.length >= state.doing.length + state.todo.length - 1, `${ack.found.length} found`);
  });
  check('verifyAck reports ok for a compliant restatement', () => assert.strictEqual(ack.ok, true));

  // The negative control: a chat that does NOT restate must fail the check.
  await openFresh('boot-bad');
  const badAnswer = await client.request(
    { op: 'ctl.prompt', adapterId: 'chatgpt', text: boot.text },
    90000,
  );
  const badAck = verifyAck(manager.current, badAnswer.text);
  check('a chat that ignores the boot fails the ack check', () => {
    assert.strictEqual(badAck.ok, false, 'the check passed on a non-restating answer');
    assert.ok(badAck.missing.length > 0);
  });

  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fixture.close();

  /* -------------------------------------------------------------- 4. T2 */
  check('T2 ran on its 5-turn interval', () => assert.ok(t2Outcome.ran, JSON.stringify(t2Outcome)));
  const t2Patch = await new t2mod.HeuristicT2().summarise({
    state,
    turns: [
      { role: 'user', text: 'TODO: write the migration in src/db.ts' },
      { role: 'assistant', text: 'DONE: schema drafted.\n```sql\nselect 1;\n```' },
      { role: 'user', text: 'We decided to use postgres for this.' },
    ],
  });
  check('T2 extracts work items from a window', () => {
    const total = t2Patch.todo.length + t2Patch.doing.length + t2Patch.done.length;
    assert.ok(total > 0, JSON.stringify(t2Patch));
    assert.ok(t2Patch.decisions.length > 0, 'no decisions extracted');
    assert.ok(t2Patch.files.includes('src/db.ts'), JSON.stringify(t2Patch.files));
  });
  check('T2 merge does not duplicate what T1 already recorded', () => {
    const tasks = state.todo.map((t) => t.task.toLowerCase().trim());
    assert.strictEqual(new Set(tasks).size, tasks.length, `duplicates in todo: ${tasks}`);
    assert.ok(t2Outcome.ran, 'T2 did not run on the interval');
  });
  check('T2 recorded which backend ran', () => assert.strictEqual(manager.lastT2Outcome.backend, 'heuristic'));

  const failing = {
    name: 'broken',
    async available() {
      return true;
    },
    async summarise() {
      throw new Error('model went away');
    },
  };
  const manager2 = new StateManager({
    store,
    t1,
    log: () => {},
    t2: failing,
    t2Every: 0,
  });
  await manager2.init();
  await manager2.turn('user', 'TODO: survive a broken T2 backend in src/x.ts');
  const fallbackOutcome = await manager2.runT2();
  check('a failing T2 backend falls back instead of stalling', () => {
    assert.strictEqual(fallbackOutcome.ran, true);
    assert.match(String(fallbackOutcome.backend), /fallback/);
    assert.match(String(fallbackOutcome.reason), /model went away/);
  });

  /* -------------------------------------------------------------- 5. T3 */
  const t3state = schema.createState({ id: 't3', root: repoRoot });
  t3state.files.push({ path: 'src/format.ts', role: 'unknown', sha: '', touchedBy: ['t1'] });
  t3state.files.push({ path: 'src/gone.ts', role: 'unknown', sha: 'deadbeef', touchedBy: ['t1'] });
  t3state.deltas.push({ t: 1, op: 'edit', path: 'src/api.ts', summary: 'touched' });
  const fsPort = nodeFsPort(repoRoot);

  const rescan1 = await rescanRepo(t3state, fsPort, () => {});
  check('T3 fills in a sha that was missing', () => {
    const f = t3state.files.find((x) => x.path === 'src/format.ts');
    assert.match(f.sha, /^[0-9a-f]{16}$/);
  });
  check('T3 drops a tracked file that no longer exists', () => {
    assert.ok(!t3state.files.some((f) => f.path === 'src/gone.ts'));
    assert.deepStrictEqual(rescan1.removed, ['src/gone.ts']);
  });
  check('T3 adds a file named in recent deltas', () => {
    assert.ok(t3state.files.some((f) => f.path === 'src/api.ts'), JSON.stringify(t3state.files.map((f) => f.path)));
  });
  check('T3 computes a dirty hash', () => assert.match(rescan1.dirtyHash, /^[0-9a-f]{16}$/));
  check('T3 recomputes the stack from real extensions', () => assert.ok(t3state.stack.includes('typescript')));

  const before = rescan1.dirtyHash;
  fs.writeFileSync(path.join(repoRoot, 'src/api.ts'), 'export const API = "/v2";\n');
  const rescan2 = await rescanRepo(t3state, fsPort, () => {});
  check('T3 detects a file changed on disk', () => assert.deepStrictEqual(rescan2.changed, ['src/api.ts']));
  check('the dirty hash moves when a file changes', () => assert.notStrictEqual(rescan2.dirtyHash, before));

  /* ------------------------------------------------------- 6. parsePatch */
  const fenced = t2mod.parsePatch('```json\n{"todo":[{"task":"do a thing"}],"done":["finished"]}\n```');
  check('parsePatch reads a fenced JSON block', () => {
    assert.strictEqual(fenced.todo[0].task, 'do a thing');
    assert.deepStrictEqual(fenced.done, ['finished']);
  });
  const noisy = t2mod.parsePatch('Here you go: {"doing":[{"task":"x"}]} hope that helps');
  check('parsePatch tolerates prose around the JSON', () => assert.strictEqual(noisy.doing[0].task, 'x'));
  check('parsePatch returns null for an answer with no JSON', () =>
    assert.strictEqual(t2mod.parsePatch('I could not summarise this.'), null));

  await manager.dispose();
  await manager2.dispose();

  /* ---------------------------------------------------------- report */
  const report = [
    '# Batch 2.2 — T2, T3, buildBoot()≤4k',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **New chat + boot → AI restates DOING/TODO correctly.**',
    '',
    'The model is played by the ChatGPT DOM fixture driven through the real bridge,',
    'adapter and CDP path. A second fixture variant refuses to restate, and the ack',
    'check must fail there — a test that cannot fail proves nothing.',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The boot prompt that was sent',
    '',
    '```',
    boot.text,
    '```',
    '',
    `Tokens: ${boot.tokens}/${boot.budgetTokens} · sections [${boot.sections.join(', ')}]`,
    '',
    '## What the fresh chat answered',
    '',
    '```',
    answer.text,
    '```',
    '',
    `Ack: ok=${ack.ok} · restated ${ack.found.length} · missing ${ack.missing.length}`,
    '',
    '## Oversized state',
    '',
    `500 todo / 300 files / 80 glossary / 200 deltas → ${squeezed.tokens} tokens, kept [${squeezed.sections.join(', ')}], trimmed [${squeezed.trimmed.join(', ')}]`,
    '',
    '## T2 / T3',
    '',
    `- T2: ${t2Outcome.backend} in ${t2Outcome.tookMs} ms — ${JSON.stringify(t2Outcome.counts)}`,
    `- T2 fallback on a broken backend: ${fallbackOutcome.backend} (${fallbackOutcome.reason})`,
    `- T3: ${rescan1.files} files, dirtyHash ${rescan1.dirtyHash}; after an edit: ${rescan2.changed.join(', ')} → ${rescan2.dirtyHash}`,
    '',
  ].join('\n');

  const scrub = (t) => t.split(ROOT).join('<repo>').split(dir).join('<tmp>');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-2.2-boot.md'), scrub(report));
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
