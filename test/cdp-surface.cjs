/* The CDP surface, pinned.
 *
 * The bridge drives a browser the user is already logged into. Every protocol
 * command it can send is a capability it needs, a thing to keep working across
 * Chrome versions, and something the user's browser will be asked to do — so the
 * list is small on purpose and should only grow as a decision.
 *
 * `test/cdp-attach.cjs` already pins the attach-only policy ("no launch() call
 * anywhere in bridge/src"). This pins the other half: which commands we send once
 * we are attached.
 *
 *   node test/cdp-surface.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['bridge/src', 'shared/src', 'extension/src'];

/* Every command the bridge may send, and why it is there. Adding a line here is
 * the decision; the test only makes sure nobody skips it. */
const SURFACE = [
  ['HeapProfiler.collectGarbage', 'controller.ts — drop the heap after a detach instead of waiting for GC'],
  ['SystemInfo.getProcessInfo', 'controller.ts — the RAM watchdog needs the renderer\'s process stats'],
];

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|cjs|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Only a literal passed to a send-like call counts: a `Domain.method` that is a
// type reference (`ProjectState.decisions`) or a filename in a comment is not a
// protocol command.
const CALL = /\.(?:send|sendCommand|call)\w*\(\s*['"`]([A-Z][A-Za-z]+)\.([A-Za-z][A-Za-z0-9]*)/g;

const files = SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d), []));
ok('source files were scanned', files.length > 0, String(files.length));

const found = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(CALL)) {
    const command = match[1] + '.' + match[2];
    if (!found.has(command)) found.set(command, path.relative(ROOT, file));
  }
}

const allowed = new Map(SURFACE);
const unlisted = [...found.keys()].filter((c) => !allowed.has(c)).sort();
ok('every command sent is on the pinned list', unlisted.length === 0,
  unlisted.map((c) => c + ' (' + found.get(c) + ')').join(', '));

for (const [command, file] of found) {
  ok('pinned: ' + command, allowed.has(command), file);
}

const stale = SURFACE.map(([c]) => c).filter((c) => !found.has(c));
ok('no stale entry on the list', stale.length === 0, stale.join(', '));

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed' + (fail ? ' — ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
