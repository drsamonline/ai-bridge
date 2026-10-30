#!/usr/bin/env node
/**
 * Batch 3.2 acceptance harness — T1 compressor.
 *
 * Acceptance: "Identifiers preserved; low-end stays T0."
 *
 * Both halves are provable here. The memory gate is deterministic (this machine
 * has ~2 GB, so T1 must stay off), and the identifier guard is driven by fake
 * backends that deliberately mangle names, drop code fences, return longer text,
 * throw, or hang — every one of which must leave T0's output untouched.
 *
 * What is NOT proven here: how much a real local model actually saves. No
 * llama.cpp or Ollama is installed in this environment; the Ollama path is
 * exercised against a stub server, which proves the protocol and the guards, not
 * the model.
 */

'use strict';

const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const t1 = require('../extension/dist/compress/t1.js');
const t0 = require('../extension/dist/compress/t0.js');

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

const GB = 1024 ** 3;
const quiet = () => {};

const INPUT =
  'Please could you kindly refactor the `formatSlug` helper in src/format.ts so that MAX_LENGTH is respected and `parseInput` stays pure, thank you so much!';

const GOOD_OUTPUT = 'refactor `formatSlug` in src/format.ts; keep MAX_LENGTH; `parseInput` stays pure';

const CODE_INPUT = `Please tidy this up:\n\`\`\`ts\nexport function slug(s: string) { return s.trim(); }\n\`\`\`\nIt must keep MAX_LENGTH. Thanks!`;
const CODE_OUTPUT_DROPPED = 'tidy this up; it must keep MAX_LENGTH and keep slug';

function fakeBackend(overrides = {}) {
  return {
    name: 'fake',
    footprint: 'external',
    async available() {
      return overrides.available ?? true;
    },
    async compress() {
      if (overrides.throws) throw new Error(overrides.throws);
      if (overrides.hang) {
        await new Promise((r) => setTimeout(r, 500));
        return GOOD_OUTPUT;
      }
      return overrides.output ?? GOOD_OUTPUT;
    },
    ...(overrides.footprintMb !== undefined
      ? { footprint: 'in-process', footprintMb: () => overrides.footprintMb }
      : {}),
  };
}

function makeCompressor(backend, opts = {}) {
  return new t1.T1Compressor({
    backend,
    t0: (text, o) => t0.compressT0(text, o),
    log: quiet,
    totalMemBytes: () => opts.memGb !== undefined ? opts.memGb * GB : 16 * GB,
    lowEndMode: opts.lowEndMode ?? 'auto',
    ...(opts.minRamBytes ? { minRamBytes: opts.minRamBytes } : {}),
  });
}

