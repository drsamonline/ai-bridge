#!/usr/bin/env node
/**
 * The standalone app — the debate engine in its own window, no editor.
 *
 * There is no second runtime here. The bridge already serves the panel over loopback
 * with a one-time nonce, so "standalone application" is: start the bridge, read the
 * URL it prints, and open that URL in a browser window that has no tabs, no address
 * bar and its own icon. Chrome calls this app mode.
 *
 * Why not Electron: it would add ~150 MB to ship a browser we already have. If the
 * app ever needs offline assets or a real installer, that changes — but not before.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const BRIDGE = path.join(ROOT, 'bridge', 'dist', 'bridge.js');

/** The URL the bridge prints once the shell is ready. */
export const SHELL_LINE = /served shell:\s*(http:\/\/127\.0\.0\.1:\d+\/\?nonce=[\w-]+)/;

/**
 * Chrome's app-mode arguments. A separate user-data-dir would be wrong here: this
 * window is a client of the bridge, not the browser the bridge drives, so it should
 * be the profile the user already has — no sign-in, no debugging port.
 */
export function appArgs(url, profileDir) {
  const args = [`--app=${url}`, '--window-size=1100,820'];
  if (profileDir) args.push(`--user-data-dir=${profileDir}`);
  return args;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/local/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

async function main() {
  if (!fs.existsSync(BRIDGE)) {
    console.error('bridge/dist/bridge.js is missing — run `npm run build && npm run build:bundle` first');
    process.exit(1);
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error('no Chrome or Chromium found — set CHROME_BIN to its path');
    process.exit(1);
  }

  const home = process.env.AI_BRIDGE_HOME ?? path.join(os.homedir(), '.ai-bridge');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });

  const bridge = spawn(process.execPath, [BRIDGE], {
    env: { ...process.env, AI_BRIDGE_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let opened = null;
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the bridge did not print a shell URL within 20s')), 20_000);
    const scan = (chunk) => {
      const match = SHELL_LINE.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    bridge.stdout.on('data', scan);
    bridge.stderr.on('data', scan);
    bridge.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the bridge exited (${code}) before serving the shell`));
    });
  });

  // Its own profile keeps the app window's state out of the user's everyday browser.
  const profile = path.join(home, 'app-profile');
  opened = spawn(chrome, appArgs(url, profile), { stdio: 'ignore' });
  console.log(`debate app open at ${url}`);
  console.log('close the window to stop the bridge');

  const stop = () => {
    if (!bridge.killed) bridge.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  opened.once('exit', () => {
    stop();
    process.exit(0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
