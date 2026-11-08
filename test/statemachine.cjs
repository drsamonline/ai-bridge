#!/usr/bin/env node
/**
 * State machine acceptance harness — SPEC v6 §9, one check per row.
 *
 * The point of this suite is not that the happy path works. It is that the table
 * is *total*: every (state, event) pair either transitions or is explicitly
 * rejected, and no pair silently returns the state it started in. A silent no-op
 * is how a session hangs without anyone noticing, which is the failure mode the
 * whole v3→v6 review kept finding.
 */

'use strict';

const assert = require('node:assert');
const sm = require('../bridge/dist/runtime/stateMachine.js');

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

const { transition, participantTransition, ALL_STATES, HALT_CLASS, isTerminal, isUserGated,
        isRequiredRole, quorumReached, MIN_QUORUM } = sm;

/** A representative event for every member of the union. */
const SAMPLE = {
  'session.create': { type: 'session.create' },
  'preamble.sent': { type: 'preamble.sent', participant: 0 },
  'login.required': { type: 'login.required', participant: 0 },
  'ram.exceeded': { type: 'ram.exceeded' },
  'handshake.ready': { type: 'handshake.ready' },
  'handshake.failed': { type: 'handshake.failed', participant: 0, role: 'debater' },
  'login.succeeded': { type: 'login.succeeded', participant: 0 },
  'login.ceiling': { type: 'login.ceiling', participant: 0, role: 'debater' },
  'storage.failed': { type: 'storage.failed', path: '/tmp/x' },
  'round.reservation': { type: 'round.reservation' },
  'round.exhausted': { type: 'round.exhausted' },
  'consensus.unanimous': { type: 'consensus.unanimous' },
  'consensus.unilateral': { type: 'consensus.unilateral', participant: 1 },
  'ask.user': { type: 'ask.user', participant: 1 },
  'stall.detected': { type: 'stall.detected', participant: 1 },
  'wallclock.exhausted': { type: 'wallclock.exhausted' },
  'tab.lost': { type: 'tab.lost', participant: 2 },
  'participant.degraded': { type: 'participant.degraded', participant: 2, role: 'debater', reason: 'x' },
  'settle.timeout': { type: 'settle.timeout', participant: 2, role: 'debater' },
  escalate: { type: 'escalate', participant: 1, accepted: true },
  'user.resume': { type: 'user.resume' },
  'user.decline.consensus': { type: 'user.decline.consensus' },
  'user.confirm.consensus': { type: 'user.confirm.consensus' },
  'user.force.round': { type: 'user.force.round' },
  'user.freeze': { type: 'user.freeze' },
  'user.abort': { type: 'user.abort' },
  'user.confirm.bundle': { type: 'user.confirm.bundle' },
  'handoff.confirmed': { type: 'handoff.confirmed' },
  'handoff.expired': { type: 'handoff.expired' },
  'participant.restored': { type: 'participant.restored', participant: 2 },
  'block.timeout': { type: 'block.timeout', participant: 2 },
  'reattach.passed': { type: 'reattach.passed', participant: 2 },
  'reattach.failed': { type: 'reattach.failed', participant: 2 },
  'session.selected': { type: 'session.selected' },
};

console.log('');

/* ------------------------------------------------------------- the happy path */

check('sm: create → handshake → active', () => {
  let r = transition('IDLE', SAMPLE['session.create']);
  assert.equal(r.ok, true);
  assert.equal(r.state, 'INITIALIZING');
  r = transition(r.state, SAMPLE['preamble.sent']);
  assert.equal(r.state, 'HANDSHAKE_PENDING');
  r = transition(r.state, SAMPLE['handshake.ready']);
  assert.equal(r.state, 'ACTIVE');
});

check('sm: create is only valid from IDLE', () => {
  assert.equal(transition('ACTIVE', SAMPLE['session.create']).ok, false);
  assert.equal(transition('HANDSHAKE_PENDING', SAMPLE['session.create']).ok, false);
});

