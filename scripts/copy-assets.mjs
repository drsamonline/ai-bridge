#!/usr/bin/env node
/**
 * Copy the runtime assets tsc does not.
 *
 * The served shell's panel is a single HTML file, not a module, so `tsc -b` leaves
 * it behind. It has to sit next to the compiled server in `dist/` because that is
 * where the process reads it from — and because the .vsix ships `bridge/dist` and
 * nothing else, so a runtime path back into `src/` would work in the repo and fail
 * in the installed extension.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSETS = [['bridge/src/server/panel.html', 'bridge/dist/server/panel.html']];

let copied = 0;
for (const [from, to] of ASSETS) {
  const src = path.join(ROOT, from);
  const dest = path.join(ROOT, to);
  if (!fs.existsSync(src)) {
    console.error(`copy-assets: missing ${from}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied += 1;
}
console.log(`copy-assets: ${copied} file(s)`);
