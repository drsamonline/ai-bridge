#!/usr/bin/env node
/**
 * Batch 3.1 acceptance harness — T0 compressor.
 *
 * Acceptance: "100→≤70 tokens, code untouched, hash cache."
 *
 * Everything here is measured, not asserted by eye: the token counts come from
 * the same conservative counter the boot builder uses, "code untouched" is a
 * byte comparison against the original spans, and the cache is inspected by its
 * own key list.
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const t0 = require('../extension/dist/compress/t0.js');
const { CompressHost } = require('../extension/dist/compress/host.js');
const { countTokens } = require('../extension/dist/text/tokens.js');

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

/* A realistic, deliberately verbose request of roughly 100 tokens. */
const VERBOSE = `Hi there! Could you please kindly help me to refactor the format module?

I would like you to make the slug helper cleaner and I hope this helps. Basically, in order to
improve readability, please note that we must not change the public API at this point in time.
Due to the fact that other packages import it directly, we are not able to rename the exported
symbols.

Thank you so much! Please let me know if you have any questions.`;

const CODE_BLOCK = `\`\`\`ts
export function slug(input: string): string {
  const MAX_LENGTH = 64; // SCREAMING_SNAKE must survive
  return input.trim().toLowerCase().slice(0, MAX_LENGTH);
}
\`\`\``;

const WITH_CODE = `Please could you fix the crash in src/format.ts? It throws the following:

${CODE_BLOCK}

The error is: TypeError: Cannot read properties of undefined (reading 'trim')
    at slug (src/format.ts:12:9)

Please see https://example.com/docs/slug for the expected behaviour and keep MAX_LENGTH at 64. Thanks!`;

