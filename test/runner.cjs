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
          ? plannerTurn(`# p${req.round}`)
          // Escalates once, then replies normally: repeating the same escalation
          // every round is exactly what the stall detector is for, and it caught
          // this fixture when the detector landed.
          : req.participant.index === 1 && req.round === 1
            ? 'Need one more round.\n[[ESCALATE: the migration has not been reviewed]]'
            : `round ${req.round} ok\n[[REPLY]]`,
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

  await checkAsync('runner: a short turn survives a long one instead of being dropped', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 2 });
    const seen = [];
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 2,
      dispatch: async (req) => {
        seen.push({ participant: req.participant.index, round: req.round, context: req.contextText });
        // Participant 2 floods; participant 3 says one short, important thing.
        if (req.participant.index === 2) {
          return { settledBy: 'sentinel', text: `long ${'x'.repeat(4000)}\n[[REPLY]]` };
        }
        if (req.participant.index === 3) {
          return { settledBy: 'sentinel', text: 'SHORT-BUT-CRITICAL\n[[REPLY]]' };
        }
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn(`# p${req.round}`) : `r${req.round}\n[[REPLY]]`,
        };
      },
    });
    await runner.run();

    // A turn in round 2, by someone who saw both of them.
    const later = seen.filter((s) => s.round === 2 && s.participant === 4).pop();
    assert.ok(later, 'expected a round-2 turn by participant 4');
    assert.ok(later.context.includes('SHORT-BUT-CRITICAL'),
      'the short message must survive; dropping whole messages let the long one crowd it out');
    assert.ok(Buffer.byteLength(later.context) <= 6 * 1024, 'and the block still fits its budget');
  });

  /* ------------------------------------------------- the §7 context budget */

  await checkAsync('runner: the context block stays inside 6 KB however large the turns', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 2 });
    const sizes = [];
    const events = [];
    const filler = 'x'.repeat(3000);
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 2,
      dispatch: async (req) => {
        sizes.push(Buffer.byteLength(req.contextText));
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner'
            ? plannerTurn(`# p\n${filler}`)
            : `comment ${filler}\n[[REPLY]]`,
        };
      },
      onEvent: (e) => events.push(e),
    });

    await runner.run();
    assert.ok(sizes.length > 5);
    const over = sizes.filter((n) => n > 6 * 1024);
    assert.deepEqual(over, [], 'no context block may exceed the 6 KB budget');
    // Since the fair-share cap landed, large turns are cut to their share rather
    // than dropped — so the honest signal is either one, never neither.
    assert.ok(
      events.some((e) => e.type === 'context.dropped' || e.type === 'context.truncated'),
      'a block that had to be cut must say so',
    );
  });

  await checkAsync('runner: the snapshot slice reaches the dispatch request', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    const seen = [];
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => {
        seen.push({ role: req.participant.role, snapshot: req.snapshotText });
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
        };
      },
      snapshot: {
        sliceFor: async (planText, role) => (role === 'debater' ? '' : `### code for ${role}`),
      },
    });
    await runner.run();

    const planner = seen.find((s) => s.role === 'planner');
    const auditor = seen.find((s) => s.role === 'auditor');
    const debater = seen.find((s) => s.role === 'debater');
    assert.equal(planner.snapshot, '### code for planner');
    assert.equal(auditor.snapshot, '### code for auditor');
    assert.equal(debater.snapshot, '', 'a debater is sent no slice');
  });

  await checkAsync('runner: the planner is given the objection ids it must answer', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 2 });
    const seen = [];
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 2,
      dispatch: async (req) => {
        seen.push({ role: req.participant.role, round: req.round, objections: req.objectionsText });
        if (req.participant.role === 'auditor' && req.round === 1) {
          return { settledBy: 'sentinel', text: 'No rollback.\n[[OBJECTION: no down migration | high]]' };
        }
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn(`# p${req.round}`) : `r${req.round}\n[[REPLY]]`,
        };
      },
    });
    await runner.run();

    const plannerLater = seen.find((s) => s.role === 'planner' && s.round === 2);
    assert.match(plannerLater.objections, /obj-1-1: no down migration/,
      'the planner must be shown the id, or a resolutions block cannot match');
    assert.ok(
      seen.filter((s) => s.role === 'debater').every((s) => s.objections === ''),
      'a debater is not given the objection list',
    );
  });

  /* ------------------------------------------- D11/D12: the researched decisions */

  check('stall: a short agreement said twice is not a stall', () => {
    const { normalisedLength, STALL_MIN_CHARS } = require('../bridge/dist/runtime/questions.js');
    const short = 'No objection to this revision. The plan looks right to me.';
    assert.ok(normalisedLength(short) < STALL_MIN_CHARS, 'the floor must exclude this');
  });

  check('stall: trigrams tell a paraphrase from a repeat', () => {
    const { jaccard } = require('../bridge/dist/runtime/questions.js');
    const a = 'the migration must be reversible because the deploy can fail halfway through the rollback window';
    const repeat = a;
    const paraphrase = 'because a deploy can fail halfway through the rollback window the migration must be reversible';
    assert.ok(jaccard(a, repeat) === 1, 'an exact repeat is 1');
    // Same vocabulary, different order — the case a word-set comparison got wrong.
    assert.ok(jaccard(a, paraphrase) < 0.85, `a paraphrase scored ${jaccard(a, paraphrase)}`);
  });

  check('consensus: agreement from one provider is reported as correlated', () => {
    const { consensusCorrelation } = require('../bridge/dist/runtime/scheduler.js');
    const participants = [
      { index: 0, providers: ['claude'] },
      { index: 1, providers: ['claude'] },
      { index: 2, providers: ['chatgpt'] },
    ];
    const same = consensusCorrelation([0, 1], participants);
    assert.equal(same.correlated, true, 'two claude votes are one opinion sampled twice');
    assert.deepEqual(same.providers, ['claude']);

    const mixed = consensusCorrelation([0, 2], participants);
    assert.equal(mixed.correlated, false, 'two providers is real agreement');
    assert.equal(mixed.providers.length, 2);

    // A single voter is never "correlated agreement" — it is just one vote.
    assert.equal(consensusCorrelation([0], participants).correlated, false);
  });

  /* --------------------------------------------- batch 13: the delta transport */

  await checkAsync('delta: a participant is not re-sent messages it has already read', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 3 });
    const seen = [];
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 3,
      dispatch: async (req) => {
        seen.push({ p: req.participant.index, round: req.round, context: req.contextText, plan: req.planText });
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner'
            ? plannerTurn(`# p${req.round} PLANNER-${req.round}`)
            : `MARK-${req.round}-by-${req.participant.index}\n[[REPLY]]`,
        };
      },
    });
    await runner.run();

    const auditor = seen.filter((s) => s.p === 1);
    assert.ok(auditor.length >= 2, 'the auditor must have had at least two turns');

    // Its second turn must not repeat what it already read. Turns that arrived
    // after its own are new to it and must still be sent — the delta is per
    // participant, not per round.
    const second = auditor[1];
    assert.ok(!second.context.includes('PLANNER-1'), 'the planner turn it already read was re-sent');
    assert.ok(second.context.includes('MARK-1-by-2'), 'but turns it had not yet seen must arrive');
    assert.ok(second.context.includes('PLANNER-2'), 'and so must the new planner turn');
  });

  await checkAsync('delta: a retried turn carries the change, not the plan again', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 2 });
    const seen = [];
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 2,
      dispatch: async (req) => {
        seen.push({ p: req.participant.index, role: req.participant.role, round: req.round, plan: req.planText });
        if (req.participant.index === 2 && !req.retry) {
          // First attempt: no token at all, so the runner retries.
          return { settledBy: 'sentinel', text: 'nothing useful' };
        }
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn(`# p${req.round}`) : `ok ${req.round}\n[[REPLY]]`,
        };
      },
    });
    await runner.run();

    // The plan changes every round, so the only turn that can see an unchanged one
    // is a retry — and a retry is exactly where re-sending everything hurts.
    const one = seen.filter((s) => s.role === 'debater' && s.p === 2);
    assert.ok(one.length >= 2, `expected a retry by participant 2, got ${one.length}`);
    assert.match(one[0].plan, /# p/, 'the first attempt must carry the plan');
    assert.match(one[1].plan, /unchanged/, 'the retry must be told the plan has not moved');
    assert.ok(!one[1].plan.includes('# p'), 'and must not re-send the body');
  });

  await checkAsync('delta: the planner always receives the plan it is revising', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 2 });
    const plans = [];
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 2,
      dispatch: async (req) => {
        if (req.participant.role === 'planner') plans.push(req.planText);
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn(`# p${req.round}`) : `ok ${req.round}\n[[REPLY]]`,
        };
      },
    });
    await runner.run();

    assert.ok(plans.length >= 2, 'the planner must have had several turns');
    assert.match(plans[1], /# p/, 'a planner must never be told the plan is unchanged');
  });

  /* ------------------------------------------------------ batch 9: sign-in */

  check('login: the backoff is 3s, then x1.5 to a 15s cap', () => {
    const { LoginWait } = require('../bridge/dist/runtime/login.js');
    const wait = new LoginWait({ now: () => 0 });
    const delays = [1, 2, 3, 4, 5, 6].map(() => wait.nextDelayMs());
    assert.deepEqual(delays, [3000, 4500, 6750, 10125, 15000, 15000]);
  });

  check('login: the wait expires at the ceiling, not before', () => {
    const { LoginWait } = require('../bridge/dist/runtime/login.js');
    let clock = 0;
    const wait = new LoginWait({ now: () => clock });
    clock = 4 * 60 * 1000;
    assert.equal(wait.expired(), false, 'four minutes is still a person typing');
    clock = 5 * 60 * 1000;
    assert.equal(wait.expired(), true);
  });

  await checkAsync('login: a sign-in page promotes the tab, waits, and resends the turn', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    let clock = 0;
    let promoted = 0;
    let polls = 0;
    let authFailures = 0;
    const events = [];

    const runner = new SessionRunner({
      root,
      record,
      now: () => clock,
      dispatch: async (req) => {
        // The planner is signed out on its first attempt, then fine.
        if (req.participant.role === 'planner' && authFailures === 0) {
          authFailures += 1;
          throw new Error('EAUTH: chatgpt is showing a sign-in page');
        }
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn(`# p${req.round}`) : `r${req.round}\n[[REPLY]]`,
        };
      },
      login: {
        promote: async () => {
          promoted += 1;
        },
        ready: async () => {
          polls += 1;
          return polls >= 2; // signed in on the second look
        },
        sleep: async (ms) => {
          clock += ms;
        },
      },
      onEvent: (e) => events.push(e),
    });

    const result = await runner.run();
    assert.equal(promoted, 1, 'the tab must be brought to the front exactly once');
    assert.equal(polls, 2, 'and polled until it was ready');
    assert.ok(events.some((e) => e.type === 'login.required'));
    assert.ok(events.some((e) => e.type === 'login.succeeded'));
    assert.notEqual(result.state, 'NEEDS_USER', 'a sign-in must not end the session');
    assert.ok(result.planVersion >= 1, 'and the turn must actually have been sent afterwards');
  });

  await checkAsync('login: nobody signs in, so the participant is degraded and the debate goes on', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    let clock = 0;
    const runner = new SessionRunner({
      root,
      record,
      now: () => clock,
      dispatch: async (req) => {
        if (req.participant.index === 3) throw new Error('EAUTH: gemini needs a sign-in');
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn(`# p${req.round}`) : `r${req.round}\n[[REPLY]]`,
        };
      },
      login: {
        promote: async () => {},
        ready: async () => false,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    });

    const result = await runner.run();
    assert.ok(clock >= 5 * 60 * 1000, 'the ceiling must be reached before giving up');
    assert.equal(result.state, 'BUDGET_EXHAUSTED', 'one unsignable debater must not stop the session');
  });

  /* ------------------------------------------------------- batch 2: the states */

  await checkAsync('questions: an open question turns an agreement into a question', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => {
        if (req.participant.role === 'planner') return { settledBy: 'sentinel', text: plannerTurn('# p', '[[CONSENSUS]]') };
        if (req.participant.role === 'auditor') {
          // Agrees, and asks something only the user can answer.
          return {
            settledBy: 'sentinel',
            text: 'Agreed, but one thing is unresolved.\n\n```questions\nWhich database? | postgres | sqlite\n```\n\n[[CONSENSUS]]',
          };
        }
        return { settledBy: 'sentinel', text: 'ok\n[[CONSENSUS]]' };
      },
    });

    const result = await runner.run();
    assert.equal(result.state, 'NEEDS_USER', 'unanimity over an open question is not an agreement');

    assert.equal(runner.confirmConsensus(), true);
    const out = runner.confirmBundle();
    assert.equal(out.bundle.manifest.questions.total, 1);
    assert.equal(out.bundle.manifest.questions.open, 1);
    assert.match(fs.readFileSync(path.join(out.bundle.dir, 'questions.md'), 'utf8'), /Which database/);
  });

  await checkAsync('resolutions: a planner turn can answer an objection by id', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 3 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => {
        if (req.participant.role === 'planner') {
          const resolutions = req.round >= 2
            ? '\n\n```resolutions\nobj-1-1: added a down migration and a rollback test\n```'
            : '';
          return { settledBy: 'sentinel', text: `${plannerTurn(`# p${req.round}`)}${resolutions}` };
        }
        if (req.participant.role === 'auditor' && req.round === 1) {
          return { settledBy: 'sentinel', text: 'No rollback.\n[[OBJECTION: no down migration | high]]' };
        }
        return { settledBy: 'sentinel', text: 'ok\n[[REPLY]]' };
      },
    });

    const result = await runner.run();
    assert.equal(result.objections.length, 1);
    assert.match(result.objections[0].resolution ?? '', /down migration/,
      'the objection must be resolved by the planner resolutions block');
  });

  await checkAsync('stall: a participant repeating itself twice running halts as STALLED', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => {
        if (req.participant.role === 'planner') {
          return { settledBy: 'sentinel', text: plannerTurn(`# plan for round ${req.round}`) };
        }
        if (req.participant.index === 2) {
          // Byte-identical every round, and long enough to count: a participant that
          // has stopped moving rather than one that simply has nothing to add. The
          // short version of this is a false positive, pinned by the check below.
          return {
            settledBy: 'sentinel',
            text:
              'The migration ordering is wrong because the down migration runs before the index drop, ' +
              'which leaves the foreign key dangling in any partially applied rollback and makes the ' +
              'deploy unrecoverable without a manual fix.\n[[REPLY]]',
          };
        }
        return { settledBy: 'sentinel', text: `round ${req.round} comment ${req.participant.index}\n[[REPLY]]` };
      },
    });

    const result = await runner.run();
    assert.equal(result.state, 'STALLED');
  });

  await checkAsync('stall: a participant with nothing to add does not halt the session', async () => {
    // The false positive D12 removed: a short, identical courtesy reply every round.
    // Halted as STALLED before, which stopped a debate over one participant being
    // terse — the scheduler already has drop rotation for that.
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 3 });
    const runner = new SessionRunner({
      root,
      record,
      roundBudget: 3,
      dispatch: async (req) => {
        if (req.participant.role === 'planner') {
          return { settledBy: 'sentinel', text: plannerTurn(`# plan for round ${req.round}`) };
        }
        if (req.participant.index === 2) {
          return { settledBy: 'sentinel', text: 'I have nothing to add to this plan.\n[[REPLY]]' };
        }
        return { settledBy: 'sentinel', text: `round ${req.round} comment ${req.participant.index}\n[[REPLY]]` };
      },
    });

    const result = await runner.run();
    assert.notEqual(result.state, 'STALLED', 'a terse participant must not halt the debate');
  });

  await checkAsync('wallclock: an exhausted clock halts with the last good plan', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7, wallClockMs: 1000 });
    let clock = 0;
    const runner = new SessionRunner({
      root,
      record,
      now: () => (clock += 10_000),
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
      }),
    });

    const result = await runner.run();
    assert.equal(result.state, 'WALL_CLOCK');
    assert.equal(result.reason, 'WALL_CLOCK');
  });

  await checkAsync('abort: the session reaches ABORTED and says so on disk', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      maxTurns: 2,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
      }),
    });
    await runner.run();
    assert.equal(runner.abort('user changed their mind'), true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(sessionDir(root, record.id), 'session.json'), 'utf8'));
    assert.equal(onDisk.state, 'ABORTED');
    assert.equal(onDisk.reason, 'user changed their mind');
  });

  /* ------------------------------------------- the two blockers the audit found */

  await checkAsync('runner: a degraded participant is written to session.json as degraded', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => {
        if (req.participant.index === 3) throw new Error('ENOTAB');
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
        };
      },
    });
    await runner.run();

    const onDisk = JSON.parse(fs.readFileSync(path.join(sessionDir(root, record.id), 'session.json'), 'utf8'));
    // It used to say HANDSHAKE_PENDING for everyone, forever.
    assert.equal(onDisk.sub['3'], 'DEGRADED', 'the degraded participant must be recorded as such');
    assert.equal(onDisk.sub['0'], 'ACTIVE', 'the others are still dispatchable');
  });

  await checkAsync('bundle: consensus produces all five artifacts with a manifest', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner' ? plannerTurn('# agreed plan', '[[CONSENSUS]]') : 'agreed\n[[CONSENSUS]]',
      }),
    });
    await runner.run();

    const out = runner.confirmBundle({ id: 'snap-1', sha256: 'abc123', capturedAt: 1 });
    assert.equal(out.ok, true);
    const files = fs.readdirSync(out.bundle.dir).sort();
    assert.deepEqual(files, ['manifest.json', 'objections-resolved.md', 'plan.md', 'questions.md', 'transcript.md']);

    const manifest = out.bundle.manifest;
    assert.equal(manifest.state, 'AWAITING_HANDOFF_CONFIRM', 'the state at export time');
    assert.equal(manifest.planIsFrozenAfterConsensus, true);
    assert.equal(manifest.snapshot.sha256, 'abc123', 'the bundle must name the snapshot it was judged against');
    assert.equal(manifest.artifacts.length, 4);
    assert.ok(manifest.artifacts.every((a) => a.sha256.length === 64), 'every artifact is hashed');
    assert.ok(manifest.transcript.shards > 0);
    assert.match(fs.readFileSync(path.join(out.bundle.dir, 'plan.md'), 'utf8'), /agreed plan/);
    assert.match(fs.readFileSync(path.join(out.bundle.dir, 'transcript.md'), 'utf8'), /## Round 1/);
  });

  await checkAsync('bundle: an unanswered objection ships as open, not silently dropped', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.index === 1
          ? 'This will not survive a rollback.\n[[OBJECTION: no down migration | high]]'
          : req.participant.role === 'planner' ? plannerTurn('# p', '[[CONSENSUS]]') : 'ok\n[[CONSENSUS]]',
      }),
    });
    const halted = await runner.run();
    assert.equal(halted.state, 'NEEDS_USER', 'an objection leaves the claim with the user');
    assert.equal(runner.confirmConsensus(), true, 'and the user can accept it');

    const out = runner.confirmBundle();
    assert.equal(out.ok, true);
    assert.equal(out.bundle.manifest.objections.total, 1);
    assert.equal(out.bundle.manifest.objections.open, 1);
    assert.match(fs.readFileSync(path.join(out.bundle.dir, 'objections-resolved.md'), 'utf8'), /\*\*Open\.\*\*/);
  });

  await checkAsync('runner: resume gets a NEEDS_USER session moving again', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    let answered = false;
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => {
        if (req.participant.index === 1 && !answered) {
          answered = true;
          return { settledBy: 'sentinel', text: 'Which db?\n[[ASK_USER: pg or sqlite? | pg | sqlite]]' };
        }
        return {
          settledBy: 'sentinel',
          text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
        };
      },
    });

    const halted = await runner.run();
    assert.equal(halted.state, 'NEEDS_USER');
    const resumed = await runner.resume();
    assert.notEqual(resumed.state, 'NEEDS_USER', 'the session must move on after the user answers');
    assert.ok(resumed.turns > halted.turns);
  });

  await checkAsync('runner: the turn ceiling halts instead of leaving a live session', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      maxTurns: 1,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
      }),
    });
    const result = await runner.run();
    assert.equal(result.state, 'NEEDS_USER');
    assert.equal(result.reason, 'GUARD_TRIPPED');
  });

  await checkAsync('runner: a bundle cannot be confirmed from a state that is not consensus', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 1 });
    const events = [];
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner' ? plannerTurn('# p') : 'ok\n[[REPLY]]',
      }),
      onEvent: (e) => events.push(e),
    });
    await runner.run();
    const out = runner.confirmBundle();
    assert.equal(out.ok, false, 'the budget halt is not a consensus');
    assert.ok(events.some((e) => e.type === 'transition.rejected'),
      'a refused transition must be reported, not swallowed');
  });

  await checkAsync('runner: confirming the build reaches HANDED_OFF and records it', async () => {
    const root = tempRoot();
    const record = newSession(root, { roundBudget: 7 });
    const runner = new SessionRunner({
      root,
      record,
      dispatch: async (req) => ({
        settledBy: 'sentinel',
        text: req.participant.role === 'planner' ? plannerTurn('# p', '[[CONSENSUS]]') : 'ok\n[[CONSENSUS]]',
      }),
    });
    await runner.run();
    assert.equal(runner.confirmBundle().ok, true);
    assert.equal(runner.confirmHandoff(), true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(sessionDir(root, record.id), 'session.json'), 'utf8'));
    assert.equal(onDisk.state, 'HANDED_OFF');
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
