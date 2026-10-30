#!/usr/bin/env node
/**
 * Bumps the version in both manifests, so the release workflow has something to
 * notice.
 *
 *   npm run version:bump patch   # 0.20.0 -> 0.20.1
 *   npm run version:bump minor   # 0.20.0 -> 0.21.0
 *   npm run version:bump major   # 0.20.0 -> 1.0.0
 *   npm run version:bump 1.2.3   # explicit
 *
 * Then commit and push: the release workflow sees a version with no `vX.Y.Z` tag
 * and publishes.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.BUMP_DIR
  ? path.resolve(process.env.BUMP_DIR)
  : path.resolve(import.meta.dirname, '..');

const FILES = ['package.json', 'extension/package.json'];

function bump(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [major, minor, patch] = current.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump "${kind}" — use patch, minor, major or an explicit x.y.z`);
}

const kind = process.argv[2] ?? 'patch';
const rootPkg = path.join(ROOT, 'package.json');
const extPkg = path.join(ROOT, 'extension', 'package.json');

for (const f of [rootPkg, extPkg]) {
  if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
}

const before = JSON.parse(fs.readFileSync(extPkg, 'utf8')).version;
const next = bump(before, kind);

for (const f of [rootPkg, extPkg]) {
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  json.version = next;
  if (json.scripts?.package) {
    json.scripts.package = json.scripts.package.replace(/ai-bridge-[\d.]+\.vsix/g, `ai-bridge-${next}.vsix`);
  }
  fs.writeFileSync(f, `${JSON.stringify(json, null, 2)}\n`);
}

console.log(`${before} → ${next}`);
console.log(`next: commit and push — the release workflow publishes v${next}`);
