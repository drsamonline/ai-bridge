#!/usr/bin/env node
/**
 * Live dispatch integration harness — the last module no fake has touched.
 *
 * Everything else in the engine is proven against a fake dispatch. This proves the
 * dispatch itself: a real Chromium, a real DOM, real CDP, the actual §7 payload
 * typed into a composer, and a settled answer read back out. The page is
 * `test/fixtures/chatgpt.html`, the same fixture `chatgpt-fixture.cjs` uses, so the
 * only thing being tested is the glue — provider resolution, payload assembly, the
 * send, the settle, and the token that comes out the other end.
 *
 * It is still not a live chat UI. That is `LIVE-GATE.md`, and it needs a signed-in
 * browser. What this closes is the gap between "typechecked" and "executed".
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_BIN || '/usr/local/bin/chromium';
// 9233, not 9222: cdp-attach and chatgpt-fixture both drive 9222, and a browser that
// has not finished releasing the port makes the *next* suite fail with "bridge
// launched no browser of its own" — a message that sends you looking at the wrong test.
const CDP_PORT = 9233;
const FIXTURE_PORT = 47806;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function serveFixture() {
  const dir = path.join(ROOT, 'test', 'fixtures');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = path.join(dir, path.basename(url.pathname) || 'chatgpt.html');
    fs.readFile(file, (err, body) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    });
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(server)));
}

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

/** A DispatchRequest for one participant, as the runner would build it. */
function request(over = {}) {
  return {
    sessionId: 'dispatch-live',
    participant: { index: 0, role: 'planner', label: 'planner', providers: ['chatgpt'], tier: 'visible' },
    round: 1,
    retry: false,
    planText: '# Plan v1\n- add a down migration',
    contextText: '[round 1 | participant 1] no rollback path',
    questionsText: '- which database?',
    objectionsText: 'obj-1-1: no down migration',
    snapshotText: '### src/ports.ts\nexport interface FsPort {}',
    ...over,
  };
}

(async () => {
  console.log('');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-dispatch-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bridge-dispatch-prof-'));
  const fixture = await serveFixture();
  const baseUrl = `http://127.0.0.1:${FIXTURE_PORT}/chatgpt.html`;

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

  const logged = [];
  const log = {
    info: (m) => logged.push(String(m)),
    warn: (m) => logged.push(`WARN ${m}`),
    error: (m) => logged.push(`ERROR ${m}`),
    debug: () => {},
    child() {
      return this;
    },
  };

  let runtime = null;
  try {
    await waitFor(async () => (await cdpVersion(CDP_PORT)) !== null, 20000, 'chromium CDP endpoint');

    const { BridgeRuntime } = require('../bridge/dist/runtime/index.js');
    runtime = new BridgeRuntime({ log, sessionsRoot: home });

    const attached = await runtime.control({ op: 'ctl.attach', ports: [CDP_PORT] });
    check('dispatch: the runtime attaches to a real browser', () => {
      assert.ok(attached, 'ctl.attach returned nothing');
      assert.ok(logged.some((l) => l.includes('handshake') || l.includes('attached')), 'no attach in the log');
    });

    await runtime.navigate({ adapterId: 'chatgpt', url: baseUrl });
    check('dispatch: the fixture page is open and is not a sign-in page', () => {
      const url = runtime.controller.activePage.url();
      assert.equal(url, baseUrl);
    });

    const dispatch = runtime.createDispatch();

    let answer = null;
    let threw = null;
    try {
      answer = await dispatch(request());
    } catch (err) {
      threw = err;
    }

    check('dispatch: a real turn settles instead of timing out', () => {
      assert.equal(threw, null, `dispatch threw: ${threw && threw.message}`);
      assert.ok(answer, 'no answer');
      assert.ok(answer.text.length > 0, 'the answer was empty');
    });

    check('dispatch: the settle came from the page, not the debounce fallback', () => {
      // `debounce` means neither sentinel fired — the answer is untrusted, and a
      // dispatch that returns it anyway would hide a broken adapter.
      assert.ok(['sentinel', 'stop-gone'].includes(answer.settledBy), `settledBy=${answer.settledBy}`);
    });

    // What actually reached the composer, read back out of the DOM. The fixture
    // renders the user message, so this is evidence rather than an inference from
    // a log line.
    const sentToPage = await runtime.controller.activePage.evaluate(() => document.body.innerText);

    check('dispatch: the whole §7 payload reached the composer, not just a question', () => {
      assert.ok(sentToPage.includes('```plan'), 'the plan block never arrived');
      assert.ok(sentToPage.includes('add a down migration'), 'the plan body never arrived');
      assert.ok(sentToPage.includes('obj-1-1'), 'the objections block never arrived');
      assert.ok(sentToPage.includes('REMINDER'), 'the protocol suffix never arrived');
      assert.ok(sentToPage.includes('Your job: revise the plan'), 'the role line never arrived');
    });

    let providerErr = null;
    try {
      await dispatch(
        request({ participant: { index: 0, role: 'planner', label: 'p', providers: [], tier: 'visible' } }),
      );
    } catch (err) {
      providerErr = err;
    }
    check('dispatch: a participant with no providers is refused with EPROVIDER', () => {
      assert.ok(providerErr, 'expected a throw');
      assert.match(providerErr.message, /^EPROVIDER/);
    });

    let tabErr = null;
    try {
      await runtime.createDispatch({ pageFor: () => null })(request());
    } catch (err) {
      tabErr = err;
    }
    check('dispatch: a participant with no page is refused with ENOTAB', () => {
      assert.ok(tabErr, 'expected a throw');
      assert.match(tabErr.message, /^ENOTAB/);
    });
  } catch (err) {
    failures += 1;
    console.log(`FAIL  harness\n      ${err.message}`);
    results.push(`FAIL  harness\n      ${err.message}`);
  } finally {
    if (runtime) await runtime.stop().catch(() => {});
    chrome.kill('SIGKILL');
    const exited = new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once('exit', r)));
    await Promise.race([exited, sleep(5000)]);
    // Wait for the port itself, not just the process: exit and release are not the
    // same moment, and the gap is where the next suite falls over.
    await waitFor(async () => (await cdpVersion(CDP_PORT)) === null, 10000, 'CDP port to be released').catch(
      () => console.log('warning: port 9233 was still answering after teardown'),
    );
    fixture.close();
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  console.log('');
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (failures > 0) console.log(`${failures} FAILED`);
  process.exit(failures > 0 ? 1 : 0);
})();
