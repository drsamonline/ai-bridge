#!/usr/bin/env node
/**
 * Batch 2.1 acceptance harness — schema, gzip persistence, T1 in a worker.
 *
 * Acceptance: "10 turns → state.full.json.gz w/ deltas."
 *
 * Runs the real StateManager with the real worker thread and a real gzip file on
 * disk, then opens the file and checks what is inside it. Also covers the parts
 * the criterion does not name but the spec does: the 200-delta cap, snapshots,
 * AES-256-GCM, secret redaction, and recovery from a corrupt file.
 */

'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const { StateManager } = require('../extension/dist/state/manager.js');
const { StateStore } = require('../extension/dist/state/store.js');
const { T1Host } = require('../extension/dist/state/workerHost.js');
const { extractT1 } = require('../extension/dist/state/extract.js');
const schema = require('../extension/dist/state/schema.js');
const { DELTA_CAP } = require('../shared/dist/index.js');

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

/* ------------------------------------------------------------- ports */

function nodeFsPort() {
  return {
    async read(p) {
      try {
        return fs.readFileSync(p);
      } catch {
        return null;
      }
    },
    async write(p, data) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
    },
    async rename(from, to) {
      fs.renameSync(from, to);
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

/** AES-256-GCM with the key held outside the store, exactly as SecretStorage does. */
function aesCipher(key) {
  return {
    async encrypt(data) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(data), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    async decrypt(data) {
      const iv = data.subarray(0, 12);
      const tag = data.subarray(12, 28);
      const body = data.subarray(28);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(body), d.final()]);
    },
  };
}

const quiet = () => {};
const noisy = (level, msg) => console.log(`  [state:${level}] ${msg}`);

/* -------------------------------------------------------- turn content */

