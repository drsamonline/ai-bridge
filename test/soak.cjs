#!/usr/bin/env node
/**
 * Idle soak — the batch 0.2 acceptance criterion that needs wall-clock time.
 *
 *   node test/soak.cjs --minutes 10 [--cap 500]
 *
 * Launches a Chromium fixture, attaches, then samples browser RSS every 3 s for
 * the whole window. Prints a table and writes docs/batch-0.2-soak.md.
 *
 * Pass/fail:
 *   • every sample below the cap                      (hard)
 *   • drift between the first and last sample < 10%   (hard)
 *   • the absolute 500 MB figure is only asserted when the kernel gives a true
 *     footprint (PSS or shared-page accounting); otherwise the number is
 *     reported as an RSS upper bound and the cap check uses --cap as given.
 */

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const shared = require('../shared/dist/index.js');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE_ENTRY = path.join(ROOT, 'bridge', 'dist', 'main.js');
const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
const CDP_PORT = Number(process.env.SOAK_CDP_PORT || 9222);
const BRIDGE_PORT = Number(process.env.SOAK_BRIDGE_PORT || 47803);

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const MINUTES = Number(argOf('minutes', 10));
const CAP_MB = Number(argOf('cap', 500));
const POLL_MS = 3000;
const MB = 1048576;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdpVersion(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(res.statusCode === 200 ? JSON.parse(body) : null));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-soak-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-soak-prof-'));

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  await waitFor(async () => (await cdpVersion(CDP_PORT)) !== null, 20000, 'chromium CDP endpoint');

  const bridgeLog = [];
  const bridge = spawn(process.execPath, [BRIDGE_ENTRY], {
    env: {
      ...process.env,
      AI_BRIDGE_HOME: home,
      AI_BRIDGE_PORT: String(BRIDGE_PORT),
      AI_BRIDGE_CDP_PORTS: String(CDP_PORT),
      AI_BRIDGE_RAM_CAP_MB: String(CAP_MB),
      AI_BRIDGE_POLL_MS: String(POLL_MS),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (b) => {
    for (const line of b.toString().split('\n')) if (line.trim()) bridgeLog.push(line);
  });
  await waitFor(
    () => bridgeLog.some((l) => l.startsWith('AI_BRIDGE_READY ')),
    15000,
    'bridge ready',
  );

  const client = new shared.BridgeClient({ lockDir: path.join(home, '.ai-bridge') });
  await client.connect();
  const attached = await client.request({ op: 'ctl.attach', ports: [CDP_PORT] }, 25000);
  console.log(
    `attached to ${attached.browser.name} ${attached.browser.version} · cap ${CAP_MB} MB · ` +
      `soaking ${MINUTES} min at ${POLL_MS} ms\n`,
  );

  const samples = [];
  const deadline = Date.now() + MINUTES * 60 * 1000;
  while (Date.now() < deadline) {
    const s = await client.request({ op: 'ctl.ram' });
    samples.push(s);
    const el = Math.round((Date.now() - (deadline - MINUTES * 60 * 1000)) / 1000);
    console.log(
      `  t+${String(el).padStart(4)}s  ${String(Math.round(s.browser.totalBytes / MB)).padStart(5)} MB  ` +
        `${String(s.percent).padStart(5)}%  ${s.level.padEnd(5)} ${s.browser.processCount} procs`,
    );
    await sleep(POLL_MS);
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const max = samples.reduce((a, b) => (b.browser.totalBytes > a.browser.totalBytes ? b : a));
  const min = samples.reduce((a, b) => (b.browser.totalBytes < a.browser.totalBytes ? b : a));
  const drift = first.browser.totalBytes > 0
    ? (last.browser.totalBytes - first.browser.totalBytes) / first.browser.totalBytes
    : 0;
  const underCap = max.browser.totalBytes < CAP_MB * MB;
  const source = first.browser.source;
  const exact = source === 'procfs-pss' || source === 'procfs-rss-adj';

  const checks = [
    ['every sample under the cap', underCap, `${Math.round(max.browser.totalBytes / MB)} MB max vs ${CAP_MB} MB`],
    ['no runaway drift (<10% start→end)', Math.abs(drift) < 0.1, `${(drift * 100).toFixed(1)}%`],
    ['never hit the block threshold', !samples.some((s) => s.level === 'block'), 'no block samples'],
  ];

  console.log('');
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  }

  const scrub = (t) => t.split(ROOT).join('<repo>').split(home).join('<tmp-home>').split(profile).join('<tmp-profile>');
  const report = [
    `# Batch 0.2 — ${MINUTES}-minute idle soak`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Host: ${process.platform} ${os.arch()} · ${Math.round(os.totalmem() / MB)} MB RAM · node ${process.version}`,
    `Fixture: ${CHROME} --headless=new --remote-debugging-port=${CDP_PORT}`,
    '',
    `Memory metric: **${source}**${exact ? ' (true footprint)' : ' (RSS upper bound on this kernel)'}`,
    '',
    '| check | result | detail |',
    '|---|---|---|',
    ...checks.map(([n, ok, d]) => `| ${n} | ${ok ? 'PASS' : 'FAIL'} | ${d} |`),
    '',
    `Samples: ${samples.length} · min ${Math.round(min.browser.totalBytes / MB)} MB · ` +
      `max ${Math.round(max.browser.totalBytes / MB)} MB · last ${Math.round(last.browser.totalBytes / MB)} MB`,
    '',
    '## Sample trace',
    '',
    '```',
    ...samples.map(
      (s, i) =>
        `t+${String(i * (POLL_MS / 1000)).padStart(4)}s  ${String(Math.round(s.browser.totalBytes / MB)).padStart(5)} MB  ${s.percent}%  ${s.level}`,
    ),
    '```',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'batch-0.2-soak.md'), scrub(report));

  client.close();
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill('SIGTERM');
  await exited;
  chrome.kill('SIGKILL');
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });

  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
