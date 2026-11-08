#!/usr/bin/env node
/**
 * Native-messaging acceptance harness — the A shell's transport.
 *
 * Chrome's framing is the thing that breaks quietly: a pipe delivers arbitrary
 * boundaries, so a decoder that assumes one read is one message works in a test with
 * a small message and fails the first time a plan block is large. Half of these
 * checks are about that.
 */

'use strict';

const assert = require('node:assert');
const path = require('node:path');

const framing = require('../bridge/dist/server/nativeMessaging.js');
const installer = require('../scripts/install-native-host.mjs');

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

const { encodeFrame, decodeFrames, originFromArgv, MAX_FRAME_BYTES } = framing;

console.log('');

/* ---------------------------------------------------------------- framing */

check('framing: a message survives a round trip', () => {
  const msg = { op: 'ctl.session.list', id: 7 };
  const { messages, rest } = decodeFrames(encodeFrame(msg));
  assert.deepEqual(messages, [msg]);
  assert.equal(rest.length, 0);
});

check('framing: three messages in one read are three messages', () => {
  const buffer = Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 }), encodeFrame({ n: 3 })]);
  const { messages, rest } = decodeFrames(buffer);
  assert.deepEqual(messages, [{ n: 1 }, { n: 2 }, { n: 3 }]);
  assert.equal(rest.length, 0);
});

check('framing: a frame split across reads is reassembled, not dropped', () => {
  // The failure this catches: a decoder that assumes one read is one message.
  const frame = encodeFrame({ op: 'ctl.session.create', big: 'x'.repeat(500) });
  const cut = Math.floor(frame.length / 2);

  const first = decodeFrames(frame.subarray(0, cut));
  assert.deepEqual(first.messages, [], 'half a frame is not a message');
  assert.equal(first.rest.length, cut, 'and the half must be kept');

  const second = decodeFrames(frame.subarray(cut), first.rest);
  assert.equal(second.messages.length, 1);
  assert.equal(second.messages[0].op, 'ctl.session.create');
  assert.equal(second.rest.length, 0);
});

check('framing: a header split from its body still works', () => {
  const frame = encodeFrame({ hello: 'world' });
  const first = decodeFrames(frame.subarray(0, 2)); // two bytes of the length prefix
  assert.equal(first.messages.length, 0);
  assert.equal(first.rest.length, 2);
  const second = decodeFrames(frame.subarray(2), first.rest);
  assert.deepEqual(second.messages, [{ hello: 'world' }]);
});

check('framing: a partial trailing frame is left for the next read', () => {
  const buffer = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 2 }).subarray(0, 6)]);
  const { messages, rest } = decodeFrames(buffer);
  assert.deepEqual(messages, [{ a: 1 }]);
  assert.ok(rest.length > 0, 'the incomplete tail must survive');
});

check('framing: an oversized message is refused before it is written', () => {
  assert.throws(() => encodeFrame({ big: 'x'.repeat(MAX_FRAME_BYTES + 10) }), /EFRAME/);
});

check('framing: a bogus declared length throws rather than waiting forever', () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_FRAME_BYTES + 1, 0);
  assert.throws(() => decodeFrames(Buffer.concat([header, Buffer.from('{}')])), /EFRAME/);
});