check('sm: a login requirement routes through AWAITING_LOGIN and back', () => {
  let r = transition('INITIALIZING', SAMPLE['login.required']);
  assert.equal(r.state, 'AWAITING_LOGIN');
  r = transition(r.state, SAMPLE['login.succeeded']);
  assert.equal(r.state, 'HANDSHAKE_PENDING');
  r = transition(r.state, SAMPLE['handshake.ready']);
  assert.equal(r.state, 'ACTIVE');
});

/* ------------------------------------------------- required roles vs debaters */

check('sm: a required role failing handshake asks the user, it does not hang', () => {
  const planner = transition('HANDSHAKE_PENDING', { type: 'handshake.failed', participant: 0, role: 'planner' });
  assert.equal(planner.ok, true);
  assert.equal(planner.state, 'NEEDS_USER');
  assert.equal(planner.reason, 'PLANNER_DEGRADED');

  const auditor = transition('HANDSHAKE_PENDING', { type: 'handshake.failed', participant: 1, role: 'auditor' });
  assert.equal(auditor.reason, 'AUDITOR_DEGRADED');
});

check('sm: a debater failing handshake leaves the session handshaking', () => {
  const r = transition('HANDSHAKE_PENDING', { type: 'handshake.failed', participant: 3, role: 'debater' });
  assert.equal(r.ok, true);
  assert.equal(r.state, 'HANDSHAKE_PENDING');
  assert.equal(r.participant, 3);
});

check('sm: the login ceiling degrades a debater but aborts on a required role', () => {
  const debater = transition('AWAITING_LOGIN', { type: 'login.ceiling', participant: 3, role: 'debater' });
  assert.equal(debater.state, 'AWAITING_LOGIN');
  assert.equal(debater.reason, undefined);

  const planner = transition('AWAITING_LOGIN', { type: 'login.ceiling', participant: 0, role: 'planner' });
  assert.equal(planner.state, 'ABORTED');
  assert.equal(planner.reason, 'AUTH_BLOCKED');
});

check('sm: a settle timeout degrades a debater and escalates a required role', () => {
  const debater = transition('ACTIVE', { type: 'settle.timeout', participant: 3, role: 'debater' });
  assert.equal(debater.state, 'ACTIVE');
  assert.match(debater.note, /DEGRADED/);

  const auditor = transition('ACTIVE', { type: 'settle.timeout', participant: 1, role: 'auditor' });
  assert.equal(auditor.state, 'NEEDS_USER');
  assert.equal(auditor.reason, 'STREAM_TIMEOUT');
});

check('sm: a degraded planner blocks consensus rather than shipping a stale plan', () => {
  const r = transition('ACTIVE', { type: 'participant.degraded', participant: 0, role: 'planner', reason: 'MALFORMED_RESPONSE' });
  assert.equal(r.state, 'NEEDS_USER');
  assert.equal(r.reason, 'PLANNER_DEGRADED');
});

/* ------------------------------------------------------------------- budget */

check('sm: an accepted escalation buys one round; a rejected one buys nothing', () => {
  const yes = transition('ACTIVE', { type: 'escalate', participant: 2, accepted: true });
  assert.equal(yes.state, 'ACTIVE');
  assert.equal(yes.budgetDelta, 1);
  assert.equal(yes.escalateDelta, undefined);

  const refused = transition('ACTIVE', { type: 'escalate', participant: 2, accepted: false });
  assert.equal(refused.budgetDelta, undefined);
  assert.equal(refused.escalateDelta, 1);
});

check('sm: the reserved planner turn runs inside ACTIVE, then the budget halts', () => {
  const r = transition('ACTIVE', SAMPLE['round.reservation']);
  assert.equal(r.state, 'ACTIVE');
  const halt = transition(r.state, SAMPLE['round.exhausted']);
  assert.equal(halt.state, 'BUDGET_EXHAUSTED');
  assert.equal(halt.reason, 'BUDGET_EXHAUSTED');
});

/* -------------------------------------------------------------- consensus */