async function main() {
  /* ------------------------------------------------- 1. the acceptance number */
  const result = t0.compressT0(VERBOSE, {});
  console.log(
    `  verbose prompt: ${result.tokensBefore} → ${result.tokensAfter} tokens (${t0.savedPercent(result)}% saved)\n`,
  );
  check('the prompt starts at ~100 tokens', () =>
    assert.ok(result.tokensBefore >= 90 && result.tokensBefore <= 130, `${result.tokensBefore}`));
  check('T0 brings it to ≤70 tokens', () =>
    assert.ok(result.tokensAfter <= 70, `${result.tokensAfter} tokens`));
  check('the saving is reported as a percentage', () =>
    assert.ok(t0.savedPercent(result) >= 25, `${t0.savedPercent(result)}%`));
  check('pleasantries are gone', () => {
    for (const phrase of ['Hi there', 'kindly', 'I would like you to', 'hope this helps', 'Thank you']) {
      assert.ok(!result.text.includes(phrase), `"${phrase}" survived`);
    }
  });
  check('wordy connectives are shortened', () => {
    assert.ok(!/in order to/i.test(result.text), 'in order to survived');
    assert.ok(!/due to the fact that/i.test(result.text), 'due to the fact that survived');
    assert.ok(!/at this point in time/i.test(result.text), 'at this point in time survived');
    assert.ok(!/it is important to note that/i.test(result.text), 'padding survived');
  });
  check('meaning is preserved (the constraints still read)', () => {
    assert.match(result.text, /must not change the public API/i);
    assert.match(result.text, /refactor/i);
  });
  check('no orphaned punctuation is left behind', () =>
    assert.ok(!/[.,;:]\s*[.,;:]/.test(result.text), result.text));
  check('compression is idempotent', () => {
    const twice = t0.compressT0(result.text, {});
    assert.strictEqual(twice.text, result.text);
  });

  /* --------------------------------------------- 2. code untouched */
  const coded = t0.compressT0(WITH_CODE, {});
  console.log(`  code prompt: ${coded.tokensBefore} → ${coded.tokensAfter}, ${coded.protectedSpans} spans protected\n`);
  check('the fenced code block is byte-identical', () =>
    assert.ok(coded.text.includes(CODE_BLOCK), 'code block changed'));
  check('the inline path survives verbatim', () => assert.ok(coded.text.includes('src/format.ts')));
  check('the URL survives verbatim', () =>
    assert.ok(coded.text.includes('https://example.com/docs/slug')));
  check('the SCREAMING_SNAKE constant survives', () => assert.ok(coded.text.includes('MAX_LENGTH')));
  check('the error line survives verbatim', () =>
    assert.ok(coded.text.includes("TypeError: Cannot read properties of undefined (reading 'trim')")));
  check('the stack frame survives verbatim', () =>
    assert.ok(coded.text.includes('at slug (src/format.ts:12:9)')));
  check('protected spans are counted', () => assert.ok(coded.protectedSpans >= 5, `${coded.protectedSpans}`));
  check('the surrounding prose still compresses', () =>
    assert.ok(coded.tokensAfter < coded.tokensBefore, `${coded.tokensBefore} → ${coded.tokensAfter}`));

  /* --------------------------------------------- 3. glossary + dedupe */
  const glossed = t0.compressT0(
    'The extension host process and the extension host process must both restart. The extension host process is slow.',
    { glossary: { 'extension host process': 'EH', 'short': 'a much longer replacement that must be ignored' } },
  );
  check('a glossary alias is applied', () => assert.ok(glossed.text.includes('EH'), glossed.text));
  check('glossary hits are counted', () => assert.ok(glossed.glossaryHits >= 2, `${glossed.glossaryHits}`));
  check('a glossary entry that would lengthen text is ignored', () =>
    assert.ok(!glossed.text.includes('a much longer replacement'), glossed.text));

  const duped = t0.compressT0(
    ['Run the migration first.', 'Run the migration first.', 'Run the migration first.', 'Then verify the counts.'].join('\n'),
  );
  check('repeated lines are deduped', () => {
    assert.strictEqual(duped.dedupedLines, 2, `${duped.dedupedLines}`);
    assert.strictEqual(duped.text.split('Run the migration first.').length - 1, 1);
  });
  check('two identical code lines are NOT deduped', () => {
    const code = '```\nconst a = 1;\nconst a = 1;\n```';
    const r = t0.compressT0(`Look:\n${code}`, {});
    assert.ok(r.text.includes('const a = 1;\nconst a = 1;'), r.text);
  });

  /* ------------------------------------------------- 4. jargon is flagged */
  const jargon = t0.compressT0('Please wire up the FrobnicatorService into the QuuxAdapter pipeline.');
  check('unknown jargon is flagged rather than guessed', () => {
    assert.ok(jargon.flagged.includes('FrobnicatorService'), JSON.stringify(jargon.flagged));
    assert.ok(jargon.flagged.includes('QuuxAdapter'), JSON.stringify(jargon.flagged));
  });

  /* ------------------------------------------------------- 5. LRU cache */
  t0.clearCompressCache();
  const first = t0.compressT0('Cache me please, thanks.', {});
  const second = t0.compressT0('Cache me please, thanks.', {});
  check('the second identical call is a cache hit', () => {
    assert.strictEqual(first.cacheHit, false);
    assert.strictEqual(second.cacheHit, true);
  });
  check('a cache hit returns the identical result', () => assert.strictEqual(second.text, first.text));
  check('a different glossary is a different cache entry', () => {
    const a = t0.compressT0('The extension host process runs.', { glossary: { 'extension host process': 'EH' } });
    const b = t0.compressT0('The extension host process runs.', { glossary: { 'extension host process': 'HOST' } });
    assert.notStrictEqual(a.text, b.text);
  });

  t0.clearCompressCache();
  for (let i = 0; i < 130; i += 1) t0.compressT0(`unique input number ${i} please`, {});
  check('the cache is capped at 100 entries', () =>
    assert.ok(t0.compressCacheSize() <= 100, `${t0.compressCacheSize()}`));
  check('the oldest entries were evicted, not the newest', () => {
    const again = t0.compressT0('unique input number 129 please', {});
    assert.strictEqual(again.cacheHit, true, 'the newest entry was evicted');
    const oldest = t0.compressT0('unique input number 0 please', {});
    assert.strictEqual(oldest.cacheHit, false, 'the oldest entry survived');
  });

  /* ------------------------------------------- 6. budget forces the hard pass */
  const budgeted = t0.compressT0(VERBOSE, { budgetTokens: 25 });
  check('an over-budget result is escalated to the hard pass', () =>
    assert.ok(budgeted.passes.includes('hard'), budgeted.passes.join(',')));
  check('the hard pass never touches protected spans', () => {
    const hard = t0.compressT0(WITH_CODE, { budgetTokens: 5, aggressiveness: 'hard' });
    assert.ok(hard.text.includes(CODE_BLOCK), 'code was mangled by the hard pass');
    assert.ok(hard.text.includes('MAX_LENGTH'));
  });
  check('a still-over-budget result says so instead of lying', () =>
    assert.strictEqual(budgeted.overBudget, true));

  /* ------------------------------------------------------ 7. safety */
  check('an all-pleasantry message is not emptied', () => {
    const r = t0.compressT0('Thanks!');
    assert.ok(/[a-z]/i.test(r.text), r.text);
  });
  check('emoji survive', () => {
    const r = t0.compressT0('Please deploy 🚀 the service now, thanks!');
    assert.ok(r.text.includes('🚀'), r.text);
  });
  check('a message of only whitespace is handled', () => {
    const r = t0.compressT0('   \n\n\t  ');
    assert.strictEqual(typeof r.text, 'string');
  });
  check('countTokens is shared with the boot builder', () => {
    const boot = require('../extension/dist/state/boot.js');
    assert.strictEqual(boot.countTokens('hello world'), countTokens('hello world'));
  });

  /* -------------------------------------------------------- 8. the worker */
  const logs = [];
  const host = new CompressHost({ log: (lvl, msg) => logs.push(`${lvl}: ${msg}`) });
  const threaded = await host.start();
  const viaWorker = await host.compress(VERBOSE, {});
  await host.stop();

  check('T0 runs on a worker thread', () => assert.strictEqual(threaded, true));
  check('the worker returns the same result as inline', () =>
    assert.strictEqual(viaWorker.text, result.text));
  check('the worker bundle pulls no heavy modules', () => {
    const workerSrc = fs.readFileSync(path.join(ROOT, 'extension/dist/compress/t0Worker.js'), 'utf8');
    const t0Src = fs.readFileSync(path.join(ROOT, 'extension/dist/compress/t0.js'), 'utf8');
    for (const src of [workerSrc, t0Src]) {
      assert.ok(!/require\("@ai-bridge\/shared"\)/.test(src), 'worker graph reaches shared');
      assert.ok(!/require\("ws"\)/.test(src), 'worker graph reaches ws');
    }
  });

  /* ---------------------------------------------------------- report */
  const report = [
    '# Batch 3.1 — T0 compressor',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **100→≤70 tokens, code untouched, hash cache.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The measured run',
    '',
    '```',
    `before   ${result.tokensBefore} tokens`,
    `after    ${result.tokensAfter} tokens`,
    `saved    ${t0.savedPercent(result)}%`,
    `passes   ${result.passes.join(' → ')}`,
    `spans    ${result.protectedSpans} protected`,
    '```',
    '',
    '### Input',
    '',
    '```',
    VERBOSE,
    '```',
    '',
    '### Output',
    '',
    '```',
    result.text,
    '```',
    '',
    '## Code protection',
    '',
    `Input ${coded.tokensBefore} tokens → output ${coded.tokensAfter}, with ${coded.protectedSpans} spans protected. The fenced block, the path, the URL, the constant, the error line and the stack frame all appear byte-identical in the output.`,
    '',
    '```',
    coded.text,
    '```',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-3.1-compress.md'), report);

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
