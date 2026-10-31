/**
 * Batch 8.4b — is this page asking the user to sign in?
 *
 * The DOM path had one failure mode for everything: a page whose composer does
 * not resolve reported "no answer". When the reason is an expired session, that
 * message sends the user looking for a broken selector instead of a login.
 *
 * The check is a heuristic on the URL only. A per-provider sign-in marker would
 * be more precise, but it would also be three more selectors to keep alive — and
 * the URL of a login page is the one thing every provider agrees on.
 */

/**
 * Hosts and paths that mean "you are not signed in".
 *
 * Deliberately narrow: `auth` alone would match `authoring`, and a false positive
 * here tells the user to sign in to a page they are already signed in to.
 */
const SIGN_IN_PATTERNS: readonly RegExp[] = [
  /(^|\.)accounts\.google\.com\//i,
  /\/log-?in(\/|\?|#|$)/i,
  /\/sign-?in(\/|\?|#|$)/i,
  /\/signin(\/|\?|#|$)/i,
  /\/auth\/[^/]*\/(login|signin|authorize)/i,
  /\/auth\/(login|signin|authorize)/i,
  /\/session\/new(\/|\?|#|$)/i,
  /\/(login|signin)\?/i,
  /\/sso(\/|\?|#|$)/i,
];

/** True when the URL looks like a sign-in or authorisation page. */
export function looksLikeSignIn(url: string): boolean {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return false;

  // An `/api/` path is an endpoint, not a page a user is looking at. A chat tab
  // never sits there, and matching it would mislabel a failed request as a
  // signed-out session.
  if (/\/api\//i.test(trimmed)) return false;

  return SIGN_IN_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * The message a sign-in page produces.
 *
 * Shaped like the other typed errors (`ECODE: explanation`) so the extension's
 * `codeOf` picks the code out of it and the breakage report records EAUTH rather
 * than EUNKNOWN.
 */
export function signInError(providerId: string, url: string): string {
  let host = 'unknown';
  try {
    // `about:blank` parses and has an empty host, so an empty result is as
    // uninformative as a throw.
    host = new URL(url).host || 'unknown';
  } catch {
    host = 'unknown';
  }
  return `EAUTH: ${providerId} is showing a sign-in page (${host}) — sign in to that tab and try again`;
}