check('sm: unanimous consensus stops; a unilateral claim becomes a question', () => {
  const u = transition('ACTIVE', SAMPLE['consensus.unanimous']);
  assert.equal(u.state, 'CONSENSUS');
  assert.equal(u.reason, 'CONSENSUS');

  const one = transition('ACTIVE', SAMPLE['consensus.unilateral']);
  assert.equal(one.state, 'NEEDS_USER');
  assert.match(one.note, /unilateral/);
});

check('sm: the quorum floor refuses a single-participant consensus', () => {
  assert.equal(MIN_QUORUM, 2);
  assert.equal(quorumReached(1, 1), false, 'one active participant must not be a quorum');
  assert.equal(quorumReached(2, 2), true);
  assert.equal(quorumReached(3, 2), false);
});

/* ------------------------------------------------------------- user gates */

check('sm: every user gate has an exit and only from where it is valid', () => {
  assert.equal(transition('NEEDS_USER', SAMPLE['user.resume']).state, 'ACTIVE');
  assert.equal(transition('STALLED', SAMPLE['user.resume']).state, 'ACTIVE');

  const forced = transition('BUDGET_EXHAUSTED', SAMPLE['user.force.round']);
  assert.equal(forced.state, 'ACTIVE');
  assert.equal(forced.budgetDelta, 1);

  assert.equal(transition('WALL_CLOCK', SAMPLE['user.freeze']).state, 'CONSENSUS');
  assert.equal(transition('WALL_CLOCK', SAMPLE['user.decline.consensus']).state, 'ACTIVE');
  assert.equal(transition('NEEDS_USER', SAMPLE['user.confirm.consensus']).state, 'CONSENSUS');

  // and the same events are refused from states where they mean nothing
  assert.equal(transition('ACTIVE', SAMPLE['user.freeze']).ok, false);
  assert.equal(transition('ACTIVE', SAMPLE['user.force.round']).ok, false);
  assert.equal(transition('CONSENSUS', SAMPLE['user.resume']).ok, false);
});

check('sm: handoff has exactly one entry and two ways out', () => {
  const pending = transition('CONSENSUS', SAMPLE['user.confirm.bundle']);
  assert.equal(pending.state, 'AWAITING_HANDOFF_CONFIRM');
  assert.equal(transition(pending.state, SAMPLE['handoff.confirmed']).state, 'HANDED_OFF');
  assert.equal(transition(pending.state, SAMPLE['handoff.expired']).state, 'HANDED_OFF');
  assert.equal(transition('CONSENSUS', SAMPLE['handoff.confirmed']).ok, false);
});

check('sm: a wall clock that runs out is a state, not a forced consensus', () => {
  const r = transition('ACTIVE', SAMPLE['wallclock.exhausted']);
  assert.equal(r.state, 'WALL_CLOCK');
  assert.equal(isUserGated(r.state), true, 'WALL_CLOCK must have no timeout of its own');
});

/* ------------------------------------------------------ universal transitions */

check('sm: a storage failure aborts from every live state', () => {
  for (const state of ALL_STATES) {
    if (isTerminal(state)) continue;
    const r = transition(state, { type: 'storage.failed', path: '/sessions/x/tx/1-0-1.json' });
    assert.equal(r.ok, true, `${state} refused storage.failed`);
    assert.equal(r.state, 'ABORTED', `${state} did not abort`);
    assert.equal(r.reason, 'STORAGE_FULL');
  }
});

check('sm: a user abort works from every live state', () => {
  for (const state of ALL_STATES) {
    if (isTerminal(state)) continue;
    const r = transition(state, SAMPLE['user.abort']);
    assert.equal(r.state, 'ABORTED', `${state} refused an abort`);
  }
});

check('sm: terminal states accept nothing at all', () => {
  for (const state of ['HANDED_OFF', 'ABORTED']) {
    for (const [name, event] of Object.entries(SAMPLE)) {
      const r = transition(state, event);
      assert.equal(r.ok, false, `${state} accepted ${name}`);
      assert.match(r.rejected, /terminal/);
    }
  }
});

check('sm: tab loss keeps the session ACTIVE so the others keep running', () => {
  const r = transition('ACTIVE', SAMPLE['tab.lost']);
  assert.equal(r.state, 'ACTIVE', 'a lost tab must not stop dispatch to the rest');
  assert.equal(r.participant, 2);
});

