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

## Result

**Status: landed, tested.** Harness: `npm run test:resilience` (15/15).

### What landed

| Item from the spec | State |
|---|---|
| `retryAfterMs` → router cooldown | **done.** A second `Router` instance, `apiRouter`, keyed `api:<providerId>` — sharing the DOM chain would have put `api:*` ids into `prompt()`, where `adapters.get()` throws. Priorities start at 101, so an endpoint never outranks a web chat. |
| A 429 without `retry-after` | **done.** Falls back to the 300 s configured cooldown rather than the 0 ms a missing header would imply. |
| Fail fast while cooling | **done.** A cooling endpoint throws `ERATELIMIT` before a request is made — the check asserts nothing new appears in the request record. |
| `forgetRejected` | **done.** A refused credential is deleted; the next call reports `EAUTH` with `status: 0`, meaning no request was made. |
| Abort is not failure | **done.** A cancel is recorded as `ECANCELLED` and marks neither failure nor success. |
| Cancel stops the upstream | **done.** `ctl.api.cancel` aborts the controller; the harness asserts the server saw the connection close and stopped sending. |
| Typed errors carry their status | **done** — and this one was found by the harness, not planned. `RateLimitError` had no `status`, so a 429 could not be reported as one. `ApiError` now carries `status`, and `EPROVIDER` carries the real code. |
| Debug report: timings and statuses | **partly.** The bridge now keeps the last 20 endpoint requests (`code`, `status`, `ms`, `retryAfterMs`) and exposes them on `ctl.api.status`. Writing them into the extension's breakage-report file is **8.4b**. |

### Deferred, with the reason

- **Typed errors on the DOM path.** An adapter that lands on a sign-in page still
  reports "no answer" rather than `EAUTH`. Doing it properly needs a per-provider
  sign-in marker, which is a selector-map change and belongs with 9.0 — the batch
  that reworks what the DOM path is for.
- **The breakage-report file.** The data is collected; only the extension side is
  missing, and it must keep the existing allow-list guard that refuses to write a
  report containing chat text.

### Files touched

```
bridge/src/api/errors.ts         status on the error types
bridge/src/runtime.ts            apiRouter, cancel, telemetry, classification
shared/src/control.ts            ctl.api.cancel, requestId, 2 event kinds
test/api-resilience.cjs          new (15 checks)
package.json                     +test:resilience, added to test:all
```

The DOM path, the adapters and `Settings` are untouched, again. `runtime.prompt()`
does not know the API router exists.

### Verification

`test:resilience` 15/15, `test:tools` 34/34, `test:api` 32/32, and the wider line
unchanged: handshake 12/12, router 35/35, custom-provider 12/12 (one flaky
`ENOTEMPTY` profile cleanup on the first run, clean on retry), settings-model
62/62, contract 31/31, extension-smoke 40/40, panel-virtual 29/29, release 26/26.

---

## 8.4b — the breakage report carries the endpoint records

**Status: landed, tested.** Checks live in `npm run test:resilience` (22/22).

### What landed

The bridge already kept the last 20 endpoint requests (`code`, `status`, `ms`,
`retryAfterMs`) and exposed them on `ctl.api.status`; nothing consumed them. Now
`buildReport` does:

- `BreakageInput.requests` → `BreakageReport.requests`, capped at 20, mapped
  field by field;
- `summarise` counts the failures, so the toast after exporting says
  `… 1/2 endpoint request(s) failed`;
- the diagnostics command fetches `ctl.api.status` and passes `recent` in.

### The guard is unchanged — and now proven against the new field

The privacy property of this report is structural: `buildReport` copies only
allow-listed keys, so an unknown key cannot reach the file even when a caller
passes it. The new checks assert exactly that — a request object carrying
`prompt` and `answer` produces neither — and then assert the stronger thing: a
chat fragment smuggled into `model`, a field that *is* copied, is caught by
`assertNoChatContent` and blocks the write.

That second check is the one that matters. An allow-list protects the fields
nobody thought about; it does not protect the fields that are copied, which is
why the guard exists on top of it.

### Not proven

- **The file has not been written by a real editor.** The report object is tested;
  the save dialog and the write are not.
- **The records are from synthetic and loopback requests.** What a real provider's
  failure looks like in the ring is unknown.
- **8.3c (a side-by-side diff before a fix lands) is still open.** It is pure
  editor glue with no way to verify it here, and the modal already shows the exact
  replacement and its line count — so it stays a nicety rather than a gap in the
  guarantee.

---

## 8.4b (continued) — typed errors on the DOM path

The spec deferred this to 9.0, and 9.0 did not take it, so it stayed open until
now. `bridge/src/adapters/signin.ts` adds `looksLikeSignIn` and `signInError`:

- a page whose URL is a login/sign-in/SSO/account-chooser page reports
  `EAUTH: <provider> is showing a sign-in page (<host>)` instead of "no answer",
  so the user is sent to a login rather than hunting for a selector;
- the message carries the **host only** — no path, no query, which can contain a
  conversation id;
- `/api/` paths are excluded: an endpoint is not a page a user is looking at, and
  matching it would mislabel a failed request as a signed-out session.

Checks: `npm run test:signin` (7/7). The heuristic is URL-only and deliberately
narrow — `authoring` contains "auth", and a false positive would tell a signed-in
user to sign in, which is worse than the vaguer message it replaced.
