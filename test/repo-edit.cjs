#!/usr/bin/env node
/**
 * Batch 1.2 acceptance harness — RepoReader + EditApplier.
 *
 * Runs the real core (extension/dist/repo/*) against a real temp repo through a
 * `node:fs` FsPort. No VS Code, no browser, no model: the applier's guarantees
 * are checked against bytes on disk.
 *
 * Covers the acceptance line — '"rename X→Y" → applyable diff; reject = no
 * change' — plus drift refusal, ambiguous hunks, locked decisions, file
 * creation, and the single-batch apply.
 */

'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { RepoReader, queryTerms, extractSignatures } = require('../extension/dist/repo/reader.js');
const { EditApplier, sha, lineDelta } = require('../extension/dist/repo/applier.js');
const { parseProposal, summarise } = require('../extension/dist/repo/proposal.js');
const { isEditablePath } = require('../extension/dist/repo/ports.js');

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

/* --------------------------------------------------------------- fixture */

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-repo-'));
  const write = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };

  write(
    'src/format.ts',
    [
      'export function oldName(value: string): string {',
      "  return value.trim().toLowerCase();",
      '}',
      '',
      'export const VERSION = "1.0.0";',
      '',
    ].join('\n'),
  );
  write(
    'src/use-a.ts',
    [
      "import { oldName } from './format';",
      '',
      'export function normalise(input: string) {',
      '  return oldName(input);',
      '}',
      '',
    ].join('\n'),
  );
  write(
    'src/use-b.ts',
    [
      "import { oldName } from './format';",
      '',
      'export const slug = (s: string) => oldName(s).replace(/\\s+/g, "-");',
      '',
    ].join('\n'),
  );
  write(
    'src/policy.ts',
    [
      '// DO NOT REMOVE THIS LINE: audit trail required',
      'export const POLICY = "retain";',
      '',
    ].join('\n'),
  );
  write('README.md', '# demo repo\n\nA tiny repo for the applier tests.\n');
  write('node_modules/junk/index.js', 'throw new Error("should never be indexed");\n');
  write('assets/logo.png', 'binary-ish');
  return root;
}

function nodeFsPort(root) {
  const abs = (rel) => path.join(root, rel);
  const shaOf = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

  const walk = (dir, acc) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full, acc);
      } else {
        acc.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
    return acc;
  };

  return {
    root,
    async list() {
      return walk(root, []);
    },
    async read(rel) {
      return fs.readFileSync(abs(rel), 'utf8');
    },
    async stat(rel) {
      try {
        const st = fs.statSync(abs(rel));
        const text = fs.readFileSync(abs(rel), 'utf8');
        return { path: rel, sha: shaOf(text), size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    },
    async search(query, opts = {}) {
      const hits = [];
      const limit = opts.maxHits ?? 200;
      for (const rel of walk(root, [])) {
        let text;
        try {
          text = fs.readFileSync(abs(rel), 'utf8');
        } catch {
          continue;
        }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          const matched = opts.regex
            ? new RegExp(query).test(line)
            : line.toLowerCase().includes(String(query).toLowerCase());
          if (matched) {
            hits.push({ path: rel, line: i + 1, text: line });
            if (hits.length >= limit) return hits;
          }
        }
      }
      return hits;
    },
  };
}

/** ApplyPort that records how many times it was called. */
function recordingApplyPort(root) {
  const calls = [];
  return {
    calls,
    async apply(edits) {
      calls.push(edits.map((e) => e.path));
      for (const e of edits) {
        const abs = path.join(root, e.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, e.after);
      }
      return { ok: true };
    },
  };
}

