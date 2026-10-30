#!/usr/bin/env node
/**
 * Generates the root `index.html` from `docs/index.html`.
 *
 * GitHub Pages on this repo is in legacy branch mode: it serves the repository
 * root of `main`, not `docs/`. So the page has to exist at the root too — and it
 * must not drift from the real one, hence this generator rather than a copy.
 *
 *   node scripts/build-landing.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'docs', 'index.html');
const OUT = path.join(ROOT, 'index.html');

let html = fs.readFileSync(SRC, 'utf8');

// Paths are written relative to docs/; from the repository root they need a prefix.
html = html
  .replace(/src="badges\//g, 'src="docs/badges/')
  .replace(/href="badges\//g, 'href="docs/badges/')
  .replace(/src="screenshots\//g, 'src="docs/screenshots/')
  .replace(/src="\.\.\/extension\/media\//g, 'src="extension/media/')
  .replace(/href="\.\.\/extension\/media\//g, 'href="extension/media/')
  // A note in the source, so nobody edits the generated file by hand.
  .replace(
    '<!doctype html>',
    '<!doctype html>\n<!-- Generated from docs/index.html by scripts/build-landing.mjs — edit that file, not this one. -->',
  );

fs.writeFileSync(OUT, html);
console.log(`index.html written from docs/index.html (${(html.length / 1024).toFixed(1)} KB)`);
