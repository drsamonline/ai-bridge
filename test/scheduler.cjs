#!/usr/bin/env node
/**
 * Scheduler acceptance harness — SPEC v6 §6, §7, §8.
 *
 * The checks that matter here are the ones that were bugs in earlier drafts:
 * a last speaker that degrades mid-turn must still complete the round, a blocked
 * participant must not stall the others, and no participant may be permanently
 * excluded from the context block by the drop rotation.
 */

'use strict';

const assert = require('node:assert');
const sched = require('../bridge/dist/runtime/scheduler.js');

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

const { Scheduler, resolveParticipantProvider, planContextDrops, DEFAULT_ESCALATE_CAP } = sched;

/** planner, auditor and three debaters, each with a declared provider set. */
function roster() {
  return [
    { index: 0, role: 'planner', providers: ['chatgpt'] },
    { index: 1, role: 'auditor', providers: ['sarvam'] },
    { index: 2, role: 'debater', providers: ['claude'] },
    { index: 3, role: 'debater', providers: ['gemini'] },
    { index: 4, role: 'debater', providers: ['chatgpt', 'claude'] },
  ];
}

/** Speak one full round in roster order. */
function runRound(s, token = 'REPLY') {
  for (const p of [0, 1, 2, 3, 4]) {
    if (s.snapshot().statuses[p] !== 'active') continue;
    s.completeTurn(p, token);
  }
}

console.log('');

/* ------------------------------------------------------------ turn order */

check('sched: the first speaker is the planner, in roster order', () => {
  const s = new Scheduler({ participants: roster() });
  assert.equal(s.nextSpeaker(), 0);
  assert.deepEqual(s.active(), [0, 1, 2, 3, 4]);
});

check('sched: order is roster order, not the order participants were passed in', () => {
  const shuffled = [roster()[3], roster()[0], roster()[4], roster()[1], roster()[2]];
  const s = new Scheduler({ participants: shuffled });
  assert.equal(s.nextSpeaker(), 0);
  s.completeTurn(0, 'REPLY');
  assert.equal(s.nextSpeaker(), 1);
});

check('sched: a blocked participant is skipped, not waited for', () => {
  const s = new Scheduler({ participants: roster() });
  s.block(2);
  s.completeTurn(0, 'REPLY');
  s.completeTurn(1, 'REPLY');
  assert.equal(s.nextSpeaker(), 3, 'the scheduler must move past a blocked debater');
});

/* --------------------------------------------------------- round completion */

check('sched: a round completes when the last active participant speaks', () => {
  const s = new Scheduler({ participants: roster() });
  assert.equal(s.completeTurn(0, 'REPLY').roundCompleted, false);
  assert.equal(s.completeTurn(1, 'REPLY').roundCompleted, false);
  assert.equal(s.completeTurn(2, 'REPLY').roundCompleted, false);
  assert.equal(s.completeTurn(3, 'REPLY').roundCompleted, false);
  const last = s.completeTurn(4, 'REPLY');
  assert.equal(last.roundCompleted, true);
  assert.equal(s.snapshot().round, 2);
});

check('sched: the last speaker degrading mid-turn still completes the round', () => {
  // This is the v5 hang: completion was evaluated on the turn, nothing re-ran
  // when the participant left the roster, and the round never ended.
  const s = new Scheduler({ participants: roster() });
  s.completeTurn(0, 'REPLY');
  s.completeTurn(1, 'REPLY');
  s.completeTurn(2, 'REPLY');
  s.completeTurn(3, 'REPLY');
  const r = s.degrade(4, 'MALFORMED_RESPONSE');
  assert.equal(r.roundCompleted, true, 'degrading the last speaker must complete the round');
  assert.equal(s.snapshot().round, 2);
});

check('sched: blocking the last speaker completes the round rather than stalling', () => {
  const s = new Scheduler({ participants: roster() });
  s.completeTurn(0, 'REPLY');
  s.completeTurn(1, 'REPLY');
  s.completeTurn(2, 'REPLY');
  s.completeTurn(3, 'REPLY');
  const r = s.block(4);
  // §8 skips blocked participants for completion, so four participants must not
  // wait five minutes for one tab. The block timeout then only changes status.
  assert.equal(r.roundCompleted, true, 'a blocked participant is skipped for completion');
  assert.equal(s.snapshot().round, 2);
  assert.equal(s.degrade(4, 'block timeout').roundCompleted, false, 'the round already moved on');
});

check('sched: a mid-round degrade does not complete the round early', () => {
  const s = new Scheduler({ participants: roster() });
  s.completeTurn(0, 'REPLY');
  const r = s.degrade(1, 'STREAM_TIMEOUT');
  assert.equal(r.roundCompleted, false, 'three participants have still to speak');
  assert.equal(s.nextSpeaker(), 2);
});

/* ------------------------------------------------------------- consensus */

