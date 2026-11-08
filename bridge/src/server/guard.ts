/**
 * Served-shell guard — SPEC v6 §13.
 *
 * The bridge already authenticates a *client*: the unix socket's own permissions,
 * or a token from the lock file. That does not protect a *page*, and §13's whole
 * point is that those are different problems. Any page the user visits can reach
 * 127.0.0.1:47615, and a malicious page — or DNS rebinding, which makes its own
 * hostname resolve to loopback — would otherwise be able to drive a process that
 * controls five logged-in AI accounts.
 *
 * So the rules here are about the request, not the caller:
 *
 *   - `Host` must be loopback. This is the anti-rebinding check: rebinding works
 *     by pointing an attacker's name at 127.0.0.1, and the browser then sends that
 *     name in `Host`.
 *   - `Origin`, when present, must be the shell's own origin. A cross-site POST
 *     carries the attacker's origin; a same-origin fetch carries ours.
 *   - The page is only served against a live, single-use nonce.
 *
 * Everything is pure and takes the request as a plain object, so the policy is
 * testable without a socket and cannot drift from what the server enforces.
 */

import * as crypto from 'node:crypto';

/** The only hosts a browser may use to reach us. */
export const ALLOWED_HOSTS = ['127.0.0.1', 'localhost'] as const;

/** How long a nonce is good for. Long enough to paste a URL, short enough to matter. */
export const NONCE_TTL_MS = 5 * 60 * 1000;

export interface RequestLike {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

export type Rejection =
  | { ok: false; status: number; reason: string }
  | { ok: true; reason?: undefined; status?: undefined };

const header = (req: RequestLike, name: string): string | undefined => {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

/** `127.0.0.1:47615` → `127.0.0.1`. IPv6 loopback is written `[::1]:port`. */
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    return close > 0 ? trimmed.slice(1, close) : null;
  }
  const colon = trimmed.lastIndexOf(':');
  return colon > 0 ? trimmed.slice(0, colon) : trimmed;
}

/**
 * Is the request addressed to us?
 *
 * A missing `Host` is refused rather than allowed: HTTP/1.1 requires it, so its
 * absence means something is hand-rolling a request, and the only clients that do
 * that here are our own and an attacker's.
 */
export function hostAllowed(hostHeader: string | undefined): boolean {
  const host = hostnameOf(hostHeader);
  if (!host) return false;
  return host === '::1' || (ALLOWED_HOSTS as readonly string[]).includes(host);
}

/** The exact origins the shell can be loaded from. */
export function shellOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/**
 * `Origin` is only meaningful when present. A top-level navigation sends none,
 * which is why a missing `Origin` is allowed for GET and refused for anything
 * that changes state — the standard CSRF shape.
 */
export function originAllowed(req: RequestLike, port: number): Rejection {
  const origin = header(req, 'origin');
  const method = (req.method ?? 'GET').toUpperCase();

  if (!origin) {
    return method === 'GET' || method === 'HEAD'
      ? { ok: true }
      : { ok: false, status: 403, reason: 'state-changing request without an Origin' };
  }
  return shellOrigins(port).includes(origin.toLowerCase())
    ? { ok: true }
    : { ok: false, status: 403, reason: `origin ${origin} is not the shell` };
}

/**
 * One nonce per shell launch, single use.
 *
 * Not the token: the token is the credential for the *protocol* and never appears
 * in a URL, where it would land in history and in any `Referer`. The nonce is a
 * one-time key to open the page, exchanged at `/auth` for the token.
 */
export class NonceStore {
  private nonce: string | null = null;
  private issuedAt = 0;

  constructor(
    private readonly ttlMs: number = NONCE_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  issue(): string {
    // 32 bytes of urandom, url-safe: long enough that guessing is not a thing.
    this.nonce = crypto.randomBytes(32).toString('base64url');
    this.issuedAt = this.now();
    return this.nonce;
  }

  /** Consume the nonce. Success once, and never again — including for the same caller. */
  consume(candidate: string | undefined | null): boolean {
    if (!this.nonce || !candidate) return false;
    if (this.now() - this.issuedAt > this.ttlMs) {
      this.nonce = null;
      return false;
    }
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.nonce);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    this.nonce = null;
    return true;
  }

  /**
   * Check a nonce without spending it. The page load verifies; the `/auth` POST
   * consumes. Consuming on GET would break a reload, and a reload is not an
   * attack.
   */
  verify(candidate: string | undefined | null): boolean {
    if (!this.nonce || !candidate) return false;
    if (this.now() - this.issuedAt > this.ttlMs) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.nonce);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** True while a nonce is outstanding and unexpired. */
  live(): boolean {
    return this.nonce !== null && this.now() - this.issuedAt <= this.ttlMs;
  }

  current(): string | null {
    return this.live() ? this.nonce : null;
  }
}

export type RouteDecision =
  | { action: 'serve-shell' }
  | { action: 'auth' }
  | { action: 'deny'; status: number; reason: string };

/**
 * What to do with a request, before anything is written to the socket.
 *
 * The order is deliberate: host, then origin, then path. A request with a bad
 * `Host` is refused without the path being looked at, so a rebinding attempt
 * learns nothing about which routes exist.
 */
export function route(req: RequestLike, port: number): RouteDecision {
  if (!hostAllowed(header(req, 'host'))) {
    return { action: 'deny', status: 421, reason: 'host is not loopback' };
  }

  const origin = originAllowed(req, port);
  if (!origin.ok) return { action: 'deny', status: origin.status, reason: origin.reason };

  const method = (req.method ?? 'GET').toUpperCase();
  const path = (req.url ?? '/').split('?')[0] ?? '/';

  if (method === 'POST' && path === '/auth') return { action: 'auth' };
  if ((method === 'GET' || method === 'HEAD') && (path === '/' || path === '/index.html')) {
    return { action: 'serve-shell' };
  }
  return { action: 'deny', status: 404, reason: `no route for ${method} ${path}` };
}

/**
 * CORS is off everywhere except `/auth`, and even there only for the shell's own
 * origin. A permissive `*` here would hand any page on the internet the response
 * to a loopback request.
 */
export function corsHeaders(req: RequestLike, port: number, forAuth: boolean): Record<string, string> {
  const origin = header(req, 'origin');
  if (!forAuth || !origin) return {};
  if (!shellOrigins(port).includes(origin.toLowerCase())) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}
