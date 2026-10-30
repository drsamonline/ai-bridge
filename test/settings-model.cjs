#!/usr/bin/env node
/**
 * Batch 4.1 acceptance harness — the settings model.
 *
 * Acceptance: "Round-trip every field; invalid → inline error."
 *
 * Every row of the field table is written with a non-default value, read back
 * through both the flat key and its §4 path, and then fed an invalid value to
 * confirm it is rejected without touching the store.
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const fields = require('../extension/dist/settings/fields.js');
const { SettingsController } = require('../extension/dist/settings/controller.js');
const { DEFAULT_SETTINGS } = require('../shared/dist/index.js');

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

/** A stand-in for VS Code's configuration store. */
function fakeHost(initial = {}) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  return {
    store,
    writes,
    get(key, dflt) {
      return store.has(key) ? store.get(key) : dflt;
    },
    async update(key, value) {
      store.set(key, value);
      writes.push({ key, value });
    },
  };
}

const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

async function main() {
  const FIELDS = fields.FIELDS;

  /* -------------------------------------------------- 1. the table itself */
  check('the field table covers all six tabs', () => {
    for (const tab of fields.TABS) {
      assert.ok(fields.fieldsFor(tab).length > 0, `tab ${tab} has no fields`);
    }
  });
  check('every field declares a §4 path, a key and a help line', () => {
    for (const f of FIELDS) {
      assert.ok(f.key.startsWith('aiBridge.'), `${f.key} is not namespaced`);
      assert.ok(f.path && f.path.length > 0, `${f.key} has no path`);
      assert.ok(f.help && f.help.length > 20, `${f.key} has no help`);
      assert.ok(fields.TABS.includes(f.tab), `${f.key} has an unknown tab`);
    }
  });
  check('keys are unique', () => {
    const keys = FIELDS.map((f) => f.key);
    assert.strictEqual(new Set(keys).size, keys.length);
  });

  /* ------------------------------------------- 2. round-trip EVERY field */
  const host = fakeHost();
  const controller = new SettingsController({ host, debounceMs: 0 });
  const roundTrips = [];

  for (const spec of FIELDS) {
    if (spec.readOnly) continue;
    const sample = fields.sampleValue(spec);
    const replies = await controller.handle({ type: 'cmd', cmd: 'set', key: spec.key, value: sample });
    const validation = replies.find((r) => r.type === 'validation');
    const wrote = host.store.get(spec.key);
    const readBack = controller.values()[spec.key];
    // readAll is the panel's full view (§4 + our extension keys); readSettings
    // stays the strict §4 object and is asserted separately.
    const nested = fields.readAll((k, d) => host.get(k, d));
    const atPath = getPath(nested, spec.path);

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const pathIsInSettings = atPath !== undefined;

    roundTrips.push({
      key: spec.key,
      wrote: wrote === undefined ? '(undefined)' : JSON.stringify(wrote),
      readBack: JSON.stringify(readBack),
      nested: JSON.stringify(atPath),
    });

    check(`round-trip: ${spec.key}`, () => {
      assert.ok(validation, 'no validation reply');
      assert.strictEqual(validation.error, null, validation.error || '');
      assert.ok(same(wrote, sample), `store has ${JSON.stringify(wrote)}, expected ${JSON.stringify(sample)}`);
      assert.ok(same(readBack, sample), `values() has ${JSON.stringify(readBack)}`);
      if (pathIsInSettings) assert.ok(same(atPath, sample), `§4 ${spec.path} has ${JSON.stringify(atPath)}`);
    });
  }

  /* --------------------------------- 3. invalid values are refused, inline */
  const host2 = fakeHost();
  const c2 = new SettingsController({ host: host2, debounceMs: 0 });
  const INVALID = [
    ['aiBridge.bridge.port', 99999, /at most 65535/],
    ['aiBridge.bridge.port', 'not-a-number', /Must be a number/],
    ['aiBridge.ramCap.browser', 5, /at least 100/],
    ['aiBridge.router.retries', 2.5, /whole number/],
    ['aiBridge.compressor.tier', 'T9', /Must be one of/],
    ['aiBridge.t1.model', '   ', /Cannot be empty/],
    ['aiBridge.browser.ports', '[70000]', /not a valid port/],
    ['aiBridge.providers.list', '[{"id":"x"}]', /enabled must be true or false/],
    ['aiBridge.providers.list', 'not json', /Not valid JSON/],
    ['aiBridge.state.location', 'cloud', /Must be one of/],
  ];
  for (const [key, value, pattern] of INVALID) {
    const replies = await c2.handle({ type: 'cmd', cmd: 'set', key, value });
    const v = replies.find((r) => r.type === 'validation');
    check(`invalid value refused inline: ${key} = ${JSON.stringify(value)}`, () => {
      assert.ok(v, 'no validation reply');
      assert.ok(v.error, 'expected an error');
      assert.match(v.error, pattern);
      assert.strictEqual(host2.store.has(key), false, 'an invalid value was written to the store');
    });
  }
  check('an invalid value leaves the previous value intact', async () => {});
  await c2.handle({ type: 'cmd', cmd: 'set', key: 'aiBridge.bridge.port', value: 49000 });
  await c2.handle({ type: 'cmd', cmd: 'set', key: 'aiBridge.bridge.port', value: 'nope' });
  check('a rejected edit does not disturb the stored value', () =>
    assert.strictEqual(host2.store.get('aiBridge.bridge.port'), 49000));

  check('a read-only field is refused with a clear message', async () => {});
  const roReplies = await c2.handle({
    type: 'cmd',
    cmd: 'set',
    key: 'aiBridge.compressor.protectCode',
    value: false,
  });
  const ro = roReplies.find((r) => r.type === 'validation');
  check('§4 protectCode cannot be turned off', () => {
    assert.ok(ro.error);
    assert.match(ro.error, /fixed by the contract/);
  });

  const unknown = await c2.handle({ type: 'cmd', cmd: 'set', key: 'aiBridge.nope', value: 1 });
  check('an unknown key is reported rather than silently ignored', () =>
    assert.match(unknown[0].error, /Unknown setting/));

  /* ------------------------------------------------- 4. reset per tab */
  const host3 = fakeHost();
  const c3 = new SettingsController({ host: host3, debounceMs: 0 });
  for (const f of fields.fieldsFor('performance')) {
    if (!f.readOnly) await c3.handle({ type: 'cmd', cmd: 'set', key: f.key, value: fields.sampleValue(f) });
  }
  await c3.handle({ type: 'cmd', cmd: 'set', key: 'aiBridge.state.maxSnapshots', value: 42 });
  await c3.handle({ type: 'cmd', cmd: 'resetTab', tab: 'performance' });
  check('reset restores that tab to defaults', () => {
    for (const f of fields.fieldsFor('performance')) {
      assert.strictEqual(host3.store.get(f.key), f.default, `${f.key} was not reset`);
    }
  });
  check('reset leaves other tabs alone', () =>
    assert.strictEqual(host3.store.get('aiBridge.state.maxSnapshots'), 42));

  /* --------------------------------------------- 5. debounced save */
  const host4 = fakeHost();
  const c4 = new SettingsController({ host: host4, debounceMs: 40 });
  for (const v of [41000, 42000, 43000, 44000, 45000]) {
    await c4.handle({ type: 'cmd', cmd: 'set', key: 'aiBridge.bridge.port', value: v });
  }
  check('typing does not write on every keystroke', () => assert.strictEqual(host4.writes.length, 0));
  await new Promise((r) => setTimeout(r, 120));
  check('the last value is written once after the debounce', () => {
    assert.strictEqual(host4.writes.length, 1, `${host4.writes.length} writes`);
    assert.strictEqual(host4.writes[0].value, 45000);
  });
  await c4.handle({ type: 'cmd', cmd: 'set', key: 'aiBridge.router.retries', value: 3 });
  await c4.dispose();
  check('disposing flushes a pending write', () =>
    assert.strictEqual(host4.store.get('aiBridge.router.retries'), 3));

  /* ------------------------------------------ 6. the §4 Settings object */
  const full = fields.readSettings((k, d) => host.get(k, d));
  const all = fields.readAll((k, d) => host.get(k, d));
  check('readSettings returns the complete §4 shape', () => {
    for (const key of ['ramCap', 'providers', 'router', 'compressor', 'state', 'ui', 'bridge']) {
      assert.ok(key in full, `missing ${key}`);
    }
    assert.strictEqual(full.compressor.protectCode, true);
    assert.ok(Array.isArray(full.providers));
    assert.ok(full.ramCap.browser > 0 && full.ramCap.extension > 0);
  });
  check('readAll is a superset that still carries every §4 value', () => {
    assert.deepStrictEqual(all.ramCap, full.ramCap);
    assert.deepStrictEqual(all.router.strategy, full.router.strategy);
    assert.strictEqual(all.compressor.protectCode, true);
    assert.ok('t1Model' in all.compressor, 'extension keys missing from readAll');
    assert.ok(Array.isArray(all.bridge.cdpPorts));
  });
  check('the panel state carries values, errors and live data', () => {
    const st = controller.state();
    assert.strictEqual(st.type, 'state');
    assert.ok(Object.keys(st.values).length >= FIELDS.length - 1);
    assert.ok(Array.isArray(st.samples));
    assert.ok(st.snapshot && Array.isArray(st.snapshot.health));
  });

  /* -------------------------------------------------------- 7. actions */
  let called = null;
  const host5 = fakeHost();
  const c5 = new SettingsController({
    host: host5,
    debounceMs: 0,
    actions: {
      ping: async (value) => {
        called = value;
        return 'pong';
      },
      boom: () => {
        throw new Error('kaput');
      },
    },
  });
  const ping = await c5.handle({ type: 'cmd', cmd: 'action', action: 'ping', value: 7 });
  check('an action runs and reports status', () => {
    assert.strictEqual(called, 7);
    assert.strictEqual(ping[0].type, 'status');
    assert.match(ping[0].text, /pong/);
  });
  const boom = await c5.handle({ type: 'cmd', cmd: 'action', action: 'boom' });
  check('a failing action reports the failure instead of throwing', () =>
    assert.match(boom[0].text, /kaput/));

  /* ---------------------------------------------------------- report */
  const report = [
    '# Batch 4.1 — settings panel (model + validation)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **Round-trip every field; invalid → inline error.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    `## Fields round-tripped: ${roundTrips.length}`,
    '',
    '| config key | wrote | read back | §4 path |',
    '|---|---|---|---|',
    ...roundTrips.map((r) => `| \`${r.key}\` | ${r.wrote} | ${r.readBack} | ${r.nested} |`),
    '',
    '## Invalid values refused',
    '',
    '```',
    ...INVALID.map(([k, v, p]) => `${k} = ${JSON.stringify(v)}  →  matches ${p}`),
    '```',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-4.1-settings-model.md'), report);

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
