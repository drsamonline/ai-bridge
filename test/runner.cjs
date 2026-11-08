#!/usr/bin/env node
/**
 * Runner and token-parser acceptance harness — SPEC v6 §5 and §8.
 *
 * The whole debate loop runs here against a fake dispatch: no browser, no CDP, no
 * network. That is the point of the seam. Every failure mode that would otherwise
 * need five signed-in tabs and forty minutes is a three-line fake.
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const token = require('../bridge/dist/runtime/token.js');
const { SessionRunner } = require('../bridge/dist/runtime/runner.js');
const { createSession, sessionDir } = require('../bridge/dist/runtime/session.js');

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

const { parseToken, extractFenced, escalationAccepted, lastLineOutsideFence } = token;

const roots = [];
function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-run-'));
  roots.push(dir);
  return dir;
}

function roster() {
  return [
    { index: 0, role: 'planner', label: 'planner', providers: ['chatgpt'], tier: 'visible' },
    { index: 1, role: 'auditor', label: 'auditor', providers: ['sarvam'], tier: 'visible' },
    { index: 2, role: 'debater', label: 'd1', providers: ['claude'], tier: 'background' },
    { index: 3, role: 'debater', label: 'd2', providers: ['gemini'], tier: 'background' },
    { index: 4, role: 'debater', label: 'd3', providers: ['chatgpt', 'claude'], tier: 'background' },
  ];
}

/** A planner turn: prose, a fenced plan, then the token last. */
function plannerTurn(plan, tok = '[[REPLY]]') {
  return `Revised the plan.\n\n\`\`\`plan\n${plan}\n\`\`\`\n\n${tok}`;
}

function newSession(root, over = {}) {
  const created = createSession(root, { participants: roster(), ramCapBytes: 2000 * 1024 * 1024, ...over });
  assert.equal(created.ok, true, created.detail);
  return created.record;
}