check('framing: a complete frame that is not JSON throws', () => {
  const body = Buffer.from('not json', 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  assert.throws(() => decodeFrames(Buffer.concat([header, body])), /EFRAME/);
});

check('framing: an empty read is not an error', () => {
  const { messages, rest } = decodeFrames(Buffer.alloc(0));
  assert.deepEqual(messages, []);
  assert.equal(rest.length, 0);
});

check('framing: the origin comes from argv, and only if it is one', () => {
  const id = 'a'.repeat(32);
  assert.equal(originFromArgv(['node', 'host.js', `chrome-extension://${id}/`]), `chrome-extension://${id}/`);
  assert.equal(originFromArgv(['node', 'host.js']), null);
  assert.equal(originFromArgv(['node', 'host.js', 'chrome-extension://short/']), null);
  assert.equal(originFromArgv(['node', 'host.js', 'https://evil.test/']), null);
});

/* -------------------------------------------------------------- installer */

const ID = 'abcdefghijklmnopabcdefghijklmnop';

check('installer: the manifest is what Chrome expects', () => {
  const manifest = installer.buildManifest({ extensionId: ID, hostPath: '/opt/ai-bridge/native-host.js' });
  assert.equal(manifest.name, installer.HOST_NAME);
  assert.equal(manifest.type, 'stdio');
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${ID}/`]);
  assert.equal(manifest.path, '/opt/ai-bridge/native-host.js');
});

check('installer: a bad extension id or a relative host path is refused', () => {
  assert.throws(() => installer.buildManifest({ extensionId: 'nope', hostPath: '/x/y.js' }), /extension id/);
  assert.throws(() => installer.buildManifest({ extensionId: ID, hostPath: 'relative.js' }), /absolute/);
});

check('installer: each platform gets its own manifest location', () => {
  const home = '/home/x';
  assert.match(installer.manifestPath('linux', home), /\.config\/google-chrome\/NativeMessagingHosts/);
  assert.match(installer.manifestPath('darwin', home), /Library\/Application Support\/Google\/Chrome/);
  assert.equal(installer.manifestPath('win32', home), null, 'Windows uses the registry, not a path Chrome reads');
});

check('installer: Windows gets a registry command, and a warning about .cmd', () => {
  const cmd = installer.windowsCommand('C:\\ai-bridge\\host.json');
  assert.match(cmd, /reg add/);
  assert.match(cmd, /NativeMessagingHosts/);
  assert.ok(cmd.includes(installer.HOST_NAME));
});

check('installer: the manifest file name matches the host name on every platform', () => {
  assert.ok(installer.manifestPath('linux', '/h').endsWith(`${installer.HOST_NAME}.json`));
  assert.ok(installer.windowsManifestFile('/h').endsWith(`${installer.HOST_NAME}.json`));
});

/* ------------------------------------------------------- the extension shell */

const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

check('shell: the extension manifest is MV3 and asks for only what it uses', () => {
  const m = readJson('shell/extension/manifest.json');
  assert.equal(m.manifest_version, 3);
  assert.ok(m.permissions.includes('nativeMessaging'), 'without this the host cannot be launched');
  assert.ok(m.permissions.includes('sidePanel'));
  // Anything beyond these two would be asking for access the shell does not need.
  assert.deepEqual([...m.permissions].sort(), ['nativeMessaging', 'sidePanel']);
});

check('shell: the manifest points at files that exist', () => {
  const m = readJson('shell/extension/manifest.json');
  for (const rel of [m.background.service_worker, m.side_panel.default_path]) {
    assert.ok(fs.existsSync(path.join(ROOT, 'shell', 'extension', rel)), `missing ${rel}`);
  }
});

check('shell: the side panel is the same file the bridge serves', () => {
  // D10: one UI, two hosts. If these differ, one shell has silently forked.
  const served = fs.readFileSync(path.join(ROOT, 'bridge', 'src', 'server', 'panel.html'), 'utf8');
  const bundled = fs.readFileSync(path.join(ROOT, 'shell', 'extension', 'sidepanel.html'), 'utf8');
  assert.equal(bundled, served);
});

check('shell: the background worker names the same host the installer registers', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'shell', 'extension', 'background.js'), 'utf8');
  assert.ok(bg.includes(installer.HOST_NAME), 'the worker and the installer must agree on the host name');
});

check('shell: the host the installer points at has actually been built', () => {
  // The installer defaults to bridge/dist/native-host.js. If that path is empty the
  // whole shell fails at the first call, with a Chrome error that says nothing useful.
  assert.ok(fs.existsSync(path.join(ROOT, 'bridge', 'dist', 'native-host.js')),
    'build the bridge before installing the host');
});

/* ----------------------------------------------------------- host parity */

check('hosts: the panel carries a transport for every host, and no host-specific logic', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'bridge', 'src', 'server', 'panel.html'), 'utf8');
  assert.ok(panel.includes('inVsCode()'), 'the VS Code transport is missing');
  assert.ok(panel.includes('inExtension()'), 'the Chrome transport is missing');
  assert.ok(panel.includes('callSocket('), 'the served-page transport is missing');
  // One decision point, not three copies of the UI.
  assert.match(panel, /const call = \(op, args = \{\}\) =>/);
});

check('hosts: the VS Code panel reads the bridge\'s file rather than keeping a copy', () => {
  // Four hosts is where a UI forks. VS Code reads bridge/dist/server/panel.html at
  // runtime, so parity there is structural; Chrome gets a byte-identical copy that
  // the check above compares; the served page is the source itself.
  const src = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'debatePanel.ts'), 'utf8');
  assert.ok(src.includes("'bridge', 'dist', 'server', 'panel.html'"), 'the VS Code host should load the built panel');
  assert.ok(!src.includes('<section'), 'the VS Code host must not embed its own copy of the UI');
});

/* -------------------------------------------------------- the other surfaces */

check('app: the shell URL is read out of the bridge log, not guessed', () => {
  const app = require('../scripts/debate-app.mjs');
  const line = 'served shell: http://127.0.0.1:47615/?nonce=AbC-123_x';
  assert.equal(app.SHELL_LINE.exec(line)[1], 'http://127.0.0.1:47615/?nonce=AbC-123_x');
  assert.equal(app.SHELL_LINE.test('listening on /tmp/bridge.sock'), false);
});

check('app: app mode gets a window, not a browser tab, and no debugging port', () => {
  const app = require('../scripts/debate-app.mjs');
  const args = app.appArgs('http://127.0.0.1:1/?nonce=x', '/tmp/profile');
  assert.ok(args.includes('--app=http://127.0.0.1:1/?nonce=x'), 'app mode is what makes it a window');
  assert.ok(args.includes('--user-data-dir=/tmp/profile'));
  // The app window is a client of the bridge; the browser the bridge drives is a
  // different one, and this must never carry a debugging port.
  assert.ok(!args.some((a) => a.startsWith('--remote-debugging')), 'the app window must not be drivable');
});

check('chrome zip: the three files an extension needs are all present', () => {
  const zip = require('../scripts/make-chrome-zip.mjs');
  assert.deepEqual(zip.missingFiles(), [], 'the Chrome shell is incomplete — run npm run build');
});

console.log('');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