check('sm: resume from SUSPENDED puts every participant into REATTACHING', () => {
  const r = transition('SUSPENDED', SAMPLE['session.selected']);
  assert.equal(r.state, 'ACTIVE');
  assert.match(r.note, /REATTACHING/);
  assert.equal(transition('ACTIVE', SAMPLE['session.selected']).ok, false);
});

/* ---------------------------------------------------------------- totality */

check('sm: the table is total — no pair silently returns its own state', () => {
  const silent = [];
  // Staying put is legitimate only for per-participant events and the budget ones,
  // where the session state genuinely does not move.
  const allowed = ['tab.lost', 'participant.degraded', 'settle.timeout', 'escalate',
    'round.reservation', 'block.timeout', 'reattach.passed', 'reattach.failed',
    'participant.restored', 'login.ceiling', 'handshake.failed', 'preamble.sent'];

  for (const state of ALL_STATES) {
    for (const [name, event] of Object.entries(SAMPLE)) {
      const r = transition(state, event);
      assert.equal(typeof r.ok, 'boolean', `${state} + ${name} returned nothing`);
      if (r.ok) {
        assert.ok(ALL_STATES.includes(r.state), `${state} + ${name} → unknown state ${r.state}`);
        if (r.state === state && !allowed.includes(name)) silent.push(`${state} + ${name}`);
      } else {
        assert.equal(typeof r.rejected, 'string');
        assert.ok(r.rejected.length > 0, `${state} + ${name} rejected with no reason`);
      }
    }
  }
  assert.deepEqual(silent, [], `transitions that silently stayed put: ${silent.join(', ')}`);
});

check('sm: all four halt classes are represented and each stop lands in one', () => {
  const { classOf, CONFIGURATION_REJECTIONS, TRANSIENT_SUB_STATES } = sm;
  const seen = new Set();

  for (const [reason, cls] of Object.entries(HALT_CLASS)) {
    assert.ok(['terminal', 'user-gated'].includes(cls), `${reason} is a reason but filed as ${cls}`);
    assert.equal(classOf(reason), cls);
    seen.add(cls);
  }
  for (const sub of TRANSIENT_SUB_STATES) {
    assert.equal(classOf(sub), 'transient', `${sub} is not transient`);
    seen.add('transient');
  }
  for (const code of CONFIGURATION_REJECTIONS) {
    assert.equal(classOf(code), 'configuration', `${code} is not a configuration rejection`);
    seen.add('configuration');
  }
  assert.deepEqual([...seen].sort(), ['configuration', 'terminal', 'transient', 'user-gated'],
    'the four classes must all be reachable');
});

check('sm: the roles the session cannot lose are the two required ones', () => {
  assert.equal(isRequiredRole('planner'), true);
  assert.equal(isRequiredRole('auditor'), true);
  assert.equal(isRequiredRole('debater'), false);
});

/* ------------------------------------------------------------- sub-states */

check('sm: a participant survives block → reattach → active', () => {
  let r = participantTransition('ACTIVE', { type: 'tab.lost' });
  assert.equal(r.sub, 'BLOCKED');
  r = participantTransition(r.sub, { type: 'restored' });
  assert.equal(r.sub, 'REATTACHING');
  r = participantTransition(r.sub, { type: 'reattach.passed' });
  assert.equal(r.sub, 'ACTIVE');
});

check('sm: a block that times out degrades rather than waiting forever', () => {
  const r = participantTransition('BLOCKED', { type: 'block.timeout' });
  assert.equal(r.sub, 'DEGRADED');
  assert.equal(participantTransition('ACTIVE', { type: 'block.timeout' }).ok, false);
});

check('sm: [[READY]] is only accepted where it is valid', () => {
  assert.equal(participantTransition('HANDSHAKE_PENDING', { type: 'ready' }).sub, 'ACTIVE');
  assert.equal(participantTransition('REATTACHING', { type: 'ready' }).sub, 'ACTIVE');
  assert.equal(participantTransition('ACTIVE', { type: 'ready' }).ok, false);
});

console.log('');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
