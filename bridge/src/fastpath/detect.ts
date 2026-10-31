/**
 * Batch 9.0 — is this answer a stream, or a challenge?
 *
 * The single riskiest thing in the batch. A detector that cries challenge adds a
 * wasted round trip to every request; one that misses a challenge reports a
 * broken provider to a user whose session is fine. So the markers are listed
 * explicitly, the verdict carries the marker that fired, and anything unknown
 * is an error rather than a guess.
 *
 * Every string here was taken from a public description of the challenge each
 * platform returns — not from a live session, which this environment has none of.
 */

export type Verdict = 'stream' | 'challenge' | 'auth' | 'error';

export interface ResponseShape {
  status: number;
  /** `content-type` as received; absent when the transport did not say. */
  contentType?: string;
  /** The first few KB of the body, when it is text. */
  body?: string;
}

export interface Detection {
  verdict: Verdict;
  /** Short, stable, safe to log — never the body itself. */
  reason: string;
  /** The marker that fired, when one did. */
  marker?: string;
}

/**
 * Bodies that mean "prove you are a browser", grouped by what they come from.
 *
 * Matched case-insensitively. These are fingerprints of a challenge page, not of
 * a challenge in general — a provider changing its wording shows up as `error`
 * (visible, reportable) rather than as a silent misclassification.
 */
const CHALLENGE_MARKERS: readonly { marker: string; source: string }[] = [
  { marker: 'x5sec', source: 'aliyun-waf' },
  { marker: 'rgv587', source: 'aliyun-waf' },
  { marker: 'fail_sys_user_validate', source: 'aliyun-waf' },
  { marker: 'cf-challenge', source: 'cloudflare' },
  { marker: 'challenge-platform', source: 'cloudflare' },
  { marker: 'just a moment', source: 'cloudflare' },
  { marker: 'attention required', source: 'cloudflare' },
  { marker: 'enable javascript and cookies', source: 'cloudflare' },
  { marker: 'captcha', source: 'generic' },
  { marker: 'arkose', source: 'arkose' },
  { marker: 'perimeterx', source: 'perimeterx' },
  { marker: 'datadome', source: 'datadome' },
];

/** Markers that mean the session is gone rather than challenged. */
const AUTH_MARKERS: readonly string[] = [
  'sign in to continue',
  'please log in',
  'please sign in',
  'session expired',
  'unauthorized',
];

function lower(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

function firstMarker(
  haystack: string,
  list: readonly { marker: string; source: string }[],
): { marker: string; source: string } | undefined {
  return list.find((entry) => haystack.includes(entry.marker));
}

/**
 * Classifies one response.
 *
 * `expected` is what a healthy answer looks like: `stream` for an SSE endpoint,
 * `json` for a buffered one. An HTML body where either was expected is the
 * classic challenge shape — the WAF answers the browser challenge page with 200.
 */
export function classifyResponse(
  shape: ResponseShape,
  expected: 'stream' | 'json' = 'stream',
): Detection {
  const body = lower(shape.body);
  const type = lower(shape.contentType);

  const challenge = firstMarker(body, CHALLENGE_MARKERS);
  if (challenge) {
    return {
      verdict: 'challenge',
      reason: `${challenge.source} challenge in body`,
      marker: challenge.marker,
    };
  }

  // An HTML page on an endpoint that answers in SSE or JSON is a challenge even
  // when nothing in the body matches a known marker — a login wall, a JS gate,
  // an interstitial all look like this.
  const htmlOnData = type.includes('text/html') && expected !== 'json';
  if (htmlOnData && shape.status >= 200 && shape.status < 300) {
    return { verdict: 'challenge', reason: 'HTML body on a stream endpoint' };
  }

  const authMarker = AUTH_MARKERS.find((marker) => body.includes(marker));
  if (shape.status === 401 || authMarker) {
    return {
      verdict: 'auth',
      reason: authMarker ? `auth marker "${authMarker}"` : 'HTTP 401',
      ...(authMarker ? { marker: authMarker } : {}),
    };
  }

  // 403 is deliberately NOT auth: every WAF in the list answers 403 for a
  // challenge it has already decided against, and calling that "signed out"
  // would send the user to a login page that changes nothing.
  if (shape.status === 429) {
    return { verdict: 'error', reason: 'rate limited (HTTP 429)' };
  }

  if (shape.status >= 400) {
    return { verdict: 'error', reason: `HTTP ${shape.status}` };
  }

  if (expected === 'stream' && !type.includes('event-stream') && type && !type.includes('json')) {
    return { verdict: 'error', reason: `unexpected content-type ${type}` };
  }

  return { verdict: 'stream', reason: 'looks like an answer' };
}

/** True when a detection means "try the next rung". */
export function shouldFallThrough(detection: Detection): boolean {
  return detection.verdict === 'challenge' || detection.verdict === 'auth';
}
