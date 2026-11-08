#!/usr/bin/env node
/**
 * Package the Chrome shell as a zip you can load unpacked or hand to a reviewer.
 *
 * The three files are the whole extension: the manifest, the background relay, and
 * the side panel. The panel is not stored here — `copy-assets.mjs` writes it from
 * `bridge/src/server/panel.html` so the two hosts cannot drift.
 *
 * What this deliberately does not do: produce a Web Store upload. That needs a
 * reviewer, a listing and a publisher key, and it is a decision rather than a build
 * step. Loading unpacked is what a user actually does with this today.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'shell', 'extension');
const OUT = path.join(ROOT, 'ai-bridge-debate-chrome.zip');
const REQUIRED = ['manifest.json', 'background.js', 'sidepanel.html'];

export function missingFiles(dir = SRC) {
  return REQUIRED.filter((name) => !fs.existsSync(path.join(dir, name)));
}

function main() {
  const missing = missingFiles();
  if (missing.length > 0) {
    console.error(`the Chrome shell is incomplete: ${missing.join(', ')}`);
    console.error('run `npm run build` first — sidepanel.html comes from copy-assets');
    process.exit(1);
  }

  // Version the artefact by the manifest's own version, not the extension's.
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));

  fs.rmSync(OUT, { force: true });
  // -X strips extra fields: the same reason make-vsix.mjs does, and the same class of
  // failure if forgotten.
  execFileSync('zip', ['-qrX', OUT, ...REQUIRED], { cwd: SRC, stdio: 'inherit' });

  const listing = execFileSync('unzip', ['-Z1', OUT], { encoding: 'utf8' }).trim().split('\n');
  for (const name of REQUIRED) {
    if (!listing.includes(name)) {
      console.error(`the zip is missing ${name} — it would fail to load`);
      process.exit(1);
    }
  }

  const size = fs.statSync(OUT).size;
  console.log(`built ${path.basename(OUT)} (${(size / 1024).toFixed(1)} KB) — ${manifest.name} ${manifest.version}`);
  console.log('load it at chrome://extensions → Developer mode → Load unpacked (unzip first)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
