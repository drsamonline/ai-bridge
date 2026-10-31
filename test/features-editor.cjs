#!/usr/bin/env node
/**
 * Batch 8.3b acceptance harness — suggestions and fixes, minus the editor.
 *
 * Acceptance: "a suggestion is bounded to what a slow free tier can deliver, and
 * a fix never lands in a file without the user seeing it first."
 *
 * Only the pure modules are exercised: `editor.ts` imports `vscode` and cannot be
 * loaded outside an extension host. Everything that decides *what* is inserted
 * lives here, which is the part worth testing.
 */

'use strict';

const assert = require('node:assert');
const suggest = require('../extension/dist/features/suggest.js');
const fix = require('../extension/dist/features/fix.js');

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

async function main() {
  /* -------------------------------------------------------------- prompts */

  await check('prompt: the code on both sides of the cursor is included', () => {
    const prompt = suggest.buildSuggestionPrompt({
      prefix: 'function add(a, b) {',
      suffix: '}\n',
      languageId: 'typescript',
    });
    assert.match(prompt, /typescript/);
    assert.match(prompt, /function add\(a, b\) \{/);
    assert.match(prompt, /Code after the cursor/);
    assert.match(prompt, /ONLY the code to insert/);
  });

  await check('prompt: no suffix section when there is nothing after the cursor', () => {
    const prompt = suggest.buildSuggestionPrompt({
      prefix: 'const x = 1;',
      suffix: '   ',
      languageId: 'javascript',
    });
    assert.ok(!prompt.includes('Code after the cursor'));
  });

  await check('prompt: the prefix is cut from the front, keeping what is near', () => {
    const long = `${'x'.repeat(5000)}NEAR`;
    const prompt = suggest.buildSuggestionPrompt({
      prefix: long,
      suffix: '',
      languageId: 'text',
      maxPrefixChars: 100,
    });
    assert.ok(prompt.includes('NEAR'), 'the text next to the cursor survived');
    assert.ok(!prompt.includes('x'.repeat(200)), 'the far history was dropped');
  });

  await check('prompt: the suffix is cut from the back', () => {
    const prompt = suggest.buildSuggestionPrompt({
      prefix: 'a',
      suffix: `FAR${'y'.repeat(5000)}`,
      languageId: 'text',
      maxSuffixChars: 50,
    });
    assert.ok(prompt.includes('FAR'));
    assert.ok(!prompt.includes('y'.repeat(200)));
  });

  /* ------------------------------------------------------------ suggestions */

  await check('clean: a fenced answer is unwrapped', () => {
    assert.equal(
      suggest.cleanSuggestion('```ts\nconst a = 1;\n```'),
      'const a = 1;',
    );
  });

  await check('clean: a preamble before the code is dropped', () => {
    assert.equal(
      suggest.cleanSuggestion("Here's the continuation:\nconst a = 1;"),
      'const a = 1;',
    );
  });

  await check('clean: leading blank lines are dropped', () => {
    assert.equal(suggest.cleanSuggestion('\n\n  const a = 1;'), '  const a = 1;');
  });

  await check('clean: the answer is capped at 12 lines', () => {
    const raw = Array.from({ length: 30 }, (_, i) => `line${i};`).join('\n');
    const lines = suggest.cleanSuggestion(raw).split('\n');
    assert.ok(lines.length <= 12, `${lines.length} lines`);
  });

  await check('clean: the answer is capped by characters', () => {
    const raw = Array.from({ length: 40 }, () => 'const value = compute(1);').join('\n');
    const out = suggest.cleanSuggestion(raw);
    assert.ok(out.length <= 600, `${out.length} chars`);
    assert.ok(out.length > 0, 'something usable survived');
  });

  await check('clean: an unfinished last line at the cap is dropped', () => {
    const raw = Array.from({ length: 12 }, (_, i) =>
      i === 11 ? 'const partial = obj.' : `line${i};`,
    ).join('\n');
    const out = suggest.cleanSuggestion(raw);
    assert.ok(!out.includes('obj.'), 'a half-written statement is not offered');
  });

  await check('usable: an empty or apologetic answer is refused', () => {
    assert.equal(suggest.isUsable(''), false);
    assert.equal(suggest.isUsable('   '), false);
    assert.equal(suggest.isUsable('Sorry, I cannot continue this code.'), false);
    assert.equal(suggest.isUsable('```'), false);
    assert.equal(suggest.isUsable('const a = 1;'), true);
  });

  /* ------------------------------------------------------------------ fixes */

  await check('fix prompt: the diagnostic line is marked and the message included', () => {
    const prompt = fix.buildFixPrompt({
      code: 'const a = 1;\nconst b = ;\nconst c = 3;',
      message: "Expression expected.",
      languageId: 'typescript',
      line: 2,
      offset: 1,
    });
    assert.match(prompt, /line 2/);
    assert.match(prompt, /Expression expected\./);
    assert.match(prompt, />> const b = ;/, 'the marked line is the diagnostic line');
    assert.match(prompt, /const a = 1;/, 'context is included');
    assert.match(prompt, /ONLY the replacement/);
  });

  await check('fix: a fenced replacement is unwrapped', () => {
    assert.equal(fix.extractReplacement('```ts\nconst b = 2;\n```'), 'const b = 2;');
  });

  await check('fix: the marker the model echoed back is stripped', () => {
    assert.equal(fix.extractReplacement('>> const b = 2;'), 'const b = 2;');
  });

  await check('fix: the three-space context indent is stripped', () => {
    assert.equal(fix.extractReplacement('   const b = 2;'), 'const b = 2;');
  });

  await check('fix: a multi-line replacement keeps its lines in order', () => {
    const replacement = fix.extractReplacement('```\nif (!b) {\n  return null;\n}\n```');
    assert.deepEqual(replacement.split('\n'), ['if (!b) {', '  return null;', '}']);
  });

  await check('fix: an apology is refused rather than inserted', () => {
    assert.equal(fix.isUsableFix('Sorry, I cannot fix this.'), false);
    assert.equal(fix.isUsableFix(''), false);
    assert.equal(fix.isUsableFix('const b = 2;'), true);
  });

  await check('fix: the preview says how many lines will land', () => {
    assert.equal(fix.describeFix('const b = 2;'), 'replace this line');
    assert.equal(fix.describeFix('a;\nb;'), 'replace this line with 2 lines');
  });

  await check('fix: the context window is bounded', () => {
    assert.equal(fix.FIX_CONTEXT_LINES, 6);
  });

  /* ------------------------------------------------------------------ total */

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