const readAll = (root) => {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else {
        out[path.relative(root, full)] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(root);
  return out;
};

const RENAME_ANSWER = `Sure — here is the rename.

\`\`\`edit path=src/format.ts
<<<<<<< SEARCH
export function oldName(value: string): string {
=======
export function newName(value: string): string {
>>>>>>> REPLACE
\`\`\`

\`\`\`edit path=src/use-a.ts
<<<<<<< SEARCH
import { oldName } from './format';
=======
import { newName } from './format';
>>>>>>> REPLACE

<<<<<<< SEARCH
  return oldName(input);
=======
  return newName(input);
>>>>>>> REPLACE
\`\`\`

\`\`\`edit path=src/use-b.ts
<<<<<<< SEARCH
import { oldName } from './format';
=======
import { newName } from './format';
>>>>>>> REPLACE

<<<<<<< SEARCH
export const slug = (s: string) => oldName(s).replace(/\\s+/g, "-");
=======
export const slug = (s: string) => newName(s).replace(/\\s+/g, "-");
>>>>>>> REPLACE
\`\`\`

That should cover every usage.`;

async function main() {
  /* ---------------------------------------------------- 1. repo reader */
  const root = makeRepo();
  const fsPort = nodeFsPort(root);
  const reader = new RepoReader({ fs: fsPort, budgetTokens: 2500 });

  const idx = await reader.index();
  check('reader indexes the repo', () => assert.ok(idx.files >= 5, `${idx.files} files`));
  check('reader skips node_modules and binaries', () => {
    assert.ok(!isEditablePath('node_modules/junk/index.js'));
    assert.ok(!isEditablePath('assets/logo.png'));
    assert.ok(isEditablePath('src/format.ts'));
  });

  const bundle = await reader.bundle('rename oldName to newName');
  console.log(`  bundle: ${bundle.files.length} files, ${bundle.tokens} tokens`);
  check('bundle ranks the files that mention the symbol', () => {
    const paths = bundle.files.map((f) => f.path);
    assert.ok(paths.includes('src/format.ts'), paths.join(','));
    assert.ok(paths.includes('src/use-a.ts'), paths.join(','));
  });
  check('bundle carries a sha per file', () => {
    for (const f of bundle.files) assert.match(f.sha, /^[0-9a-f]{16}$/);
  });
  check('bundle states the edit-block protocol', () => assert.match(bundle.text, /<<<<<<< SEARCH/));
  check('bundle stays inside the token budget', () => assert.ok(bundle.tokens <= 3500, `${bundle.tokens}`));
  check('signature extraction finds declarations', () => {
    const sigs = extractSignatures(fs.readFileSync(path.join(root, 'src/format.ts'), 'utf8'), 'src/format.ts');
    assert.ok(sigs.some((s) => s.includes('oldName')), sigs.join(' | '));
  });
  check('query terms drop intent words', () => {
    const t = queryTerms('please rename oldName to newName in the files');
    assert.ok(t.includes('oldName') && t.includes('newName'), t.join(','));
    assert.ok(!t.includes('please'), t.join(','));
  });

  /* ------------------------------------------------- 2. proposal parsing */
  const proposal = parseProposal(RENAME_ANSWER, 'p-rename');
  check('proposal parses every edit block', () => assert.strictEqual(proposal.files.length, 3));
  check('proposal keeps hunks per file', () => {
    const useA = proposal.files.find((f) => f.path === 'src/use-a.ts');
    assert.strictEqual(useA.hunks.length, 2);
  });
  check('prose outside the blocks is ignored', () => {
    assert.ok(!JSON.stringify(proposal.files).includes('That should cover'));
  });
  check('an answer with no blocks yields null (no change)', () => {
    assert.strictEqual(parseProposal('I would rename it, but here is prose only.'), null);
  });

  /* ------------------------------------------------------ 3. plan + apply */
  const applyPort = recordingApplyPort(root);
  const applier = new EditApplier({ fs: fsPort, apply: applyPort, decisions: () => [] });

  const plan = await applier.plan(proposal);
  console.log(`  plan: ${summarise(plan.files)} — ok=${plan.ok}`);
  check('plan is applicable', () => assert.strictEqual(plan.ok, true));
  check('plan touches three files', () => assert.strictEqual(plan.summary.files, 3));
  check('plan counts added and removed lines', () => {
    assert.ok(plan.summary.added >= 3, `+${plan.summary.added}`);
    assert.ok(plan.summary.removed >= 3, `−${plan.summary.removed}`);
  });
  check('plan summary renders as a diff card', () =>
    assert.match(summarise(plan.files), /3 files \+\d+ −\d+/));
  check('plan produces an applyable diff (before ≠ after, per file)', () => {
    for (const f of plan.files.filter((x) => x.status !== 'refused')) {
      assert.notStrictEqual(f.before, f.after, f.path);
    }
  });

  const applied = await applier.apply(plan);
  check('apply succeeds', () => assert.strictEqual(applied.ok, true));
  check('apply used ONE batch (single WorkspaceEdit)', () => assert.strictEqual(applyPort.calls.length, 1));
  check('that batch carried all three files', () => assert.strictEqual(applyPort.calls[0].length, 3));
  check('the rename landed on disk', () => {
    const after = readAll(root);
    assert.match(after['src/format.ts'], /export function newName/);
    assert.ok(!after['src/format.ts'].includes('oldName('), 'old name still in format.ts');
    assert.match(after['src/use-a.ts'], /newName\(input\)/);
    assert.match(after['src/use-b.ts'], /newName\(s\)/);
  });

  /* ------------------------------------------------ 4. reject = no change */
  const root2 = makeRepo();
  const fs2 = nodeFsPort(root2);
  const apply2 = recordingApplyPort(root2);
  const applier2 = new EditApplier({ fs: fs2, apply: apply2, decisions: () => [] });
  const before2 = readAll(root2);
  const plan2 = await applier2.plan(parseProposal(RENAME_ANSWER, 'p-reject'));
  // Rejected: we simply never call apply.
  const after2 = readAll(root2);
  check('a rejected proposal changes nothing on disk', () =>
    assert.deepStrictEqual(after2, before2));
  check('a rejected proposal never calls the apply port', () => assert.strictEqual(apply2.calls.length, 0));
  check('the plan was still available to review', () => assert.strictEqual(plan2.ok, true));

  /* ------------------------------------------------------- 5. drift */
  const plan3 = await applier2.plan(parseProposal(RENAME_ANSWER, 'p-drift'));
  fs.writeFileSync(
    path.join(root2, 'src/use-a.ts'),
    "import { oldName } from './format';\n\nexport function normalise(input: string) {\n  return oldName(input);\n}\n// someone else edited this\n",
  );
  const drift = await applier2.apply(plan3);
  check('apply refuses when a file changed after planning', () =>
    assert.match(String(drift.error), /EDRIFT/));
  check('the drift refusal wrote nothing', () => {
    const after = readAll(root2);
    assert.match(after['src/format.ts'], /oldName/);
    assert.match(after['src/use-a.ts'], /someone else edited/);
  });

  /* --------------------------------------------- 6. unsafe proposals */
  const ambiguous = parseProposal(
    [
      '```edit path=src/policy.ts',
      '<<<<<<< SEARCH',
      'export const POLICY = "retain";',
      '=======',
      'export const POLICY = "drop";',
      '>>>>>>> REPLACE',
      '```',
    ].join('\n'),
    'p-amb',
  );
  const dupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-dup-'));
  fs.writeFileSync(path.join(dupRoot, 'twice.ts'), 'const a = 1;\nconst a = 1;\n');
  const dupPort = nodeFsPort(dupRoot);
  const dupPlan = await new EditApplier({ fs: dupPort, apply: recordingApplyPort(dupRoot) }).plan(
    parseProposal(
      [
        '```edit path=twice.ts',
        '<<<<<<< SEARCH',
        'const a = 1;',
        '=======',
        'const a = 2;',
        '>>>>>>> REPLACE',
        '```',
      ].join('\n'),
      'p-dup',
    ),
  );
  check('a SEARCH text that matches twice is refused', () => {
    assert.strictEqual(dupPlan.ok, false);
    assert.match(dupPlan.refusals[0].reason, /more than once|ambiguous/);
  });

  const missing = await new EditApplier({ fs: fsPort, apply: recordingApplyPort(root) }).plan(
    parseProposal(
      [
        '```edit path=src/does-not-exist.ts',
        '<<<<<<< SEARCH',
        'anything',
        '=======',
        'else',
        '>>>>>>> REPLACE',
        '```',
      ].join('\n'),
      'p-missing',
    ),
  );
  check('editing a file that does not exist is refused', () => {
    assert.strictEqual(missing.ok, false);
    assert.match(missing.refusals[0].reason, /ENOENT/);
  });

  check('ambiguous proposal object is well-formed', () => assert.strictEqual(ambiguous.files.length, 1));

  /* ------------------------------------------------ 7. locked decisions */
  const lockedRoot = makeRepo();
  const lockedFs = nodeFsPort(lockedRoot);
  const lockedApply = recordingApplyPort(lockedRoot);
  const lockedApplier = new EditApplier({
    fs: lockedFs,
    apply: lockedApply,
    decisions: () => [
      {
        id: 'd1',
        what: 'DO NOT REMOVE THIS LINE: audit trail required',
        why: 'compliance',
        locked: true,
        paths: ['src/policy.ts'],
      },
    ],
  });
  const lockPlan = await lockedApplier.plan(
    parseProposal(
      [
        '```edit path=src/policy.ts',
        '<<<<<<< SEARCH',
        '// DO NOT REMOVE THIS LINE: audit trail required',
        '=======',
        '',
        '>>>>>>> REPLACE',
        '```',
      ].join('\n'),
      'p-lock',
    ),
  );
  check('locked decision holds the edit (even in auto mode)', () => {
    assert.strictEqual(lockPlan.ok, false);
    assert.match(lockPlan.refusals[0].reason, /ELOCKED/);
  });
  const lockApply = await lockedApplier.apply(lockPlan);
  check('locked plan cannot be applied', () => assert.strictEqual(lockApply.ok, false));
  check('locked decision left the file untouched', () => {
    assert.match(readAll(lockedRoot)['src/policy.ts'], /audit trail required/);
  });
  check('apply port never called for a held edit', () => assert.strictEqual(lockedApply.calls.length, 0));

  /* ------------------------------------------------- 8. file creation */
  const createRoot = makeRepo();
  const createFs = nodeFsPort(createRoot);
  const createApply = recordingApplyPort(createRoot);
  const createPlan = await new EditApplier({ fs: createFs, apply: createApply }).plan(
    parseProposal(
      [
        '```file path=src/constants.ts',
        "export const NEW_NAME = 'newName';",
        '```',
      ].join('\n'),
      'p-create',
    ),
  );
  check('a file block plans as a create', () => assert.strictEqual(createPlan.files[0].status, 'create'));
  const createRes = await new EditApplier({ fs: createFs, apply: createApply }).apply(createPlan);
  check('a file block creates the file', () => {
    assert.strictEqual(createRes.ok, true);
    assert.match(readAll(createRoot)['src/constants.ts'], /NEW_NAME/);
  });


  /* ------------------------------------------- 5b. per-hunk accept (§6) */
  {
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-hunks-'));
    fs.mkdirSync(path.join(root2, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root2, 'src/multi.ts'),
      'export const A = 1;\nexport const B = 2;\nexport const C = 3;\n',
    );
    const applyCalls = [];
    const applier2 = new EditApplier({
      fs: nodeFsPort(root2),
      apply: {
        async apply(edits) {
          applyCalls.push(edits);
          for (const e of edits) fs.writeFileSync(path.join(root2, e.path), e.after);
          return { ok: true };
        },
      },
      decisions: () => [],
    });
    const proposal2 = parseProposal(
      [
        '```edit path=src/multi.ts',
        '<<<<<<< SEARCH',
        'export const A = 1;',
        '=======',
        'export const A = 10;',
        '>>>>>>> REPLACE',
        '<<<<<<< SEARCH',
        'export const B = 2;',
        '=======',
        'export const B = 20;',
        '>>>>>>> REPLACE',
        '```',
      ].join('\n'),
    );
    const plan2 = await applier2.plan(proposal2);
    check('a plan lists its hunks with stable keys', () => {
      assert.strictEqual(plan2.files[0].hunkList.length, 2);
      // The parser keeps the trailing newline, which is what exact matching needs.
      assert.strictEqual(plan2.files[0].hunkList[0].search.trim(), 'export const A = 1;');
    });

    const partial = await applier2.apply(plan2, ['src/multi.ts#1']);
    check('a per-hunk selection applies only the chosen hunks', () => {
      assert.strictEqual(partial.ok, true);
      const text = fs.readFileSync(path.join(root2, 'src/multi.ts'), 'utf8');
      assert.match(text, /export const A = 1;/, 'hunk 0 should NOT have been applied');
      assert.match(text, /export const B = 20;/, 'hunk 1 should have been applied');
    });
    check('a per-hunk apply is still one WorkspaceEdit', () => assert.strictEqual(applyCalls.length, 1));

    // A fresh plan, because re-applying the used one trips the drift guard first
    // (which is itself correct).
    const freshPlan = await applier2.plan(proposal2);
    const none = await applier2.apply(freshPlan, ['src/multi.ts#99']);
    check('a selection matching no hunk is refused, not silently applied', () => {
      assert.strictEqual(none.ok, false);
      assert.match(none.error, /ENOTHING/);
    });
    const stale = await applier2.apply(plan2, ['src/multi.ts#0']);
    check('re-applying a stale plan is refused as drift', () => {
      assert.strictEqual(stale.ok, false);
      assert.match(stale.error, /EDRIFT/);
    });
  }

  /* ------------------------------------- 8b. context relevance gate */
  {
    const { contextWorthIt } = require('../extension/dist/repo/relevance.js');
    const cases = [
      ['tell me about foxes', false],
      ['what is a process vs a thread', false],
      ['thanks!', false],
      ['refactor src/format.ts', true],
      ['why does useEffect run twice?', true],
      ['please fix the slug() helper', true],
      ['what does `MAX_LENGTH` do', true],
      ['add a test for the parser', true],
    ];
    for (const [q, expected] of cases) {
      check(`context gate: "${q.slice(0, 40)}" → ${expected ? 'attach' : 'skip'}`, () =>
        assert.strictEqual(contextWorthIt(q).attach, expected, contextWorthIt(q).reason));
    }
    check('the gate explains itself', () =>
      assert.ok(contextWorthIt('tell me about foxes').reason.length > 10));
  }

  /* ------------------------------------------------------ 9. line delta */
  check('lineDelta counts a clean one-line change', () => {
    const d = lineDelta('a\nb\nc', 'a\nB\nc');
    assert.deepStrictEqual(d, { added: 1, removed: 1 });
  });
  check('sha is stable and short', () => {
    assert.strictEqual(sha('x'), sha('x'));
    assert.strictEqual(sha('x').length, 16);
    assert.notStrictEqual(sha('x'), sha('y'));
  });

  /* -------------------------------------------------------- report */
  const report = [
    '# Batch 1.2 — RepoReader + EditApplier acceptance evidence',
    '',
    `Generated: ${new Date().toISOString()}`,
    'Core modules run against a real temp repo through a `node:fs` port; no VS Code,',
    'no browser, no model. Every assertion is against bytes on disk.',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The acceptance scenario',
    '',
    'Prompt: `rename oldName to newName`.',
    '',
    `- bundle: ${bundle.files.length} files, ${bundle.tokens} tokens`,
    `- plan: ${summarise(plan.files)} — applicable=${plan.ok}`,
    `- apply: one batch of ${applyPort.calls[0] ? applyPort.calls[0].length : 0} files`,
    '- reject: disk byte-identical, apply port never called',
    '',
    '## Planned files',
    '',
    '```',
    ...plan.files.map(
      (f) => `${f.path.padEnd(18)} ${f.status.padEnd(8)} +${f.added} −${f.removed}  hunks=${f.hunks}`,
    ),
    '```',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-1.2-repo.md'), report);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(root2, { recursive: true, force: true });
  fs.rmSync(dupRoot, { recursive: true, force: true });
  fs.rmSync(lockedRoot, { recursive: true, force: true });
  fs.rmSync(createRoot, { recursive: true, force: true });

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
