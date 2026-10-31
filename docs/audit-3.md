# Audit 3 — whole codebase

**Date:** 2026-10-31 · **Version audited:** 0.33.0 (0.34.0 after the fixes below)
· **Scope:** `shared/src`, `bridge/src`, `extension/src`, `test/`, workflows.

## Method

Three passes, in this order:

1. **Structural** — line counts, file sizes, cast and empty-catch counts, a grep
   for hardcoded absolute paths, `console.*` in source, and lint configuration.
2. **Targeted reading** — the security path (`lock.ts`, `server.ts`, `client.ts`),
   the credential surfaces (log calls, the breakage report), and the code added in
   batches 8–9.
3. **Behavioural** — the 32 suites, plus a sweep of every suite that connects to
   the bridge, because a transport change touches all of them.

## What the numbers say

| Area | Lines | Files |
|---|---|---|
| `shared/src` | 1,080 | 7 |
| `bridge/src` | 7,176 | 38 |
| `extension/src` | 12,247 | 49 |
| `test/` | 12,390 | 33 |

The test tree is roughly the size of the bridge and a third of the extension.
`extension/src/extension.ts` alone is **2,521 lines** — 12% of the source.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | **High** | `ensureLockDir` and the socket `chmod` both swallowed failure. Since 9.5 removed the shared secret, a file mode is the *only* control on the socket and on the directory that points the client at it — so a silent failure left both reachable by other local users, with no second gate behind it. | **Fixed** — `assertOwnerOnly` verifies and throws; 3 checks |
| F2 | Medium | The handshake log said "token accepted" for a socket peer, which carries no token. A log that misdescribes the security event is worse than a vague one. | **Fixed** |
| F3 | Medium | The `nodeFetch` shim is duplicated in four test files — ~240 lines of identical code, and a fix to one would miss the others. | **Fixed** — one `test/helpers/fetch-shim.cjs`, ~240 lines removed |
| F4 | Medium | `extension.ts` at 2,521 lines holds ~40 command registrations, the settings host, the status bar, the panel snapshot and the batch 8–9 feature glue. Every batch has added to it. | Open |
| F5 | Medium | **No linter.** 59 empty `catch` blocks and 13 casts are all deliberate and commented, but nothing checks that they stay that way. | **Fixed** — `npm run lint`, wired into CI. It found 3 real defects on its first run |
| F6 | Low | `lock.json` is unauthenticated discovery data: whoever can write it can point the client at their own bridge. Mitigated by the directory being owner-only and now fail-closed (F1), so it is an accepted risk, not an oversight. | Accepted |
| F7 | Low | The TCP fallback (`AI_BRIDGE_TRANSPORT=tcp`) is dormant code kept for one release. | Accepted, time-boxed |
| F8 | Info | 21 `TODO`/`FIXME` hits are false positives — they are the state layer's TODO *feature* and a `FIXME` in a compression keyword list. No real markers exist. | No action |

## Credential surfaces

- **No log line prints a token.** The one that mentions it prints a 12-character
  fingerprint, and for a socket peer that field is now empty (F2 fixed).
- **No API key reaches a log.** `keyFor` is used only to build headers.
- **The breakage report cannot carry a credential**: its fields are an allow-list,
  and a chat fragment smuggled into a copied field is caught by
  `assertNoChatContent` (checked in `test:resilience`).
- **Nothing writes a token to disk any more.** That is 9.5's whole point, and
  `test:handshake` asserts it.

## Found while closing F3 and F5

The linter paid for itself on its first run:

- **`redactedLock` printed `unde…ined`.** It redacted `lock.token`, which 9.5
  removed — so the debug output looked like a leak of a value that does not exist.
  It now says "none — the socket is the authorisation".
- **A lazy `require('@ai-bridge/shared')`** in `extension.ts` for a symbol the
  file already imported.
- **A disable directive ten lines above the statement it meant to cover**, in
  `t1.ts`, so it had never suppressed anything.

## Not covered by this audit

Said plainly, because an audit that implies more than it checked is worse than
none:

- **No real provider** — every endpoint test is a loopback server whose stream
  shape we wrote ourselves.
- **No real editor** — the Copilot provider, the SCM button, the diff view and the
  report file write are wired and smoke-tested, never exercised in VS Code.
- **No Windows run** — the transport was changed to make Windows possible; the
  Windows job has not yet gone green.
- **The browser layer** is covered by fixtures and a real Chromium on Linux, but
  not against the live sites.
- **Performance** — nothing here measures throughput, memory over time, or the
  1-hour cap hold.
- **Compression quality** — T0 is measured; T1 and T2 have never seen a real model.