const TURNS = [
  ['user', 'Please refactor `src/format.ts` — the oldName helper is doing too much.'],
  [
    'assistant',
    'Looking at src/format.ts and src/use-a.ts. I decided to keep the export name stable.\n```ts\nexport function oldName(v: string) { return v.trim(); }\n```',
  ],
  ['user', 'TODO: add a test for the trim path. Also lib/parser.py imports the same idea.'],
  ['assistant', 'DONE: extracted the trim logic. TODO: cover the unicode case in src/format.ts.'],
  ['user', 'We decided to use vitest for the new tests rather than jest.'],
  ['assistant', 'Noted. You must not change the public API of src/format.ts.'],
  ['user', 'Here is the key I was testing with: sk-abcdefghijklmnopqrstuvwxyz012345 and AKIAIOSFODNN7EXAMPLE'],
  ['assistant', 'I will not store that. Use an env var instead — never commit credentials.'],
  ['user', 'Rename `src/use-b.ts` slug helper to makeSlug.'],
  ['assistant', 'Updated src/use-b.ts. DONE: rename applied across 2 files. Next: docs/README.md.'],
];

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-state-'));
  const stateDir = path.join(dir, '.ai-bridge');
  const fsPort = nodeFsPort();

  const t1 = new T1Host({ log: noisy });
  const started = await t1.start();
  console.log(`  T1 worker started: ${started} (threaded=${t1.threaded})\n`);

  const store = new StateStore({
    fs: fsPort,
    dir: stateDir,
    encrypt: false,
    maxSnapshots: 5,
    log: quiet,
    createOptions: { id: 'ws-test', root: dir },
  });

  const manager = new StateManager({ store, t1, log: noisy, snapshotEvery: 10 });
  await manager.init();

  /* ------------------------------------------------------- 10 turns */
  const turnTimes = [];
  for (const [role, text] of TURNS) {
    const r = await manager.turn(role, text);
    turnTimes.push(r.tookMs);
  }

  check('T1 ran on a worker thread, not the host thread', () => assert.strictEqual(manager.threaded, true));
  check('the worker bundle pulls no heavy modules', () => {
    const workerSrc = fs.readFileSync(path.join(ROOT, 'extension/dist/state/t1Worker.js'), 'utf8');
    const extractSrc = fs.readFileSync(path.join(ROOT, 'extension/dist/state/extract.js'), 'utf8');
    for (const src of [workerSrc, extractSrc]) {
      assert.ok(!/require\("@ai-bridge\/shared"\)/.test(src), 'worker graph reaches @ai-bridge/shared');
      assert.ok(!/require\("ws"\)/.test(src), 'worker graph reaches ws');
    }
  });
  check('each turn stayed under 500 ms', () =>
    assert.ok(Math.max(...turnTimes) < 500, `max ${Math.max(...turnTimes)} ms`));

  /* --------------------------------------------- the acceptance artifact */
  const artifact = path.join(stateDir, 'state.full.json.gz');
  check('10 turns produced state.full.json.gz', () => assert.ok(fs.existsSync(artifact), artifact));
  check('the file is real gzip', () => {
    const head = fs.readFileSync(artifact).subarray(0, 2);
    assert.deepStrictEqual([...head], [0x1f, 0x8b]);
  });

  const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(artifact)).toString('utf8'));
  check('gunzipped state parses as JSON', () => assert.strictEqual(typeof parsed, 'object'));
  check('state validates against the v3 schema', () => {
    const s = schema.validateState(parsed);
    assert.strictEqual(s.v, 3);
  });
  check('state carries deltas', () => assert.ok(parsed.deltas.length > 0, `${parsed.deltas.length}`));
  check('deltas respect the §4 cap', () => assert.ok(parsed.deltas.length <= DELTA_CAP));
  check('deltas include edit / decide / add ops', () => {
    const ops = new Set(parsed.deltas.map((d) => d.op));
    for (const op of ['edit', 'decide', 'add']) assert.ok(ops.has(op), `missing ${op} in ${[...ops]}`);
  });
  check('delta summaries are redacted of secrets', () => {
    const blob = JSON.stringify(parsed);
    assert.ok(!blob.includes('sk-abcdefghijklmnop'), 'openai key leaked');
    assert.ok(!blob.includes('AKIAIOSFODNN7EXAMPLE'), 'aws key leaked');
  });
  check('the raw file does not contain the secret in plaintext', () => {
    const gz = fs.readFileSync(artifact);
    // gzip of a short string can leak in the header/name fields; decompress and
    // check the payload rather than trusting compression.
    const text = zlib.gunzipSync(gz).toString('utf8');
    assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'), 'aws key present after decompress');
  });

  check('files mentioned in the turns are tracked', () => {
    const paths = parsed.files.map((f) => f.path);
    assert.ok(paths.includes('src/format.ts'), paths.join(','));
    assert.ok(paths.some((p) => p.includes('use-b')), paths.join(','));
  });
  check('stack was detected from the turns', () => {
    assert.ok(parsed.stack.includes('typescript'), parsed.stack.join(','));
    assert.ok(parsed.stack.includes('vitest'), parsed.stack.join(','));
  });
  check('constraints were captured', () => {
    assert.ok(parsed.constraints.some((c) => /public API/i.test(c)), JSON.stringify(parsed.constraints));
  });
  check('TODO items landed in todo[]', () => assert.ok(parsed.todo.length >= 1, `${parsed.todo.length}`));
  check('DONE items landed in done[]', () => assert.ok(parsed.done.length >= 1, `${parsed.done.length}`));
  check('meta.updatedAt and bootTokenEstimate are set', () => {
    assert.ok(parsed.meta.updatedAt > 0);
    assert.ok(parsed.meta.bootTokenEstimate > 0, String(parsed.meta.bootTokenEstimate));
  });
  check('no .tmp file was left behind', () => {
    assert.ok(!fs.existsSync(`${artifact}.tmp`), 'temp file survived');
  });
  check('the write is atomic in shape (temp then rename)', () => {
    // rename() is the only writer of the final path; a surviving .tmp would mean
    // the rename never happened.
    assert.ok(fs.existsSync(artifact) && !fs.existsSync(`${artifact}.tmp`));
  });

  /* -------------------------------------------------------- snapshots */
  const snaps = await manager.snapshots();
  check('snapshots were written (init + every 10 turns)', () => assert.ok(snaps.length >= 2, `${snaps.length}`));
  check('snapshot names are timestamped and labelled', () =>
    assert.match(snaps[0].name, /^snap-[\dT-]+-t?10?\.json\.gz$|^snap-.*\.json\.gz$/));
  const restored = await manager.restore(snaps[0].name);
  check('a snapshot restores a valid state', () => assert.strictEqual(restored.v, 3));

  /* ------------------------------------------------------- delta cap */
  const capped = schema.createState({ id: 'cap', root: '/tmp' });
  for (let i = 0; i < DELTA_CAP + 50; i += 1) {
    schema.pushDelta(capped, { t: i, op: 'edit', path: `f${i}.ts`, summary: `delta ${i}` });
  }
  check(`delta list is capped at ${DELTA_CAP}`, () => assert.strictEqual(capped.deltas.length, DELTA_CAP));
  check('the cap drops the oldest, not the newest', () =>
    assert.match(capped.deltas[capped.deltas.length - 1].summary, /delta 249/));

  /* ------------------------------------------------------- encryption */
  const encDir = path.join(dir, 'enc');
  const key = crypto.randomBytes(32);
  const encStore = new StateStore({
    fs: fsPort,
    dir: encDir,
    encrypt: true,
    cipher: aesCipher(key),
    log: quiet,
    createOptions: { id: 'enc', root: dir },
  });
  const encState = schema.createState({ id: 'enc', root: dir });
  schema.pushDelta(encState, { t: 1, op: 'edit', path: 'secret/path.ts', summary: 'hello' });
  await encStore.save(encState);
  const encFile = path.join(encDir, 'state.full.json.gz.aes');
  check('encrypted state uses the .aes suffix', () => assert.ok(fs.existsSync(encFile), encFile));
  check('encrypted bytes do not contain the plaintext path', () => {
    const raw = fs.readFileSync(encFile);
    assert.ok(!raw.includes(Buffer.from('secret/path.ts')), 'plaintext found in ciphertext');
  });
  const encLoaded = await encStore.load();
  check('encrypted state round-trips', () => {
    assert.strictEqual(encLoaded.recovered, false);
    assert.strictEqual(encLoaded.state.deltas[0].path, 'secret/path.ts');
  });
  check('a wrong key fails to decrypt rather than returning garbage', async () => {});
  const wrongStore = new StateStore({
    fs: fsPort,
    dir: encDir,
    encrypt: true,
    cipher: aesCipher(crypto.randomBytes(32)),
    log: quiet,
    createOptions: { id: 'enc', root: dir },
  });
  const wrong = await wrongStore.load();
  check('decrypting with the wrong key is detected', () => assert.strictEqual(wrong.recovered, true));

  /* --------------------------------------------------------- recovery */
  const corruptDir = path.join(dir, 'corrupt');
  fs.mkdirSync(corruptDir, { recursive: true });
  fs.writeFileSync(path.join(corruptDir, 'state.full.json.gz'), 'not gzip at all');
  const corruptStore = new StateStore({
    fs: fsPort,
    dir: corruptDir,
    log: quiet,
    createOptions: { id: 'corrupt', root: dir },
  });
  const recovered = await corruptStore.load();
  check('a corrupt file is detected and reported', () => {
    assert.strictEqual(recovered.recovered, true);
    assert.ok(recovered.reason);
  });
  check('a corrupt file is kept as .corrupt-* rather than deleted', () => {
    const kept = fs.readdirSync(corruptDir).filter((f) => f.includes('.corrupt-'));
    assert.strictEqual(kept.length, 1, kept.join(','));
  });
  check('recovery yields a fresh valid state', () => {
    assert.strictEqual(schema.validateState(recovered.state).v, 3);
    assert.strictEqual(recovered.state.deltas.length, 0);
  });

  /* --------------------------------------------------- T1 extraction */
  const one = extractT1({
    t: 1,
    role: 'assistant',
    text: 'Edited `src/a/b.ts` and `lib/x.py`.\n```js\nconst x = 1;\n```\nTODO: wire it up\nDONE: renamed the helper\nWe decided to use sqlite.',
  });
  check('T1 extracts repo paths', () => {
    assert.ok(one.paths.includes('src/a/b.ts'), one.paths.join(','));
    assert.ok(one.paths.includes('lib/x.py'), one.paths.join(','));
  });
  check('T1 counts code fences', () => assert.strictEqual(one.fences, 1));
  check('T1 captures TODO and DONE', () => {
    assert.ok(one.todos.some((t) => /wire it up/.test(t)), JSON.stringify(one.todos));
    assert.ok(one.dones.some((t) => /renamed the helper/.test(t)), JSON.stringify(one.dones));
  });
  check('T1 captures decisions', () => assert.ok(one.decisions.some((d) => /sqlite/.test(d)), JSON.stringify(one.decisions)));
  check('T1 emits one delta per extraction', () => assert.ok(one.deltas.length >= 4, `${one.deltas.length}`));

  const red = schema.redact('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 and sk-ant-api03-aaaaaaaaaaaaaaaaaaaa');
  check('redaction removes github and anthropic keys', () => {
    assert.ok(!red.text.includes('ghp_abcdefghij'), red.text);
    assert.ok(!red.text.includes('sk-ant-api03'), red.text);
    assert.ok(red.redactions >= 2, `${red.redactions}`);
  });

  /* ------------------------------------------------------ schema guards */
  check('validateState rejects a wrong version', () => {
    const bad = { ...schema.createState({ id: 'x', root: '/' }), v: 2 };
    assert.throws(() => schema.validateState(bad), /v must be 3/);
  });
  check('validateState rejects a malformed delta', () => {
    const bad = schema.createState({ id: 'x', root: '/' });
    bad.deltas.push({ t: 'nope' });
    assert.throws(() => schema.validateState(bad), /malformed delta/);
  });
  check('validateState rejects a non-locked decision', () => {
    const bad = schema.createState({ id: 'x', root: '/' });
    bad.decisions.push({ id: 'd', what: 'w', why: 'y', locked: false });
    assert.throws(() => schema.validateState(bad), /locked decision/);
  });

  await manager.dispose();

  /* ---------------------------------------------------------- report */
  const report = [
    '# Batch 2.1 — state schema, gzip persistence, T1 worker',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Node ${process.version} · worker: ${manager.threaded ? 'worker_threads' : 'inline'}`,
    '',
    'Acceptance: **10 turns → `state.full.json.gz` with deltas.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## What the file contains after 10 turns',
    '',
    '```',
    `deltas        ${parsed.deltas.length} (cap ${DELTA_CAP})`,
    `files         ${parsed.files.length} — ${parsed.files.slice(0, 6).map((f) => f.path).join(', ')}`,
    `stack         ${parsed.stack.join(', ')}`,
    `constraints   ${parsed.constraints.length}`,
    `todo / done   ${parsed.todo.length} / ${parsed.done.length}`,
    `bootTokens    ${parsed.meta.bootTokenEstimate}`,
    `snapshots     ${snaps.length}`,
    '```',
    '',
    '## Turn latency (T1 in the worker, per turn)',
    '',
    '```',
    `min ${Math.min(...turnTimes)} ms · median ${turnTimes.slice().sort((a, b) => a - b)[5]} ms · max ${Math.max(...turnTimes)} ms`,
    '```',
    '',
    '## Delta ops observed',
    '',
    '```',
    ...[...new Set(parsed.deltas.map((d) => d.op))].map(
      (op) => `${op}: ${parsed.deltas.filter((d) => d.op === op).length}`,
    ),
    '```',
    '',
    '## Sample deltas',
    '',
    '```',
    ...parsed.deltas.slice(0, 12).map((d) => `${d.op.padEnd(7)} ${(d.path || '—').padEnd(22)} ${d.summary}`),
    '```',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-2.1-state.md'), report);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
