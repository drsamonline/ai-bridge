/**
 * Batch 8.0 — typed transport errors.
 *
 * Adapted from `src/providers/common/http.ts` and `src/providers/common/rejectedAuth.ts`
 * of AppsGanin/ai-free-vscode (MIT, commit 6f53bad). See docs/batch8/attribution.md.
 *
 * Why this exists at all: the router can only cool a provider for as long as it
 * knows about. A bare `Error('HTTP 429')` loses the `retry-after` the provider
 * took the trouble to send, and a dropped socket looks the same as a refusal —
 * so a free tier either gets hammered or gets blamed for a reset.
 */

/** Base class so a caller can catch every transport failure in one clause. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The endpoint refused the credential: sign in again, do not retry. */
export class AuthExpiredError extends ApiError {
  constructor(
    readonly providerId: string,
    readonly status = 0,
  ) {
    super('EAUTH', `${providerId}: sign-in expired${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'AuthExpiredError';
  }
}

/** The endpoint asked us to wait. `retryAfterMs` is what it said, if it said. */
export class RateLimitError extends ApiError {
  constructor(
    readonly providerId: string,
    readonly retryAfterMs?: number,
  ) {
    super(
      'ERATELIMIT',
      `${providerId}: rate limited${retryAfterMs ? `, retry in ${retryAfterMs} ms` : ''}`,
    );
    this.name = 'RateLimitError';
  }
}

/** A dropped connection rather than a rejected request — worth retrying. */
export class NetworkError extends ApiError {
  constructor(message: string) {
    super('ENETWORK', message);
    this.name = 'NetworkError';
  }
}

/** The configuration itself is wrong; no request can fix it. */
export class ConfigError extends ApiError {
  constructor(message: string) {
    super('ECONFIG', message);
    this.name = 'ConfigError';
  }
}

/** The stream went quiet for longer than the idle timeout. */
export class IdleTimeoutError extends ApiError {
  constructor(message: string) {
    super('EIDLE', message);
    this.name = 'IdleTimeoutError';
  }
}

export function errToString(err: unknown): string {
  if (err instanceof Error) {
    // Node's fetch collapses transport failures into "fetch failed" and keeps
    // the real code in `cause`; the router needs the code, not the wrapper.
    const cause = (err as { cause?: unknown }).cause;
    const tail = cause instanceof Error ? ` (${cause.message})` : '';
    return `${err.message}${tail}`;
  }
  return String(err);
}

/**
 * `retry-after` as milliseconds.
 *
 * The header is either a number of seconds or an HTTP date. Upstream handles the
 * first; a CDN in front of a free tier sends the second, so both are read here.
 */
export function retryAfterMs(
  header: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds * 1000 : undefined;
  }
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) {
    const delta = when - now;
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

/**
 * Maps a response onto a typed error: 401/403 → auth, 429 → rate limit with the
 * delay it asked for, anything else → a plain provider error carrying the status.
 */
export function throwForStatus(
  providerId: string,
  response: Response,
  authStatuses: readonly number[] = [401, 403],
): void {
  if (authStatuses.includes(response.status)) {
    throw new AuthExpiredError(providerId, response.status);
  }
  if (response.status === 429) {
    throw new RateLimitError(providerId, retryAfterMs(response.headers.get('retry-after')));
  }
  if (!response.ok) {
    throw new ApiError(
      'EPROVIDER',
      `${providerId}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
    );
  }
}

/** True when the failure is our own cancel rather than a real error. */
export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  return (
    !!signal?.aborted ||
    (err instanceof Error && err.name === 'AbortError') ||
    (err instanceof Error && /abort/i.test(err.message))
  );
}

const NETWORK_FAILURE_RE =
  /fetch failed|terminated|socket hang up|network error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|UND_ERR/i;

/**
 * A transport failure, not a rejection. A single TLS reset to a free endpoint is
 * common enough that it must never surface as a chat error.
 */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof Error && NETWORK_FAILURE_RE.test(errToString(err));
}
