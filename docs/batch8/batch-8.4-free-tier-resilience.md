# Batch 8.4 — free-tier resilience

**Status: specified. Blocked on 8.0 (partly done — see "already landed").**

Acceptance: **a dead credential cannot cool the whole chain; a cancel is not a
failure; a stalled stream fails in seconds, not never.**

## Why

Free tiers fail in ways paid ones do not: a session expires silently, a 429
carries a precise `retry-after` we currently ignore, a TLS reset looks like a
chat error, and a stream that stalls holds a socket open forever. Each of these
already has a correct answer in upstream, and each is small.

## Already landed in 8.0

- `retry-after` parsing (seconds **and** HTTP date) → `RateLimitError.retryAfterMs`
- network-failure classification and a two-step retry (800 ms, 2 500 ms)
- per-read idle timeout on every stream read
- `EAUTH` raised before a request when a keyed endpoint has no key

## What still lands

1. **`retryAfterMs` → `router.markLimited`.** The router already accepts a
   provider-supplied reset time; the API path must feed it, so a 429 cools for
   exactly as long as asked instead of the default five minutes.
2. **`forgetRejected`.** When the server refuses a credential, delete it so the
   next request reports "signed out" instead of replaying the same dead
   credential through every provider in the chain and cooling all of them. This
   is thirty lines and it is the difference between one failed request and three.
3. **Abort is not failure.** `isAbortError` keeps a user cancel out of the
   router's failure count — the provider must not be penalised for our change of
   mind. Applies to both paths.
4. **Cancel stops the upstream.** The DOM path has a `stop` selector; an API
   endpoint gets an `AbortController` wired to the request, so cancelling stops
   generation rather than letting it burn quota into the void.
5. **Typed errors on the DOM path too.** `detectLimit` stays, but an adapter that
   lands on a sign-in page should report `EAUTH`, not "no answer".
6. **Debug report: timings and statuses.** Our breakage report is allow-list only
   — better for privacy than upstream's, worse for diagnosis. Add per-request id,
   timings, HTTP status and `retry-after`, keeping the guard that refuses to write
   if any chat text appears.

## Acceptance checks

```
router: a 429 with retry-after cools for exactly that long
router: a 429 without retry-after uses the configured cooldown
router: a cancel does not increment failures
router: a cancel does not cool the provider
auth: a refused credential is deleted
auth: a credential refreshed mid-flight survives the deletion
auth: the next request after a refusal reports signed out
network: one TLS reset is retried, not surfaced
network: three resets surface as one error, not three
idle: a stream that stops mid-answer fails on the idle timeout
cancel: an aborted request stops the upstream
report: the report carries timings and statuses
report: the report still contains no chat text
```

## Risks

- Deleting a credential on a false positive is user-visible pain. Upstream's guard
  — delete only if the stored secret still equals the one that was refused — is
  kept exactly.
- Feeding `retryAfterMs` into cooldowns changes failover timing, which existing
  router tests assert. Those tests get the API path added beside them, not
  rewritten.