check('sched: consensus needs every active participant in the same round', () => {
  const s = new Scheduler({ participants: roster() });
  for (const p of [0, 1, 2, 3]) s.completeTurn(p, 'CONSENSUS');
  assert.equal(s.consensusReached(), false, 'four of five is not unanimity');
  s.completeTurn(4, 'CONSENSUS');
  assert.equal(s.consensusReached(), true);
});

check('sched: a degraded participant cannot block consensus and is not counted', () => {
  const s = new Scheduler({ participants: roster() });
  s.degrade(4, 'MALFORMED_RESPONSE');
  for (const p of [0, 1, 2, 3]) s.completeTurn(p, 'CONSENSUS');
  assert.equal(s.active().length, 4);
  assert.equal(s.consensusReached(), true, 'the remaining active participants are unanimous');
});

check('sched: one participant claiming consensus is a unilateral claim', () => {
  const s = new Scheduler({ participants: roster() });
  s.completeTurn(0, 'CONSENSUS');
  assert.equal(s.consensusReached(), false);
  assert.equal(s.unilateralClaim(), 0);
});

check('sched: a roster reduced to one cannot declare unanimous consensus', () => {
  const s = new Scheduler({ participants: roster() });
  for (const p of [1, 2, 3, 4]) s.degrade(p, 'STREAM_TIMEOUT');
  assert.deepEqual(s.active(), [0]);
  s.completeTurn(0, 'CONSENSUS');
  assert.equal(s.consensusReached(), false, 'one vote is not a quorum');
});

check('sched: the completed round consensus is readable, and does not leak', () => {
  const s = new Scheduler({ participants: roster() });
  for (const p of [0, 1, 2, 3, 4]) s.completeTurn(p, 'CONSENSUS');
  assert.equal(s.snapshot().round, 2);
  // The caller evaluates consensus after the last turn, so it must survive the
  // round completing. Clearing it there made the result unreadable exactly when
  // it mattered.
  assert.equal(s.consensusReached(), true, 'the finished round is still readable');
  s.completeTurn(0, 'REPLY');
  assert.deepEqual(s.snapshot().consensus, [], 'the next round starts with no agreements');
  assert.equal(s.consensusReached(), false);
});

/* ---------------------------------------------------------------- budget */

check('sched: the budget halts after the seventh round, not during it', () => {
  const s = new Scheduler({ participants: roster(), roundBudget: 7 });
  for (let i = 0; i < 6; i += 1) runRound(s);
  assert.equal(s.budgetPhase(), 'running');
  runRound(s);
  assert.equal(s.budgetPhase(), 'reservation', 'round 7 buys one forced planner turn before the halt');
  assert.equal(s.snapshot().reservationUsed, true);
});

check('sched: the reservation turn goes to the planner and then the budget is exhausted', () => {
  const s = new Scheduler({ participants: roster(), roundBudget: 2 });
  runRound(s);
  runRound(s);
  assert.equal(s.budgetPhase(), 'reservation');
  assert.equal(s.nextSpeaker(), 0, 'the reservation is a planner turn');
  s.completeTurn(0, 'REPLY');
  runRound(s);
  assert.equal(s.budgetPhase(), 'exhausted');
  assert.equal(s.nextSpeaker(), null, 'an exhausted budget schedules nobody');
});

check('sched: a degraded planner cannot take the reservation turn', () => {
  const s = new Scheduler({ participants: roster(), roundBudget: 1 });
  runRound(s);
  assert.equal(s.budgetPhase(), 'reservation');
  s.degrade(0, 'MALFORMED_RESPONSE');
  assert.equal(s.nextSpeaker(), null, 'the caller must raise PLANNER_DEGRADED, not loop');
});

check('sched: an accepted escalation buys a round; the cap counts both outcomes', () => {
  const s = new Scheduler({ participants: roster() });
  assert.equal(DEFAULT_ESCALATE_CAP, 3);
  assert.deepEqual(s.escalate(true), { applied: true, escalates: 1 });
  assert.equal(s.snapshot().budget, 8);
  assert.deepEqual(s.escalate(false), { applied: true, escalates: 2 });
  assert.equal(s.snapshot().budget, 8, 'a rejected escalation buys nothing');
  assert.equal(s.escalate(true).applied, true);
  assert.equal(s.snapshot().budget, 9);
  assert.equal(s.escalate(true).applied, false, 'the fourth is refused');
  assert.equal(s.snapshot().budget, 9);
});

check('sched: a user force-round is unbounded and revives an exhausted budget', () => {
  const s = new Scheduler({ participants: roster(), roundBudget: 1 });
  runRound(s);
  s.completeTurn(0, 'REPLY');
  runRound(s);
  assert.equal(s.budgetPhase(), 'exhausted');
  s.forceRound();
  assert.equal(s.budgetPhase(), 'running');
  assert.equal(s.nextSpeaker(), 0, 'a forced round puts the roster back to work');
  for (let i = 0; i < 20; i += 1) s.forceRound();
  assert.equal(s.snapshot().escalates, 0, 'force-round must not consume the escalation cap');
});

