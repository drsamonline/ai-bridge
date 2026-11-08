#!/usr/bin/env node
/**
 * Turn payload acceptance harness — SPEC v6 §7.
 *
 * The payload is what a participant actually reads, so the checks are about
 * meaning rather than bytes: the plan comes first because it is what the turn is
 * about, the role line and the suffix come last because a model reads anything
 * after the plan as part of it, and the per-item caps are the spec's numbers
 * rather than whatever the caller happened to pass.
 */

'use strict';

const assert = require('node:assert');
const { buildPayload, PAYLOAD_CAPS, ROLE_LINE, PROTOCOL_SUFFIX } = require('../bridge/dist/runtime/payload.js');

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

const base = (over = {}) => ({
  role: 'planner',
  planText: '# Plan v1\n- do the thing',
  contextText: '[round 1 | participant 1] an objection',
  questionsText: '- Which database?',
  snapshotText: '### src/ports.ts\nexport interface FsPort {}',
  ...over,
});

console.log('');

check('payload: the blocks arrive in §7 order, fenced by name', () => {
  const p = buildPayload(base());
  const order = ['```plan', '```context', '```questions', '```snapshot'];
  const positions = order.map((tag) => p.text.indexOf(tag));
  assert.ok(positions.every((n) => n >= 0), `missing a block: ${p.text}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'blocks are out of order');
  assert.ok(p.text.includes('- do the thing'));
  assert.ok(p.text.includes('export interface FsPort'));
});

check('payload: the role line and the suffix come last', () => {
  const p = buildPayload(base());
  assert.ok(p.text.trimEnd().endsWith(PROTOCOL_SUFFIX), 'the suffix must be the last thing read');
  assert.ok(p.text.indexOf(ROLE_LINE.planner) > p.text.indexOf('```snapshot'));
});

check('payload: each role is told what its job is', () => {
  for (const role of ['planner', 'auditor', 'debater']) {
    const p = buildPayload(base({ role }));
    assert.ok(p.text.includes(ROLE_LINE[role]), `${role} was not told its job`);
  }
  assert.match(ROLE_LINE.planner, /revise/i);
  assert.match(ROLE_LINE.auditor, /audit/i);
  assert.match(ROLE_LINE.debater, /critique/i);
});

check('payload: the caps are §7 numbers, in one place', () => {
  assert.equal(PAYLOAD_CAPS.planner.snapshot, 15 * 1024);
  assert.equal(PAYLOAD_CAPS.auditor.snapshot, 30 * 1024, 'the auditor gets twice the planner slice');
  assert.equal(PAYLOAD_CAPS.debater.snapshot, 0, 'a debater is not shown the code');
  assert.equal(PAYLOAD_CAPS.auditor.context, 2 * 1024, 'and a smaller context block');
});

check('payload: a debater is sent no code at all', () => {
  const p = buildPayload(base({ role: 'debater', snapshotText: '### secret.ts\nSECRET' }));
  assert.ok(!p.text.includes('SECRET'), 'the snapshot must not reach a debater');
  assert.ok(!p.text.includes('```snapshot'), 'and not even an empty fence');
});

check('payload: an empty block is omitted rather than fenced empty', () => {
  const p = buildPayload(base({ questionsText: '', snapshotText: '   ' }));
  assert.ok(!p.text.includes('```questions'));
  assert.ok(!p.text.includes('```snapshot'));
  assert.ok(p.text.includes('```plan'), 'the blocks that have content still arrive');
});

check('payload: an oversized block is cut to its cap and reported', () => {
  const huge = 'x'.repeat(PAYLOAD_CAPS.planner.plan + 5000);
  const p = buildPayload(base({ planText: huge }));
  const plan = p.blocks.find((b) => b.name === 'plan');
  assert.equal(plan.truncated, true);
  assert.ok(plan.bytes <= PAYLOAD_CAPS.planner.plan);
  assert.equal(p.truncated, true, 'the caller must be able to see that it happened');
});

check('payload: cutting never leaves a broken character', () => {
  // A multi-byte character straddling the cap must not become U+FFFD.
  const text = 'é'.repeat(PAYLOAD_CAPS.planner.plan);
  const p = buildPayload(base({ planText: text }));
  assert.ok(!p.text.includes('\uFFFD'), 'a replacement character reached the payload');
});

check('payload: the auditor gets more code and less conversation than the planner', () => {
  const plan = '# p';
  // Fits the planner's 6 KB cap and overflows the auditor's 2 KB one.
  const context = 'y'.repeat(PAYLOAD_CAPS.planner.context - 100);
  const snapshot = 'z'.repeat(PAYLOAD_CAPS.auditor.snapshot - 100);

  const asPlanner = buildPayload(base({ role: 'planner', planText: plan, contextText: context, snapshotText: snapshot }));
  const asAuditor = buildPayload(base({ role: 'auditor', planText: plan, contextText: context, snapshotText: snapshot }));

  const ctx = (p) => p.blocks.find((b) => b.name === 'context');
  const snap = (p) => p.blocks.find((b) => b.name === 'snapshot');
  assert.ok(snap(asAuditor).bytes > snap(asPlanner).bytes, 'the auditor sees more of the code');
  assert.ok(ctx(asAuditor).bytes < ctx(asPlanner).bytes, 'and less of the conversation');
  assert.equal(ctx(asAuditor).truncated, true);
  assert.equal(ctx(asPlanner).truncated, false, 'the planner context fits its larger cap');
});

check('payload: a retry says so, and says it where it will be read', () => {
  const normal = buildPayload(base());
  const retry = buildPayload(base({ retry: true }));
  assert.ok(!normal.text.includes('RETRY'));
  assert.match(retry.text, /RETRY/);
  assert.ok(retry.text.trimEnd().endsWith(PROTOCOL_SUFFIX), 'the retry line is not the suffix');
});

check('payload: an empty turn is still a valid message', () => {
  const p = buildPayload({ role: 'planner', planText: '', contextText: '', questionsText: '', snapshotText: '' });
  assert.ok(p.text.includes(PROTOCOL_SUFFIX), 'a participant must still be told how to end its turn');
  assert.ok(p.bytes > 0);
});

console.log('');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
