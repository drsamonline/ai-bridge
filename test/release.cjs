#!/usr/bin/env node
/**
 * The release machinery.
 *
 * A release that fires on every push is noise, and one that never fires is worse.
 * These checks pin the contract: publish only when the version changes, tag it,
 * attach the .vsix, and give the author one command to bump.
 */

'use strict';

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
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

const wf = (name) => path.join(ROOT, '.github', 'workflows', name);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

const release = read(wf('release.yml'));
const pages = read(wf('pages.yml'));
const ci = read(wf('ci.yml'));

check('a release workflow exists', () => assert.ok(release.length > 0));
check('it runs on pushes to main', () => assert.match(release, /branches:\s*\[main\]/));
check('it can be run by hand, with a force option', () => {
  assert.match(release, /workflow_dispatch/);
  assert.match(release, /force/);
});
check('it decides by comparing the version with an existing tag', () => {
  assert.match(release, /refs\/tags\/\$TAG/);
  assert.match(release, /changed=(true|false)/);
});
check('packaging only happens when the version changed', () =>
  assert.match(release, /if:\s*needs\.version\.outputs\.changed == 'true'/));
check('it tags as vX.Y.Z', () => assert.match(release, /TAG="v\$VERSION"/));
check('it attaches the .vsix to the release', () => {
  assert.match(release, /softprops\/action-gh-release/);
  assert.match(release, /files:.*\.vsix/);
});
check('every push publishes a rolling build, version or not', () => {
  // The package job must not be gated on a version change...
  const pkgJob = release.slice(release.indexOf('  package:'));
  assert.ok(!/^    if: needs\.version\.outputs\.changed/m.test(pkgJob), 'package job is gated');
  // ...and the rolling release must be unconditional.
  assert.match(release, /tag_name: latest-build/);
  const rolling = release.slice(release.indexOf('Publish the rolling build'), release.indexOf('Publish the versioned release'));
  assert.ok(!/if:/.test(rolling), 'the rolling release is conditional');
});
check('the versioned release is the one that is gated', () => {
  const versioned = release.slice(release.indexOf('Publish the versioned release'));
  assert.match(versioned, /if: needs\.version\.outputs\.changed == 'true'/);
  assert.match(versioned, /make_latest: true/);
});
check('the rolling build is a pre-release, so it never outranks a version', () => {
  const rolling = release.slice(release.indexOf('Publish the rolling build'), release.indexOf('Publish the versioned release'));
  assert.match(rolling, /prerelease: true/);
  assert.match(rolling, /make_latest: false/);
});
check('it tests before publishing', () => {
  assert.match(release, /npm run test:all/);
  assert.ok(release.indexOf('test:all') < release.indexOf('action-gh-release'), 'tests must run before the release step');
});
check('it needs write permission for contents', () => assert.match(release, /contents:\s*write/));

check('a Pages workflow exists and deploys docs/', () => {
  assert.match(pages, /upload-pages-artifact/);
  assert.match(pages, /path:\s*docs/);
});
check('Pages checks its assets before deploying', () => {
  assert.match(pages, /docs\/screenshots\/chat-panel\.png/);
});

check('CI still runs the whole suite', () => assert.match(ci, /npm run test:all/));

/* ---------------------------------------------------- the bump script */
function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-'));
  fs.mkdirSync(path.join(dir, 'extension'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  fs.copyFileSync(path.join(ROOT, 'extension', 'package.json'), path.join(dir, 'extension', 'package.json'));
  return dir;
}
const versionOf = (dir, which) =>
  JSON.parse(fs.readFileSync(path.join(dir, which), 'utf8')).version;
const bump = (dir, kind) =>
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'bump.mjs'), kind], {
    env: { ...process.env, BUMP_DIR: dir },
    encoding: 'utf8',
  });

check('bump patch increments the last number', () => {
  const dir = tempRepo();
  const before = versionOf(dir, 'extension/package.json');
  bump(dir, 'patch');
  const [a, b, c] = before.split('.').map(Number);
  assert.strictEqual(versionOf(dir, 'extension/package.json'), `${a}.${b}.${c + 1}`);
});
check('bump minor resets the patch', () => {
  const dir = tempRepo();
  const [a, b] = versionOf(dir, 'extension/package.json').split('.').map(Number);
  bump(dir, 'minor');
  assert.strictEqual(versionOf(dir, 'extension/package.json'), `${a}.${b + 1}.0`);
});
check('bump major resets minor and patch', () => {
  const dir = tempRepo();
  const [a] = versionOf(dir, 'extension/package.json').split('.').map(Number);
  bump(dir, 'major');
  assert.strictEqual(versionOf(dir, 'extension/package.json'), `${a + 1}.0.0`);
});
check('an explicit version is accepted', () => {
  const dir = tempRepo();
  bump(dir, '2.5.7');
  assert.strictEqual(versionOf(dir, 'extension/package.json'), '2.5.7');
});
check('both manifests move together', () => {
  const dir = tempRepo();
  bump(dir, 'patch');
  assert.strictEqual(versionOf(dir, 'package.json'), versionOf(dir, 'extension/package.json'));
});
check('an unknown bump is refused', () => {
  const dir = tempRepo();
  let failed = false;
  try {
    bump(dir, 'banana');
  } catch {
    failed = true;
  }
  assert.strictEqual(failed, true);
});
check('the two manifests agree in the repo right now', () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'package.json'), 'utf8')).version;
  assert.strictEqual(a, b);
});

const report = [
  '# Release machinery',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '```',
  ...results,
  '```',
  '',
  `Result: ${results.length - failures}/${results.length} passed.`,
  '',
  '## How a release happens',
  '',
  '1. `npm run version:bump patch` — both manifests move together.',
  '2. Commit and push to `main`.',
  '3. The workflow reads the version and checks for a `vX.Y.Z` tag.',
  '4. No tag → build, bundle, run the contract suite and the full suite, pack the `.vsix`.',
  '5. Publish a GitHub release at that commit with the `.vsix` attached, and make it latest.',
  '6. Tag exists → the build still runs, nothing is published.',
  '',
].join('\n');
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'release.md'), report);

console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
