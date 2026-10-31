/**
 * Batch 10.0 — launching the browser, when the user asks for it.
 *
 * Until now the bridge attached to a browser the user had started and never
 * launched one. That is still the default, and still the honest one: an attached
 * browser is signed in, already trusted, and its RAM is visible to the user.
 *
 * But typing a debugging-port command every morning is a real cost, so launch
 * mode exists — opt-in, with its own profile directory by default, so it never
 * fights with the Chrome the user is already using and the RAM cap measures only
 * the AI tabs.
 *
 * The launcher deliberately does the *smallest* thing that works: spawn the
 * binary with the flags, then wait for the debugging port to answer. Everything
 * after that is the existing attach path, untouched.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface LaunchOptions {
  /** Explicit browser binary; auto-detected when empty. */
  executablePath?: string;
  /** Profile directory. Defaults to one under the AI Bridge home. */
  profileDir?: string;
  port?: number;
  headless?: boolean;
  /** How long to wait for the port to answer. */
  timeoutMs?: number;
  /** Extra flags, appended verbatim. */
  extraArgs?: string[];
}

export interface LaunchResult {
  ok: boolean;
  pid?: number;
  port: number;
  profileDir: string;
  executablePath: string;
  /** Set when `ok` is false: what went wrong, in words a user can act on. */
  error?: string;
}

/**
 * Where a browser usually lives, per platform. First existing wins.
 *
 * `env` is injectable so the candidate list can be tested from any platform —
 * the Windows roots live in environment variables that only exist on Windows.
 * An unknown platform returns nothing rather than a list of Linux paths, because
 * guessing wrong is worse than asking the user to set `browser.exePath`.
 */
export function candidateBrowsers(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'win32') {
    const roots = [
      env['PROGRAMFILES'],
      env['PROGRAMFILES(X86)'],
      env['LOCALAPPDATA'],
    ].filter((root): root is string => Boolean(root));
    const names = [
      'Google\\Chrome\\Application\\chrome.exe',
      'Microsoft\\Edge\\Application\\msedge.exe',
      'Chromium\\Application\\chrome.exe',
    ];
    return roots.flatMap((root) => names.map((name) => path.join(root, name)));
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  if (platform === 'linux') {
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    ];
  }
  return [];
}

/** The first candidate that exists, or undefined. */
export function detectBrowserPath(platform: string = process.platform): string | undefined {
  return candidateBrowsers(platform).find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

/**
 * The flags a debugging browser needs.
 *
 * `--user-data-dir` is not optional in practice: recent Chrome ignores
 * `--remote-debugging-port` when it would use the default profile, so a launcher
 * that omits it works on old versions and silently fails on new ones.
 */
export function buildLaunchArgs(options: LaunchOptions): string[] {
  const profileDir = options.profileDir ?? defaultProfileDir();
  const args = [
    `--remote-debugging-port=${options.port ?? 9222}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    // Keeps the window from stealing focus on every VS Code start.
    '--disable-background-mode',
  ];
  if (options.headless) args.push('--headless=new', '--disable-gpu');
  args.push(...(options.extraArgs ?? []));
  return args;
}

/** A profile of its own, so launch mode never touches the user's real one. */
export function defaultProfileDir(home: string = process.env.AI_BRIDGE_HOME || os.homedir()): string {
  return path.join(home, '.ai-bridge', 'browser-profile');
}

/** Does the debugging endpoint answer yet? */
async function portAnswers(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Starts a browser and waits until its debugging port answers.
 *
 * Detached on purpose: the bridge must not die with the browser, and the browser
 * must not die when the bridge restarts. `closeOnStop` is the extension's job.
 */
export async function launchBrowser(options: LaunchOptions = {}): Promise<LaunchResult> {
  const port = options.port ?? 9222;
  const profileDir = options.profileDir ?? defaultProfileDir();
  const executablePath = options.executablePath || detectBrowserPath() || '';

  if (!executablePath) {
    return {
      ok: false,
      port,
      profileDir,
      executablePath,
      error:
        'ENOBROWSER: could not find Chrome or Edge. Set aiBridge.browser.exePath, or use attach mode and start the browser yourself.',
    };
  }

  try {
    fs.mkdirSync(profileDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      port,
      profileDir,
      executablePath,
      error: `ECANNOTPROFILE: cannot create the profile folder ${profileDir}: ${(err as Error).message}`,
    };
  }

  const child = spawn(executablePath, buildLaunchArgs({ ...options, port, profileDir }), {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // A binary that does not exist fails *asynchronously*, through an 'error' event.
  // Without a listener that event is an uncaught exception, so a wrong path would
  // crash the bridge instead of being reported — which is exactly what the first
  // version of this did.
  const startError = await new Promise<Error | null>((resolve) => {
    child.once('error', (err) => resolve(err));
    child.once('spawn', () => resolve(null));
  });
  if (startError) {
    return {
      ok: false,
      port,
      profileDir,
      executablePath,
      error: `ESPAWN: could not start ${executablePath} — ${startError.message}`,
    };
  }

  const answered = await portAnswers(port, options.timeoutMs ?? 15_000);
  if (!answered) {
    return {
      ok: false,
      pid: child.pid,
      port,
      profileDir,
      executablePath,
      error: `ENOPORT: started ${path.basename(executablePath)} but nothing answered on port ${port} within ${
        (options.timeoutMs ?? 15_000) / 1000
      }s. Another browser may already be using that profile.`,
    };
  }

  return { ok: true, pid: child.pid, port, profileDir, executablePath };
}