/* ------------------------------------------------------- participant-boundary */

check('failover: a participant fails over inside its own declared set', () => {
  const p = { index: 4, role: 'debater', providers: ['chatgpt', 'claude'] };
  const first = resolveParticipantProvider(p, () => true);
  assert.equal(first.ok, true);
  assert.equal(first.provider, 'chatgpt', 'the primary is tried first');

  const second = resolveParticipantProvider(p, (id) => id !== 'chatgpt');
  assert.equal(second.ok, true);
  assert.equal(second.provider, 'claude', 'the declared fallback is used next');
  assert.deepEqual(second.attempted, ['chatgpt', 'claude']);
});

check('failover: an exhausted set blocks the participant rather than changing the model', () => {
  const p = { index: 2, role: 'debater', providers: ['claude'] };
  const r = resolveParticipantProvider(p, () => false);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PROVIDER_SET_EXHAUSTED');
  assert.deepEqual(r.attempted, ['claude'], 'it must not reach for a provider outside the set');
});

check('failover: a participant never borrows another participant provider', () => {
  const rosterP = roster();
  const r = resolveParticipantProvider(rosterP[2], (id) => id !== 'claude');
  assert.equal(r.ok, false, 'gemini is available but not in participant 2 set');
  assert.deepEqual(r.attempted, ['claude']);
});

/* ------------------------------------------------------------ drop rotation */

check('context: nothing is dropped when the block fits', () => {
  const msgs = [
    { participant: 1, round: 1, chars: 100, seq: 1 },
    { participant: 2, round: 1, chars: 100, seq: 2 },
  ];
  const plan = planContextDrops(msgs, 1000);
  assert.equal(plan.dropped.length, 0);
  assert.equal(plan.keep.length, 2);
});

check('context: the oldest message of the largest contributor goes first', () => {
  const msgs = [
    { participant: 1, round: 1, chars: 300, seq: 1 },
    { participant: 2, round: 1, chars: 300, seq: 2 },
    { participant: 2, round: 2, chars: 300, seq: 3 },
    { participant: 2, round: 3, chars: 300, seq: 4 },
  ];
  const plan = planContextDrops(msgs, 700);
  assert.equal(plan.dropped.length, 2);
  assert.deepEqual(plan.dropped.map((m) => m.participant), [2, 2]);
  assert.deepEqual(plan.dropped.map((m) => m.round), [1, 2], 'oldest first, from the heaviest');
});

check('context: the participant dropped last turn is skipped this turn', () => {
  const msgs = [
    { participant: 1, round: 1, chars: 300, seq: 1 },
    { participant: 2, round: 1, chars: 300, seq: 2 },
  ];
  const plan = planContextDrops(msgs, 300, [1]);
  assert.equal(plan.dropped[0].participant, 2, 'participant 1 lost a message last turn');
});

check('context: the rotation is abandoned when skipping cannot reach the budget', () => {
  const msgs = [
    { participant: 1, round: 1, chars: 300, seq: 1 },
    { participant: 1, round: 2, chars: 300, seq: 2 },
  ];
  const plan = planContextDrops(msgs, 300, [1]);
  assert.equal(plan.rotationIgnored, true, 'the budget beats the rotation, and says so');
  assert.ok(plan.dropped.length > 0);
});

check('context: no participant is systematically excluded over ten turns', () => {
  // Five participants, three messages each, a cap that forces two drops a turn.
  // Asserting on `keep` would be vacuous — thirteen of fifteen messages survive,
  // so everyone is always present. The fairness question is who *loses*.
  let skip = null;
  const losses = new Map();
  for (let turn = 0; turn < 10; turn += 1) {
    const msgs = [];
    for (let p = 1; p <= 5; p += 1) {
      for (let r = 1; r <= 3; r += 1) msgs.push({ participant: p, round: r, chars: 100, seq: p * 10 + r });
    }
    const plan = planContextDrops(msgs, 1300, skip);
    skip = plan.skip;
    for (const p of new Set(plan.dropped.map((m) => m.participant))) {
      losses.set(p, (losses.get(p) ?? 0) + 1);
    }
  }
  for (const [participant, count] of losses) {
    assert.ok(count <= 6, `participant ${participant} lost a message in ${count} of 10 turns`);
  }
  assert.ok(losses.size >= 2, 'the rotation must spread the losses, not concentrate them');
});

check('context: the plan is deterministic for identical input', () => {
  const msgs = [
    { participant: 1, round: 1, chars: 200, seq: 1 },
    { participant: 2, round: 1, chars: 200, seq: 2 },
    { participant: 3, round: 1, chars: 200, seq: 3 },
  ];
  const a = planContextDrops(msgs, 400);
  const b = planContextDrops([...msgs].reverse(), 400);
  assert.deepEqual(a.dropped.map((m) => m.seq), b.dropped.map((m) => m.seq), 'input order must not change the outcome');
});

console.log('');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