(async () => {
  console.log('');

  /* ------------------------------------------------------------- the parser */

  check('token: the token is the last line outside a fenced block', () => {
    const text = 'Here is the plan.\n\n```plan\n[[CONSENSUS]]\n```\n\n[[REPLY]]';
    const parsed = parseToken(text);
    assert.equal(parsed.token.kind, 'REPLY', 'the fenced line must not win');
    assert.equal(parsed.reason, null);
  });

  check('token: a token only inside a fence is not a token', () => {
    const text = 'Text.\n\n```\n[[REPLY]]\n```';
    const parsed = parseToken(text);
    assert.equal(parsed.token, null);
    assert.equal(parsed.reason, 'AMBIGUOUS_FENCE');
  });

  check('token: an unterminated fence swallows the rest', () => {
    const text = 'Plan follows.\n```plan\nsomething\n[[REPLY]]';
    const parsed = parseToken(text);
    assert.equal(parsed.token, null, 'a truncated response must not yield a token');
  });

  check('token: the last of several tokens wins, and says so', () => {
    const parsed = parseToken('[[REPLY]]\nthen more prose\n[[CONSENSUS]]');
    assert.equal(parsed.token.kind, 'CONSENSUS');
    assert.equal(parsed.multiple, true);
  });

  check('token: a token mid-sentence is prose, not a signal', () => {
    const parsed = parseToken('I would end with [[CONSENSUS]] if I agreed.');
    assert.equal(parsed.token, null);
    assert.equal(parsed.reason, 'NONE');
  });

  check('token: a debounce settle is parsed but not trusted', () => {
    const parsed = parseToken('done\n[[REPLY]]', 'debounce');
    assert.equal(parsed.token.kind, 'REPLY');
    assert.equal(parsed.reason, 'UNTRUSTED_SETTLE', 'the caller must retry rather than act on it');
    assert.equal(parseToken('done\n[[REPLY]]', 'sentinel').reason, null);
  });

  check('token: ask_user carries its question', () => {
    const parsed = parseToken('Need a decision.\n[[ASK_USER: Postgres or SQLite? | pg | sqlite]]');
    assert.equal(parsed.token.kind, 'ASK_USER');
    assert.match(parsed.token.body, /Postgres or SQLite/);
  });

  check('token: an escalation is accepted only with a non-empty body', () => {
    const yes = parseToken('x\n[[ESCALATE: the auditor has not seen the migration plan]]');
    const no = parseToken('x\n[[ESCALATE:]]');
    assert.equal(escalationAccepted(yes.token), true);
    assert.equal(escalationAccepted(no.token), false);
  });

  check('token: the plan block is extracted whatever token ends the turn', () => {
    const text = 'Plan.\n\n```plan\n# Plan v1\n- do the thing\n```\n\n[[CONSENSUS]]';
    assert.match(extractFenced(text, 'plan'), /do the thing/);
    assert.equal(extractFenced('no fence here', 'plan'), null);
    assert.equal(extractFenced('```plan\nunterminated', 'plan'), null);
  });

  check('token: lastLineOutsideFence ignores trailing whitespace', () => {
    assert.equal(lastLineOutsideFence('a\n\n[[REPLY]]\n\n   \n'), '[[REPLY]]');
  });

  /* --------------------------------------------------------------- the loop */

  await checkAsync('runner: a full round completes and writes both artifacts', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 2 });
    const seen = [];
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 2,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner'
          ? plannerTurn(`# Plan v${req.round}\n- task ${req.round}`)
          : `Comment from ${req.participant.index}\n[[REPLY]]`,
      }),
      onEvent: (e) => seen.push(e),
    });

    const result = await runner.run();
    const dir = sessionDir(root, record.id);
    const plans = fs.readdirSync(path.join(dir, 'plans')).sort();
    const shards = fs.readdirSync(path.join(dir, 'tx'));

    // Two rounds plus the reserved planner turn: three planner turns, three plans.
    assert.equal(result.planVersion, 3, 'one plan artifact per planner turn, reservation included');
    assert.deepEqual(plans, ['plan-v1.md', 'plan-v2.md', 'plan-v3.md']);
    assert.equal(shards.length, 11, 'five participants x two rounds, plus the reservation turn');
    assert.match(fs.readFileSync(path.join(dir, 'plans', 'plan-v2.md'), 'utf8'), /task 2/);
    assert.ok(seen.some((e) => e.type === 'round.complete' && e.round === 1));
    assert.equal(result.state, 'BUDGET_EXHAUSTED');
  });

  await checkAsync('runner: a planner that never writes a plan is retried once, then degraded', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    let plannerCalls = 0;
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => {
        if (req.participant.role === 'planner') {
          plannerCalls += 1;
          return { settledBy: 'sentinel', text: 'A plan, but no fenced block.\n[[REPLY]]' };
        }
        return { settledBy: 'sentinel', text: 'ok\n[[REPLY]]' };
      },
    });

    const result = await runner.run();
    assert.equal(plannerCalls, 2, 'exactly one retry, not a loop');
    assert.equal(result.state, 'NEEDS_USER');
    assert.equal(result.reason, 'PLANNER_DEGRADED');
  });

  await checkAsync('runner: a malformed debater is degraded and the round continues', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.index === 2
          ? 'no token at all'
          : req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
      }),
    });

    const result = await runner.run();
    assert.equal(result.state, 'BUDGET_EXHAUSTED', 'one degraded debater must not stop the session');
    assert.equal(result.turns, 6, 'participant 2 twice (retry), the other four once');
  });

  await checkAsync('runner: a dispatch that throws degrades rather than killing the run', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => {
        if (req.participant.index === 3) throw new Error('ENOTAB: the tab went away');
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
        };
      },
    });

    const result = await runner.run();
    assert.equal(result.state, 'BUDGET_EXHAUSTED');
    assert.ok(result.turns >= 5);
  });

  await checkAsync('runner: unanimous consensus halts the session', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner' ? plannerTurn('# agreed', '[[CONSENSUS]]') : 'agreed\n[[CONSENSUS]]',
      }),
    });

    const result = await runner.run();
    assert.equal(result.state, 'CONSENSUS');
    assert.equal(result.reason, 'CONSENSUS');
    assert.equal(result.rounds, 2, 'the round completed before consensus was evaluated');
  });

  await checkAsync('runner: one participant claiming consensus asks the user', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner'
          ? plannerTurn('# p', '[[CONSENSUS]]')
          : 'ok\n[[REPLY]]',
      }),
    });

    const result = await runner.run();
    assert.equal(result.state, 'NEEDS_USER');
  });

  await checkAsync('runner: ask_user halts immediately with the question recorded', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.index === 1
          ? 'Which database?\n[[ASK_USER: Postgres or SQLite? | pg | sqlite]]'
          : req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
      }),
    });

    const result = await runner.run();
    assert.equal(result.state, 'NEEDS_USER');
    assert.equal(result.turns, 2, 'the turn after the question must not run');
  });

  await checkAsync('runner: the budget ends after the reserved planner turn', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    const events = [];
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 1,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner' ? plannerTurn(`# p${req.round}`) : 'ok\n[[REPLY]]',
      }),
      onEvent: (e) => events.push(e),
    });

    const result = await runner.run();
    assert.equal(result.state, 'BUDGET_EXHAUSTED');
    assert.equal(result.planVersion, 2, 'the reservation turn is a planner turn, so it writes a plan');
    assert.ok(events.some((e) => e.type === 'budget.exhausted'));
  });

  await checkAsync('runner: an accepted escalation buys the round it needs', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    const events = [];
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 1,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner'
          ? plannerTurn('# p')
          : req.participant.index === 1
            ? 'Need one more round.\n[[ESCALATE: the migration has not been reviewed]]'
            : 'ok\n[[REPLY]]',
      }),
      onEvent: (e) => events.push(e),
    });

    const result = await runner.run();
    const escalated = events.find((e) => e.type === 'escalate');
    assert.ok(escalated, 'the escalation must be seen');
    assert.equal(escalated.accepted, true);
    assert.equal(escalated.applied, true);
    assert.equal(result.state, 'BUDGET_EXHAUSTED', 'and the extra round then runs out');
  });

  await checkAsync('runner: the session record on disk reflects the outcome', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 1,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
      }),
    });
    await runner.run();

    const onDisk = JSON.parse(fs.readFileSync(path.join(sessionDir(root, record.id), 'session.json'), 'utf8'));
    assert.equal(onDisk.state, 'BUDGET_EXHAUSTED');
    assert.equal(onDisk.planVersion, 2);
    assert.ok(onDisk.round >= 1);
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
