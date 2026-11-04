#!/usr/bin/env node
/**
 * Runs the suite list from `test:all`, one suite at a time, with a timeout.
 *
 * Why this exists: a chain of `a && b && c` gives no progress output and no bound.
 * A suite that hangs takes the whole job's timeout, and the log just stops — which
 * is exactly what happened when `test/launch.cjs` waited on a port that never
 * answered: 27 minutes of silence before the job was cancelled, with nothing
 * naming the culprit.
 *
 * The list comes from `test:all` rather than from a directory scan, so this stays
 * an executor and `test:all` stays the single source of truth (test/contract.cjs
 * enforces that every suite appears there).
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TIMEOUT_MS = Number(
  (process.argv.find((arg) => arg.startsWith('--timeout=')) ?? '').split('=')[1] ?? 180,
) * 1000;

const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
const chain = scripts['test:all'] ?? '';

const suites = [...chain.matchAll(/node\s+(test\/[\w.-]+\.cjs)/g)].map((match) => match[1]);
if (suites.length === 0) {
  console.error('no suites found in test:all');
  process.exit(1);
}

console.log(`${suites.length} suites, ${TIMEOUT_MS / 1000}s each\n`);

let slowest = { name: '', ms: 0 };
for (const [index, suite] of suites.entries()) {
  const name = path.basename(suite, '.cjs');
  process.stdout.write(`[${String(index + 1).padStart(2)}/${suites.length}] ${name.padEnd(18)} `);
  const started = Date.now();
  const result = spawnSync(process.execPath, [suite], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const elapsed = Date.now() - started;
  if (elapsed > slowest.ms) slowest = { name, ms: elapsed };

  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGKILL') {
    console.log(`TIMEOUT after ${(elapsed / 1000).toFixed(0)}s`);
    console.error(`\n::error::${name} exceeded ${TIMEOUT_MS / 1000}s — this is the suite to fix.`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.log(`FAILED (${(elapsed / 1000).toFixed(1)}s)`);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n');
    console.error(`\n::error::${name} failed — last lines:\n${output.slice(-25).join('\n')}`);
    process.exit(1);
  }
  console.log(`ok (${(elapsed / 1000).toFixed(1)}s)`);
}

console.log(`\nall ${suites.length} suites passed — slowest: ${slowest.name} ${(slowest.ms / 1000).toFixed(1)}s`);
