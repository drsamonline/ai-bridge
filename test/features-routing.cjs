#!/usr/bin/env node
/**
 * Batch 8.3 acceptance harness — per-feature model routing.
 *
 * Acceptance: "a commit message never burns the chat model's quota; a model that
 * is unfit for chat still serves commits, fixes and suggestions."
 *
 * The commit path is exercised against a real throwaway git repository, so the
 * diff is a real diff and not a fixture that happens to match a regex.
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const features = require('../extension/dist/features/index.js');

const results = [];
let failures = 0;

async function check(name, fn) {
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

const model = (over = {}) => ({
  id: 'm',
  label: 'M',
  isFree: false,
  kind: 'api',
  source: 'ep',
  ...over,
});

/* ------------------------------------------------------------------ routing */

async function main() {
  await check('routing: auto prefers a free model among the fit ones', () => {
    const models = [
      model({ id: 'big', label: 'Big', isFree: false }),
      model({ id: 'free', label: 'Free', isFree: true }),
    ];
    const resolution = features.resolveModel(models, 'commit', 'auto');
    assert.equal(resolution.ok, true);
    assert.equal(resolution.model.id, 'free');
    assert.equal(resolution.reason, 'free');
  });

  await check('routing: auto skips a model that is not fit', () => {
    const models = [
      model({ id: 'chatty', isFree: true, capabilities: { commit: false } }),
      model({ id: 'writer', isFree: false }),
    ];
    const resolution = features.resolveModel(models, 'commit', 'auto');
    assert.equal(resolution.ok, true);
    assert.equal(resolution.model.id, 'writer', 'the unfit free model was skipped');
  });

  await check('routing: auto falls back to the first fit when nothing is free', () => {
    const models = [model({ id: 'a' }), model({ id: 'b' })];
    const resolution = features.resolveModel(models, 'fix', 'auto');
    assert.equal(resolution.ok, true);
    assert.equal(resolution.model.id, 'a');
    assert.equal(resolution.reason, 'first-fit');
  });

  await check('routing: an explicit model is honoured', () => {
    const models = [model({ id: 'a' }), model({ id: 'b', isFree: true })];
    const resolution = features.resolveModel(models, 'chat', 'a');
    assert.equal(resolution.ok, true);
    assert.equal(resolution.model.id, 'a', 'a pinned model beats the free one');
    assert.equal(resolution.reason, 'pinned');
  });

  await check('routing: a pinned model that is gone is a clear error', () => {
    const resolution = features.resolveModel([model({ id: 'a' })], 'chat', 'gone');
    assert.equal(resolution.ok, false);
    assert.match(resolution.error, /^ENOMODEL:/);
  });

  await check('routing: a pinned model that is unfit is refused, not used', () => {
    const models = [model({ id: 'a', capabilities: { suggestions: false } })];
    const resolution = features.resolveModel(models, 'suggestions', 'a');
    assert.equal(resolution.ok, false);
    assert.match(resolution.error, /^ENOTFIT:/);
  });

  await check('routing: no fit model at all is a clear error', () => {
    const models = [model({ id: 'a', capabilities: { chat: false } })];
    const resolution = features.resolveModel(models, 'chat', 'auto');
    assert.equal(resolution.ok, false);
    assert.match(resolution.error, /no model is available for chat/);
  });

  await check('routing: a model with no flags is fit for everything', () => {
    const bare = model({ id: 'bare' });
    for (const feature of features.FEATURES) {
      assert.equal(features.isFit(bare, feature), true, `${feature} should be fit`);
    }
  });

  /* ----------------------------------------------------------------- policy */

  await check('policy: reasoning is off for every service feature', () => {
    assert.equal(features.thinkingFor('commit'), false);
    assert.equal(features.thinkingFor('suggestions'), false);
    assert.equal(features.thinkingFor('fix'), false);
    assert.equal(features.thinkingFor('chat'), true, 'chat is the one that wants it');
  });

  await check('policy: each feature carries its own caps', () => {
    assert.equal(features.policyFor('commit').maxTokens, 200);
    assert.equal(features.policyFor('suggestions').maxChars, 600);
    assert.equal(features.policyFor('chat').maxChars, 0, 'chat is not capped');
    assert.equal(features.settingKey('fix'), 'features.fix.model');
  });

  await check('clamp: a long answer is cut on a word boundary', () => {
    const long = `${'word '.repeat(200)}end`;
    const clamped = features.clampText(long, 'commit');
    assert.ok(clamped.length <= 400, `length ${clamped.length}`);
    assert.ok(!clamped.endsWith('wor'), 'did not cut mid-word');
  });

  await check('clamp: a short answer is untouched', () => {
    assert.equal(features.clampText('  feat: add a thing  ', 'commit'), 'feat: add a thing');
  });

  /* ------------------------------------------------------------------ diff */

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-features-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' });

  await check('diff: a staged change is read from a real repository', async () => {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    git('add', 'a.txt');
    git('commit', '-qm', 'init');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
    git('add', 'a.txt');

    const diff = await features.stagedDiff(repo);
    assert.match(diff, /\+two/, 'the staged line is in the diff');
    assert.match(diff, /a\.txt/);
  });

  await check('diff: with nothing staged the working tree is used', async () => {
    // Unstage first: while a change is staged, the staged diff is the right
    // answer and the fallback is never reached.
    git('reset', '-q');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
    const diff = await features.stagedDiff(repo);
    assert.match(diff, /\+three/);
    assert.match(diff, /\+two/, 'the unstaged edit is included too');
  });

  await check('diff: a huge diff is truncated before it is sent', () => {
    const huge = '+'.repeat(30_000);
    const cut = features.truncateDiff(huge, 1000);
    assert.ok(cut.length < 1200, `length ${cut.length}`);
    assert.match(cut, /truncated/);
  });

  await check('diff: a missing repository is a clear error', async () => {
    await assert.rejects(() => features.stagedDiff(path.join(repo, 'nope')), /EGIT|ENOGIT/);
  });

  /* ---------------------------------------------------------------- prompt */

  await check('prompt: the diff is included and the format is specified', () => {
    const prompt = features.buildCommitPrompt('diff --git a/x b/x\n+hello');
    assert.match(prompt, /Conventional Commits/);
    assert.match(prompt, /ONLY the commit message/);
    assert.match(prompt, /\+hello/);
  });

  await check('prompt: an extra instruction is appended, not replacing the rules', () => {
    const prompt = features.buildCommitPrompt('+x', { extra: 'Mention the ticket.' });
    assert.match(prompt, /Mention the ticket\./);
    assert.match(prompt, /imperative mood/);
  });

  await check('parse: a fenced answer is unwrapped', () => {
    assert.equal(
      features.parseCommitMessage('```\nfeat: add a thing\n```'),
      'feat: add a thing',
    );
    assert.equal(
      features.parseCommitMessage('```text\nfix: repair it\n```'),
      'fix: repair it',
    );
  });

  await check('parse: a label the model added is stripped', () => {
    assert.equal(
      features.parseCommitMessage('Commit message: fix: repair it'),
      'fix: repair it',
    );
  });

  await check('parse: wrapping quotes are removed, inner ones are kept', () => {
    assert.equal(features.parseCommitMessage('"fix: repair it"'), 'fix: repair it');
    assert.equal(
      features.parseCommitMessage('fix: handle the "empty" case'),
      'fix: handle the "empty" case',
    );
  });

  await check('parse: a body survives, the subject is readable', () => {
    const message = 'feat: add a thing\n\n- one\n- two';
    assert.equal(features.parseCommitMessage(message), message);
    assert.equal(features.subjectOf(message), 'feat: add a thing');
  });

  /* --------------------------------------------------------------- service */

  const fakeBridge = (answers) => {
    const calls = [];
    return {
      calls,
      async askApi(modelId, prompt, opts) {
        calls.push({ kind: 'api', modelId, prompt, opts });
        return answers.api ?? 'feat: from the endpoint';
      },
      async askDom(adapterId, prompt) {
        calls.push({ kind: 'dom', adapterId, prompt });
        return answers.dom ?? 'feat: from the tab';
      },
    };
  };

  await check('service: an endpoint model goes down the api path', async () => {
    const bridge = fakeBridge({});
    const models = [model({ id: 'ep/model', kind: 'api', isFree: true })];
    const result = await features.askFeature(bridge, models, 'commit', 'auto', 'write it');
    assert.equal(bridge.calls[0].kind, 'api');
    assert.equal(bridge.calls[0].modelId, 'ep/model');
    assert.equal(bridge.calls[0].opts.maxTokens, 200, 'the feature cap is applied');
    assert.equal(result.text, 'feat: from the endpoint');
    assert.equal(result.clamped, false);
  });

  await check('service: a tab model goes down the dom path', async () => {
    const bridge = fakeBridge({});
    const models = [model({ id: 'dom:chatgpt', kind: 'dom', source: 'chatgpt' })];
    await features.askFeature(bridge, models, 'commit', 'auto', 'write it');
    assert.equal(bridge.calls[0].kind, 'dom');
    assert.equal(bridge.calls[0].adapterId, 'chatgpt');
  });

  await check('service: an over-long answer is clamped and reported as clamped', async () => {
    const bridge = fakeBridge({ api: 'x'.repeat(5000) });
    const models = [model({ id: 'a', kind: 'api' })];
    const result = await features.askFeature(bridge, models, 'commit', 'auto', 'write it');
    assert.ok(result.text.length <= 400);
    assert.equal(result.clamped, true);
  });

  await check('service: an unresolvable model fails before any request', async () => {
    const bridge = fakeBridge({});
    await assert.rejects(
      () => features.askFeature(bridge, [], 'commit', 'auto', 'write it'),
      (err) => {
        assert.equal(err.name, 'ServiceError');
        assert.equal(err.code, 'ENOMODEL');
        return true;
      },
    );
    assert.equal(bridge.calls.length, 0, 'nothing was sent');
  });

  await check('service: the cheap model absorbs the chore, the strong one is left alone', async () => {
    const bridge = fakeBridge({});
    const models = [
      model({ id: 'strong', label: 'Strong', isFree: false }),
      model({ id: 'cheap', label: 'Cheap', isFree: true }),
    ];
    const commit = await features.askFeature(bridge, models, 'commit', 'auto', 'write it');
    const chat = await features.askFeature(bridge, models, 'chat', 'auto', 'explain it');
    assert.equal(commit.modelId, 'cheap', 'the commit went to the free model');
    assert.equal(chat.modelId, 'cheap', 'and so did chat, when it is the only free one');
  });

  /* ------------------------------------------------------------------ total */

  fs.rmSync(repo, { recursive: true, force: true });
  console.log('');
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
