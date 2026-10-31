/**
 * CDP endpoint discovery.
 *
 * Probes the conventional debugging ports over HTTP `/json/version` and reports
 * what is actually listening. This module NEVER launches a browser — the spec's
 * browser policy is `connectOverCDP` only, and a launch here would break it.
 */

import * as http from 'node:http';
import type { BrowserCandidate } from '@ai-bridge/shared';
import type { Logger } from '../logger';

export const DEFAULT_PORTS = [9222, 9223] as const;

/** Map a CDP `Browser` string to the name a human recognises. */
export function browserNameFrom(version: string): string {
  const v = version.toLowerCase();
  if (v.includes('edg/') || v.includes('edge')) return 'Edge';
  if (v.includes('brave')) return 'Brave';
  if (v.includes('headlesschrome') || v.includes('chrome')) return 'Chrome';
  if (v.includes('chromium')) return 'Chromium';
  if (v.includes('opera') || v.includes('opr/')) return 'Opera';
  if (v.includes('vivaldi')) return 'Vivaldi';
  return 'Chromium';
}

interface VersionResponse {
  Browser?: string;
  'Protocol-Version'?: string;
  webSocketDebuggerUrl?: string;
}

/**
 * GET a JSON document over loopback. Deliberately `node:http` and not `fetch`:
 * the undici fetch path pulls a WASM HTTP parser, which fails outright on
 * constrained hosts. A 700 ms probe must not be the thing that breaks.
 */
function getJson(port: number, pathname: string, timeoutMs: number): Promise<unknown | null> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        timeout: timeoutMs,
        headers: { accept: 'application/json' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 1_000_000) req.destroy();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

export async function probePort(port: number, timeoutMs = 700): Promise<BrowserCandidate | null> {
  const body = (await getJson(port, '/json/version', timeoutMs)) as VersionResponse | null;
  if (!body || !body.webSocketDebuggerUrl) return null;
  const version = body.Browser ?? 'unknown';
  return {
    port,
    name: browserNameFrom(version),
    version,
    protocol: body['Protocol-Version'] ?? 'unknown',
  };
}

/** Probe every candidate port in parallel; keep the ones that answer. */
export async function discover(ports: readonly number[], log: Logger): Promise<BrowserCandidate[]> {
  const probed = await Promise.all(ports.map((p) => probePort(p)));
  const found = probed.filter((c): c is BrowserCandidate => c !== null);
  if (found.length === 0) {
    log.warn('no CDP endpoint answered', { ports: [...ports] });
  } else {
    log.info('CDP endpoints found', {
      candidates: found.map((c) => `${c.name}@${c.port}`),
    });
  }
  return found;
}

/** The error text a user can act on when nothing is listening. */
export function noEndpointMessage(ports: readonly number[]): string {
  return (
    `ENOCDP: nothing listening on ${ports.map((p) => `127.0.0.1:${p}`).join(', ')}. ` +
    'Start Chrome/Edge with --remote-debugging-port=9222 and stay logged in. ' +
    'Start one yourself, or set aiBridge.browser.mode to "launch" and run ' +
    'AI Bridge: Launch Browser.'
  );
}
