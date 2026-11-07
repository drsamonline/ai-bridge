/**
 * Batch 10.11 — the doctor.
 *
 * Every failure so far was a prerequisite that was missing rather than a bug in
 * the logic: the bridge file was not in the package, the browser was not found,
 * the namespace did not exist. Each took a round trip to diagnose because the
 * message said "it failed", not "this is what is absent".
 *
 * So this asks the questions in one place and prints the answers. It is pure: the
 * caller gathers the facts, this decides what they mean. That keeps it testable
 * without a VS Code host, which is the only reason it can be trusted at all.
 */

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  /** What was asked. */
  label: string;
  status: DoctorStatus;
  /** What was found, in the user's terms. */
  detail: string;
  /** What to do about it, when it is not ok. */
  fix?: string;
}

export interface DoctorFacts {
  extensionVersion: string;
  /** Resolved path to the bridge entry, or the error the resolver threw. */
  bridgeEntry: { ok: true; path: string } | { ok: false; error: string };
  /** Whether playwright-core resolves from the extension's own tree. */
  playwright: boolean;
  /** The runtime that will spawn the bridge. */
  nodeVersion: string;
  /** `browser.mode`. */
  browserMode: string;
  /** Whether a browser binary could be found, and which. */
  browser: { found: boolean; path?: string; exePath?: string };
  /** Bridge phase as the extension sees it. */
  bridgePhase: string;
  /** Whether the lock file was readable, and what it said. */
  lock: { readable: boolean; socket?: string; error?: string };
  /** Platform, for the caveats that only apply on one. */
  platform: string;
}

const ICON: Record<DoctorStatus, string> = { ok: '✅', warn: '⚠️', fail: '❌' };

/** The report, as markdown, so it can be pasted into a message. */
export function buildReport(facts: DoctorFacts): { ok: boolean; markdown: string; checks: DoctorCheck[] } {
  const checks: DoctorCheck[] = [];

  checks.push({
    label: 'Extension version',
    status: 'ok',
    detail: facts.extensionVersion,
  });

  // The one that cost the most: a package without the bridge installs, activates,
  // and dies at the first command.
  checks.push(
    facts.bridgeEntry.ok
      ? { label: 'Bridge entry', status: 'ok', detail: facts.bridgeEntry.path }
      : {
          label: 'Bridge entry',
          status: 'fail',
          detail: facts.bridgeEntry.error,
          fix: 'The installed .vsix is missing the bridge. Reinstall the latest release; if you built it yourself, run `npm run build:bundle` before packing.',
        },
  );

  checks.push(
    facts.playwright
      ? { label: 'playwright-core', status: 'ok', detail: 'found next to the extension' }
      : {
          label: 'playwright-core',
          status: 'fail',
          detail: 'not found — the bridge cannot drive a browser without it',
          fix: 'Reinstall the latest .vsix. A source build needs `npm ci` before packing.',
        },
  );

  checks.push({
    label: 'Node runtime',
    status: 'ok',
    detail: `${facts.nodeVersion} (the bridge runs on the editor\'s own Node)`,
  });

  const modeOk = ['attach', 'launch', 'off'].includes(facts.browserMode);
  checks.push({
    label: 'Browser mode',
    status: modeOk ? 'ok' : 'fail',
    detail: facts.browserMode,
    ...(modeOk
      ? {}
      : { fix: 'Set aiBridge.browser.mode to "attach", "launch" or "off".' }),
  });

  if (facts.browserMode === 'off') {
    checks.push({
      label: 'Browser',
      status: 'ok',
      detail: 'not needed — mode is "off", so only API endpoints are used',
    });
  } else if (facts.browser.found) {
    checks.push({ label: 'Browser', status: 'ok', detail: facts.browser.path ?? 'found' });
  } else {
    checks.push({
      label: 'Browser',
      status: facts.browserMode === 'launch' ? 'fail' : 'warn',
      detail: 'no Chrome, Edge, Brave, Vivaldi, Helium or Thorium found in the usual places',
      fix: 'Set aiBridge.browser.exePath to your browser binary, or start one yourself with --remote-debugging-port=9222 and use attach mode.',
    });
  }

  checks.push(
    facts.bridgePhase === 'ready'
      ? { label: 'Bridge', status: 'ok', detail: 'running and attached' }
      : {
          label: 'Bridge',
          status: 'warn',
          detail: `phase is "${facts.bridgePhase}" — start it with AI Bridge: Start Bridge`,
          fix: 'If it will not start, the Output panel (AI Bridge: Show Log) has the reason.',
        },
  );

  checks.push(
    facts.lock.readable
      ? {
          label: 'Lock file',
          status: 'ok',
          detail: facts.lock.socket ? `socket at ${facts.lock.socket}` : 'readable',
        }
      : {
          label: 'Lock file',
          status: facts.bridgePhase === 'ready' ? 'fail' : 'warn',
          detail: facts.lock.error ?? 'not readable',
          fix: 'The bridge writes it on start. If the bridge claims to be running but this fails, delete ~/.ai-bridge/lock.json and start it again.',
        },
  );

  if (facts.platform === 'win32') {
    checks.push({
      label: 'Windows note',
      status: 'ok',
      detail: 'the transport is a local named pipe, so no token is written to disk',
    });
  }

  const ok = checks.every((check) => check.status !== 'fail');
  const header = ok
    ? '# AI Bridge — everything checks out'
    : '# AI Bridge — something is missing';

  const body = checks
    .map((check) => {
      const line = `${ICON[check.status]} **${check.label}** — ${check.detail}`;
      return check.fix ? `${line}\n   ↳ ${check.fix}` : line;
    })
    .join('\n\n');

  const failing = checks.filter((check) => check.status === 'fail').length;
  const footer = ok
    ? '\n\nNothing here needs fixing. If a prompt still fails, the Output panel (AI Bridge: Show Log) has the reason.'
    : `\n\n${failing} item(s) need attention. Fix the ❌ ones first — the rest may resolve themselves.`;

  return { ok, markdown: `${header}\n\n${body}${footer}\n`, checks };
}
