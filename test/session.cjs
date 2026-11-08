#!/usr/bin/env node
/**
 * Session acceptance harness — SPEC v6 §4, §9, §18, §20.
 *
 * Everything here runs without a browser. That is the point of the module: the
 * RAM projection has to be decided *before* the first tab opens, so it cannot
 * depend on measuring one.
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const session = require('../bridge/dist/runtime/session.js');

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

const { validateRoster, sharedAccounts, projectRam, LeaseLedger, ulid, createSession,
        loadSession, writeRecord, reconstruct, gc, sessionDir, SESSION_FILE,
        DEFAULT_RAM_CAP_BYTES, ESTIMATED_TAB_BYTES } = session;

const MB = 1024 * 1024;
const roots = [];
function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-session-'));
  roots.push(dir);
  return dir;
}

/** A valid five-participant roster, which individual checks then break. */
function roster(over = {}) {
  const participants = [
    { index: 0, role: 'planner', label: 'planner', providers: ['chatgpt'], tier: 'visible' },
    { index: 1, role: 'auditor', label: 'auditor', providers: ['sarvam'], tier: 'visible' },
    { index: 2, role: 'debater', label: 'debater 1', providers: ['claude'], tier: 'background' },
    { index: 3, role: 'debater', label: 'debater 2', providers: ['gemini'], tier: 'background' },
    { index: 4, role: 'debater', label: 'debater 3', providers: ['chatgpt'], tier: 'headless', profile: 'p1' },
  ];
  return { participants, ramCapBytes: 2000 * MB, ...over };
}

console.log('');

/* ---------------------------------------------------------------- roster */

check('session: a five-participant roster is accepted', () => {
  const r = validateRoster(roster());
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.participants.length, 5);
  assert.deepEqual(r.participants.map((p) => p.index), [0, 1, 2, 3, 4], 'roster must come back in order');
});

check('session: more than five participants is a configuration rejection', () => {
  const cfg = roster();
  cfg.participants.push({ index: 5, role: 'debater', label: 'x', providers: ['gemini'], tier: 'background' });
  const r = validateRoster(cfg);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PARTICIPANT_LIMIT');
});

check('session: a third visible participant is refused at the schema, not the UI', () => {
  const cfg = roster();
  cfg.participants[2].tier = 'visible';
  const r = validateRoster(cfg);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VISIBLE_LIMIT');
});

check('session: two headless contexts on one profile is contention', () => {
  const cfg = roster();
  cfg.participants[3].tier = 'headless';
  cfg.participants[3].profile = 'p1';
  const r = validateRoster(cfg);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PROFILE_CONTENTION');
});

check('session: two headless contexts on different profiles is allowed', () => {
  const cfg = roster();
  cfg.participants[3].tier = 'headless';
  cfg.participants[3].profile = 'p2';
  assert.equal(validateRoster(cfg).ok, true);
});

check('session: a planner and an auditor are both required', () => {
  const noPlanner = roster();
  noPlanner.participants[0].role = 'debater';
  const a = validateRoster(noPlanner);
  assert.equal(a.ok, false);
  assert.equal(a.code, 'ROLE_MISSING');
  assert.match(a.detail, /planner/);

  const noAuditor = roster();
  noAuditor.participants[1].role = 'debater';
  const b = validateRoster(noAuditor);
  assert.equal(b.code, 'ROLE_MISSING');
  assert.match(b.detail, /auditor/);
});

check('session: two planners is a duplicate, not a silent pick', () => {
  const cfg = roster();
  cfg.participants[2].role = 'planner';
  const r = validateRoster(cfg);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ROLE_DUPLICATE');
});

check('session: a participant with no declared provider is refused', () => {
  const cfg = roster();
  cfg.participants[2].providers = [];
  const r = validateRoster(cfg);
  assert.equal(r.code, 'PROVIDER_EMPTY');
});

check('session: duplicate participant indexes are refused', () => {
  const cfg = roster();
  cfg.participants[2].index = 1;
  assert.equal(validateRoster(cfg).code, 'INDEX_DUPLICATE');
});

/* ------------------------------------------------------------------ RAM */

check('session: the RAM projection runs before any tab exists', () => {
  // Five tabs at the default estimate is over the shipped 500 MB cap, which is
  // exactly why §18 makes the cap session-configurable.
  const tight = roster({ ramCapBytes: 500 * MB });
  const r = validateRoster(tight);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'RAM_INSUFFICIENT');
  assert.match(r.detail, /exceeds/);
});

check('session: a headless participant is projected cheaper than a tab', () => {
  const allTabs = roster();
  const withHeadless = roster();
  // roster() already puts participant 4 in a headless context; the comparison is
  // against the same roster with that participant in an ordinary tab.
  allTabs.participants[4].tier = 'background';
  const a = projectRam(allTabs.participants);
  const b = projectRam(withHeadless.participants);
  assert.ok(b < a, 'a headless context should project below a visible tab');
});

check('session: a lease that would breach the cap is refused and pins nothing', () => {
  const ledger = new LeaseLedger(700 * MB);
  assert.equal(ledger.acquire(0).ok, true);
  assert.equal(ledger.acquire(1).ok, true);
  const third = ledger.acquire(2);
  assert.equal(third.ok, false);
  assert.equal(third.code, 'RAM_INSUFFICIENT');
  assert.deepEqual(ledger.state().pinned, [0, 1], 'a refused lease must not pin');
});