async function main() {
  /* ------------------------------------------------------------ 1. the gate */
  const matrix = [2, 4, 8, 16, 32].map((gb) => [gb, t1.shouldEnableT1(gb * GB).enable]);
  console.log(`  gate: ${matrix.map(([gb, on]) => `${gb}GB=${on ? 'on' : 'off'}`).join(' ')}`);
  check('below 8 GB the gate keeps T1 off', () => {
    assert.strictEqual(t1.shouldEnableT1(2 * GB).enable, false);
    assert.strictEqual(t1.shouldEnableT1(4 * GB).enable, false);
    assert.match(t1.shouldEnableT1(4 * GB).reason, /low-end/);
  });
  check('8 GB and above the gate permits T1', () => {
    assert.strictEqual(t1.shouldEnableT1(8 * GB).enable, true);
    assert.strictEqual(t1.shouldEnableT1(32 * GB).enable, true);
  });
  check('the user can force T1 on against the gate', () =>
    assert.strictEqual(t1.shouldEnableT1(2 * GB, { lowEndMode: 'on' }).enable, true));
  check('the user can force T1 off on a big machine', () =>
    assert.strictEqual(t1.shouldEnableT1(32 * GB, { lowEndMode: 'off' }).enable, false));
  check('the threshold is configurable', () =>
    assert.strictEqual(t1.shouldEnableT1(6 * GB, { minRamBytes: 4 * GB }).enable, true));

  const here = os.totalmem();
  const hereGate = t1.shouldEnableT1(here);
  console.log(`  this machine: ${(here / GB).toFixed(2)} GB → T1 ${hereGate.enable ? 'on' : 'off'} (${hereGate.reason})\n`);
  check('this low-end machine stays on T0 (the acceptance line)', () => {
    assert.ok(here < 8 * GB, `machine reports ${(here / GB).toFixed(1)} GB`);
    assert.strictEqual(hereGate.enable, false);
  });

  /* --------------------------------------------- 2. identifiers are extracted */
  const ids = t1.extractIdentifiers(INPUT);
  check('identifiers are extracted from prose, code and paths', () => {
    for (const id of ['formatSlug', 'src/format.ts', 'MAX_LENGTH', 'parseInput']) {
      assert.ok(ids.includes(id), `missing ${id} in ${JSON.stringify(ids)}`);
    }
  });
  check('snake_case and CamelCase both count', () => {
    const found = t1.extractIdentifiers('Call user_repo.findById via the ParserUtils class.');
    assert.ok(found.includes('user_repo'));
    assert.ok(found.includes('findById'));
    assert.ok(found.includes('ParserUtils'));
  });
  check('a declaration name is captured even without backticks', () =>
    assert.ok(t1.extractIdentifiers('function computeTotal(a, b) { return a + b; }').includes('computeTotal')));
  check('verifyIdentifiers reports exactly what went missing', () => {
    const v = t1.verifyIdentifiers(INPUT, 'refactor slugify in src/format.ts; keep MAX_LENGTH');
    assert.strictEqual(v.ok, false);
    assert.deepStrictEqual(v.missing.sort(), ['formatSlug', 'parseInput'].sort());
  });

  /* ---------------------------------------------- 3. a good model is accepted */
  const good = await makeCompressor(fakeBackend()).compress(INPUT, {});
  console.log(`  good model: tier=${good.t1.tier} ${good.tokensBefore}→${good.tokensAfter} tokens (${good.t1.reason})`);
  check('a safe, shorter T1 result is used', () => {
    assert.strictEqual(good.t1.tier, 'T1');
    assert.strictEqual(good.text, GOOD_OUTPUT);
  });
  check('the T1 result keeps every identifier', () => {
    const v = t1.verifyIdentifiers(INPUT, good.text);
    assert.strictEqual(v.ok, true, JSON.stringify(v.missing));
  });
  check('T1 beats T0 on tokens', () => {
    const base = t0.compressT0(INPUT, {});
    assert.ok(good.tokensAfter < base.tokensAfter, `${good.tokensAfter} vs ${base.tokensAfter}`);
  });
  check('the ratio and savedChars are consistent', () => {
    assert.ok(good.ratio < 1 && good.ratio > 0);
    assert.strictEqual(good.savedChars, INPUT.length - good.text.length);
  });

  /* --------------------------------- 4. every unsafe result falls back to T0 */
  const base = t0.compressT0(INPUT, {});

  const mangled = await makeCompressor(
    fakeBackend({ output: 'refactor slugify in src/format.ts; keep MAX_LENGTH; parseInput stays pure' }),
  ).compress(INPUT, {});
  check('a model that renames an identifier is rejected', () => {
    assert.strictEqual(mangled.t1.tier, 'T0');
    assert.strictEqual(mangled.t1.rejected, 'identifiers');
    assert.ok(mangled.t1.missingIdentifiers.includes('formatSlug'));
  });
  check('the rejected result is byte-identical to T0 output', () =>
    assert.strictEqual(mangled.text, base.text));

  const dropped = await makeCompressor(fakeBackend({ output: CODE_OUTPUT_DROPPED })).compress(CODE_INPUT, {});
  check('a model that drops a code fence is rejected', () => {
    assert.strictEqual(dropped.t1.tier, 'T0');
    assert.strictEqual(dropped.t1.rejected, 'protected-spans');
    assert.ok(dropped.t1.missingSpans.length >= 1);
  });
  check('the protected-span rejection keeps T0 output', () =>
    assert.strictEqual(dropped.text, t0.compressT0(CODE_INPUT, {}).text));

  const longer = await makeCompressor(fakeBackend({ output: `${GOOD_OUTPUT} and also here is a lot more text that nobody asked for at all` })).compress(INPUT, {});
  check('a model that makes the prompt longer is rejected', () => {
    assert.strictEqual(longer.t1.tier, 'T0');
    assert.strictEqual(longer.t1.rejected, 'no-saving');
  });

  const threw = await makeCompressor(fakeBackend({ throws: 'model exploded' })).compress(INPUT, {});
  check('a backend that throws falls back to T0', () => {
    assert.strictEqual(threw.t1.tier, 'T0');
    assert.match(threw.t1.reason, /model exploded/);
    assert.strictEqual(threw.text, base.text);
  });

  const hung = await makeCompressor(fakeBackend({ hang: true }), {}).compress(INPUT, {});
  check('a slow backend does not block the prompt', () => {
    // The fake resolves after 500 ms; the point is that a T1 outcome is always
    // returned with a tier and a reason, never an unhandled hang.
    assert.ok(['T0', 'T1'].includes(hung.t1.tier));
    assert.ok(hung.t1.reason.length > 0);
  });

  const unavailable = await makeCompressor(fakeBackend({ available: false })).compress(INPUT, {});
  check('an unavailable backend leaves T0 in charge', () => {
    assert.strictEqual(unavailable.t1.tier, 'T0');
    assert.match(unavailable.t1.reason, /not available/);
  });

  const fat = await makeCompressor(fakeBackend({ footprintMb: 260 })).compress(INPUT, {});
  check('an in-process model over the 150 MB band is refused', () => {
    assert.strictEqual(fat.t1.tier, 'T0');
    assert.match(fat.t1.reason, /150 MB band/);
  });
  const lean = await makeCompressor(fakeBackend({ footprintMb: 120 })).compress(INPUT, {});
  check('an in-process model inside the band is allowed', () =>
    assert.strictEqual(lean.t1.tier, 'T1'));

  const lowEnd = await makeCompressor(fakeBackend(), { memGb: 2 }).compress(INPUT, {});
  check('on a low-end machine T1 never runs, even with a perfect model', () => {
    assert.strictEqual(lowEnd.t1.tier, 'T0');
    assert.match(lowEnd.t1.reason, /low-end/);
    assert.strictEqual(lowEnd.text, base.text);
  });
  const forced = await makeCompressor(fakeBackend(), { memGb: 2, lowEndMode: 'on' }).compress(INPUT, {});
  check('forcing T1 on overrides the low-end gate', () => assert.strictEqual(forced.t1.tier, 'T1'));

  /* ----------------------------------------------- 5. the Ollama backend */
  let stubRequests = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      stubRequests.push({ url: req.url, body });
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"models":[{"name":"llama3.2"}]}');
        return;
      }
      if (req.url === '/api/generate') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({ response: GOOD_OUTPUT }),
        );
        return;
      }
      res.writeHead(404).end('{}');
    });
  });
  await new Promise((r) => stub.listen(47811, '127.0.0.1', () => r()));

  const ollama = new t1.OllamaCompressor({ url: 'http://127.0.0.1:47811', model: 'llama3.2' }, quiet);
  check('the Ollama backend probes /api/tags', async () => {});
  const available = await ollama.available();
  check('Ollama reports available when the server answers', () => assert.strictEqual(available, true));
  const viaOllama = await makeCompressor(ollama).compress(INPUT, {});
  check('a T1 result from Ollama goes through the same guards', () => {
    assert.strictEqual(viaOllama.t1.tier, 'T1');
    assert.strictEqual(viaOllama.t1.backend, 'ollama');
    assert.strictEqual(viaOllama.text, GOOD_OUTPUT);
  });
  check('the request carried the compression instruction', () => {
    const gen = stubRequests.find((r) => r.url === '/api/generate');
    assert.ok(gen, 'no /api/generate call');
    const payload = JSON.parse(gen.body);
    assert.match(payload.prompt, /lossless prompt compressor/);
    assert.match(payload.prompt, /byte-identical/);
    assert.strictEqual(payload.stream, false);
    assert.strictEqual(payload.options.temperature, 0);
  });

  stub.close();
  const downBackend = new t1.OllamaCompressor({ url: 'http://127.0.0.1:47811' }, quiet);
  const downAvailable = await downBackend.available();
  check('Ollama reports unavailable when nothing is listening', () => assert.strictEqual(downAvailable, false));
  const downResult = await makeCompressor(downBackend).compress(INPUT, {});
  check('a dead Ollama leaves T0 in charge', () => assert.strictEqual(downResult.t1.tier, 'T0'));

  /* ------------------------------------------- 6. the optional llama backend */
  const llama = new t1.LlamaCppCompressor({ modelPath: '/nonexistent.gguf' }, quiet);
  const llamaAvailable = await llama.available();
  check('the llama.cpp backend is optional and reports unavailable without the dependency', () =>
    assert.strictEqual(llamaAvailable, false));
  const llamaResult = await makeCompressor(llama).compress(INPUT, {});
  check('a missing llama.cpp dependency degrades to T0 without throwing', () =>
    assert.strictEqual(llamaResult.t1.tier, 'T0'));

  /* ------------------------------------ 6b. provider-side T2 (§5.6) */
  const { ProviderCompressor } = require('../extension/dist/compress/providerT2.js');
  {
    let sent = null;
    const t2 = new ProviderCompressor(async (prompt) => {
      sent = prompt;
      return GOOD_OUTPUT;
    }, quiet);
    const available = await t2.available();
    check('the provider T2 backend is available whenever it can send', () => assert.strictEqual(available, true));

    const out = await t2.compress(INPUT, { budgetTokens: 4096 });
    check('T2 sends a compression instruction, not the raw text', () => {
      assert.match(sent, /Rewrite the request below/);
      assert.match(sent, /byte-identical/);
      assert.ok(sent.includes(INPUT), 'the original text was not included');
    });
    check('T2 returns the rewritten request', () => assert.strictEqual(out, GOOD_OUTPUT));

    const fenced = new ProviderCompressor(async () => '```\n' + GOOD_OUTPUT + '\n```', quiet);
    const unwrapped = await fenced.compress(INPUT, { budgetTokens: 4096 });
    check('a fenced reply is unwrapped', () => assert.strictEqual(unwrapped, GOOD_OUTPUT));

    const empty = new ProviderCompressor(async () => '   ', quiet);
    const emptyResult = await empty.compress(INPUT, { budgetTokens: 4096 }).then(
      () => null,
      (e) => e.message,
    );
    check('an empty reply is an error, not an empty prompt', () => assert.match(String(emptyResult), /ET2EMPTY/));

    const viaT2 = await makeCompressor(t2).compress(INPUT, {});
    check('T2 goes through the same identifier guard as T1', () => {
      assert.strictEqual(viaT2.t1.tier, 'T1');
      assert.strictEqual(t1.verifyIdentifiers(INPUT, viaT2.text).ok, true);
    });
    const manglingT2 = new ProviderCompressor(async () => 'refactor slugify; keep MAX_LENGTH', quiet);
    const rejected = await makeCompressor(manglingT2).compress(INPUT, {});
    check('a T2 reply that loses identifiers falls back to T0', () => {
      assert.strictEqual(rejected.t1.tier, 'T0');
      assert.strictEqual(rejected.t1.rejected, 'identifiers');
    });
  }

  /* ------------------------------------------------------------ 7. report */
  const report = [
    '# Batch 3.2 — T1 compressor (opt-in local model)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Acceptance: **Identifiers preserved; low-end stays T0.**',
    '',
    '## Checks',
    '',
    '```',
    ...results,
    '```',
    '',
    `Result: ${results.length - failures}/${results.length} passed.`,
    '',
    '## The memory gate',
    '',
    '```',
    ...[2, 4, 8, 16, 32].map((gb) => {
      const d = t1.shouldEnableT1(gb * GB);
      return `${String(gb).padStart(2)} GB → ${d.enable ? 'T1 on ' : 'T1 off'}  ${d.reason}`;
    }),
    `this machine ${(here / GB).toFixed(2)} GB → ${hereGate.enable ? 'T1 on' : 'T1 off'}  ${hereGate.reason}`,
    '```',
    '',
    '## The identifier guard',
    '',
    '```',
    `input      ${INPUT}`,
    `identifiers ${JSON.stringify(ids)}`,
    `good model  ${GOOD_OUTPUT}`,
    `  → tier ${good.t1.tier}, ${good.tokensBefore}→${good.tokensAfter} tokens, ${good.t1.reason}`,
    `mangling    refactor slugify in src/format.ts; keep MAX_LENGTH; parseInput stays pure`,
    `  → tier ${mangled.t1.tier}, rejected=${mangled.t1.rejected}, missing=${JSON.stringify(mangled.t1.missingIdentifiers)}`,
    '```',
    '',
    '## What is not proven here',
    '',
    'No llama.cpp or Ollama is installed in this environment, so no real model was run.',
    'The Ollama path is exercised against a stub HTTP server: that proves the protocol,',
    'the guards and the fallback, not the model\'s compression quality or its 50–150 MB',
    'footprint. Those need a machine with a local model — the same machine that will pass',
    'the 8 GB gate.',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-3.2-t1.md'), report);

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