check('session: releasing a lease frees the projection', () => {
  const ledger = new LeaseLedger(700 * MB);
  ledger.acquire(0);
  ledger.acquire(1);
  ledger.release(0);
  assert.equal(ledger.acquire(2).ok, true);
  assert.deepEqual(ledger.state().pinned, [1, 2]);
  ledger.releaseAll();
  assert.deepEqual(ledger.state().pinned, []);
});

/* -------------------------------------------------------- shared accounts */

check('session: a provider driven by two participants is reported, not blocked', () => {
  const shared = sharedAccounts(roster().participants);
  assert.deepEqual(shared, [{ provider: 'chatgpt', participants: [0, 4] }]);
});

check('session: a disjoint roster reports no shared accounts', () => {
  const cfg = roster();
  cfg.participants[4].providers = ['sarvam-2'];
  assert.deepEqual(sharedAccounts(cfg.participants), []);
});

/* ----------------------------------------------------------------- ulid */

check('session: a session id is a 26-character Crockford ULID', () => {
  const id = ulid(1_700_000_000_000);
  assert.equal(id.length, 26);
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/, 'Crockford base32 excludes I, L, O and U');
  assert.equal(id.slice(0, 10), ulid(1_700_000_000_000).slice(0, 10), 'the time prefix must be stable for a fixed clock');
});

check('session: two ids from the same millisecond still differ', () => {
  const now = 1_700_000_000_000;
  const ids = new Set(Array.from({ length: 200 }, () => ulid(now)));
  assert.equal(ids.size, 200, 'randomness must not collide within a millisecond');
});

check('session: ids sort by creation time', () => {
  const early = ulid(1_000_000_000_000);
  const late = ulid(2_000_000_000_000);
  assert.ok(early < late, 'a ULID must sort lexically in time order');
});

/* ---------------------------------------------------------- persistence */

check('session: create writes a record and leaves no temp file behind', () => {
  const root = tempRoot();
  const created = createSession(root, roster(), 1_700_000_000_000);
  assert.equal(created.ok, true, created.detail);
  const dir = sessionDir(root, created.record.id);
  assert.ok(fs.existsSync(path.join(dir, SESSION_FILE)));
  assert.ok(fs.existsSync(path.join(dir, 'tx')), 'the transcript directory must exist');
  assert.ok(fs.existsSync(path.join(dir, 'plans')), 'the plan directory must exist');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'a temp file survived the rename');

  const loaded = loadSession(root, created.record.id);
  assert.equal(loaded.state, 'INITIALIZING');
  assert.equal(loaded.roundBudget, 7);
  assert.deepEqual(Object.keys(loaded.sub).sort(), ['0', '1', '2', '3', '4']);
});

check('session: an invalid roster creates nothing on disk', () => {
  const root = tempRoot();
  const cfg = roster({ ramCapBytes: 500 * MB });
  const r = createSession(root, cfg);
  assert.equal(r.ok, false);
  const dir = path.join(root, 'sessions');
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, 'a rejected session must not leave a directory');
});

check('session: a killed process leaves sessions that the scan loads as SUSPENDED', () => {
  const root = tempRoot();
  const created = createSession(root, roster(), 1_000);
  assert.equal(created.ok, true);

  // The process restarted after the session last changed: that is a suspension.
  const found = reconstruct(root, 2_000);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, created.record.id);
  assert.equal(loadSession(root, created.record.id).state, 'SUSPENDED', 'the scan must persist the inference');
});

check('session: a session touched after the process started is not suspended', () => {
  const root = tempRoot();
  createSession(root, roster(), 5_000);
  assert.deepEqual(reconstruct(root, 4_000), [], 'a live session must not be reclassified');
});

check('session: a finished session is not reconstructed', () => {
  const root = tempRoot();
  const created = createSession(root, roster(), 1_000);
  writeRecord(root, { ...created.record, state: 'HANDED_OFF', lastMutationAt: 1_100 });
  assert.deepEqual(reconstruct(root, 2_000), [], 'terminal sessions must not come back');
});

check('session: retention removes a finished session after seven days, and only then', () => {
  const root = tempRoot();
  const created = createSession(root, roster(), 1_000);
  writeRecord(root, { ...created.record, state: 'ABORTED', lastMutationAt: 1_000 });

  assert.deepEqual(gc(root, 1_000 + 6 * 24 * 3600 * 1000), [], 'six days is too early');
  assert.ok(fs.existsSync(sessionDir(root, created.record.id)));

  const removed = gc(root, 1_000 + 8 * 24 * 3600 * 1000);
  assert.deepEqual(removed, [created.record.id]);
  assert.ok(!fs.existsSync(sessionDir(root, created.record.id)), 'the directory must be gone');
});

check('session: retention never removes a live session', () => {
  const root = tempRoot();
  const created = createSession(root, roster(), 1_000);
  const removed = gc(root, 1_000 + 365 * 24 * 3600 * 1000);
  assert.deepEqual(removed, []);
  assert.ok(fs.existsSync(sessionDir(root, created.record.id)));
});

check('session: the default cap is the session-configured one, not 500 MB', () => {
  assert.equal(DEFAULT_RAM_CAP_BYTES, 2000 * MB);
  assert.ok(ESTIMATED_TAB_BYTES > 0);
});

/* ------------------------------------------------------------------- done */

for (const root of roots) {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

console.log('');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
