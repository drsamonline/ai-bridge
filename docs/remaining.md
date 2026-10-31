# What is left

**913 checks across 33 suites, all green** — verified locally and re-run by CI on
every push. (Sum of each suite's own reported total; `compression-bench` writes a
report instead of counting.)

The batch-8 free-tier line is **complete**: eleven items landed across 0.21.0 →
0.28.0. Its records are in [`batch8/`](batch8/), one file per batch.

## Closed since the last list

| Item | Detail |
|---|---|
| **Live selectors** | Demoted from blocker to fallback: the fast path tries first and the DOM adapter is the floor (9.0, 9.0b). Still unproven against the real sites — see below. |
| **`ChatGPT (2 left)`** | Honest for API endpoints, which report `usage` in the stream (8.0). The DOM path keeps the cooldown. |
| **Tool results back to the model** | The loop closes (8.1b): an assistant turn carries its own tool calls, so a result answers a call id the provider issued. |
| **Typed errors on the DOM path** | A sign-in page reports `EAUTH` with the host, not "no answer" (8.4b). |
| **Images** | Sent as inline `data:` URLs when the endpoint declares `imageInput`; refused with `ENOIMAGE` naming the model when it does not (9.1). |
| **Windows transport** | A local socket replaces TCP loopback, and the token is no longer written to disk (9.5). |
| **Browser modes** | `attach` / `launch` / `off` in settings, with an optional headless launch and a profile of its own (10.0). |
| **Rung rows for web chats** | The Providers tab shows which rung is answering per provider and how often one stepped down (9.4). |
| **Endpoint status and a Test button** | The Providers tab shows signed-in / no key / error per endpoint, and one click sends a real prompt (9.2, 9.3). |
| **Settings UI for the new features** | Endpoints and per-feature models are editable in the Providers tab, and the panel pushes them to the bridge. |

## Open — needs your machine

1. **A provider template.** The fast path is inert for ChatGPT / Claude / Gemini
   until one exists. `AI Bridge: Capture Request as Template` now turns a copied
   cURL into one; [`batch8/capture-a-template.md`](batch8/capture-a-template.md)
   is the longer procedure. This is the single highest-value thing left.
2. **Live selectors** for the three web chats — fixtures only so far.
3. **Launch mode** — the browser launcher is tested for its arguments and its
   failure paths, never against a real browser. Nothing has started one yet.
4. **Editor surfaces** — Copilot rendering, the SCM commit button, the diff view,
   the report file write. Wired and smoke-tested; never seen in a real editor.
4. **The 10-minute soak** (`npm run soak`) and the 1-hour cap hold.
5. **Install the `.vsix`** — unsigned, not on the Marketplace.
6. **Windows — unblocked in 9.5, still unverified.** The transport is now a local
   socket and the session token is no longer written to disk, so the reason the
   client refused to start on Windows is gone (NTFS could not express 0600 on a
   file that held a credential). `test/handshake.cjs` still declares
   `@platform linux`, because it asserts POSIX modes — that is the harness, not
   the product. The Windows job runs every other browser-free suite.

## Open — buildable, deliberately not done

| Item | Why |
|---|---|
| **A release object for v0.24.0** | The tag exists; the Release workflow triggers on push to `main`, not on tag creation, so 0.24.0 has no assets. |
| **T1 / T2 quality** | Built, guarded and tested for safety, never run against a real model. T0's savings are measured: 17% overall, 0% on terse prompts, 37% on repo bundles. |
| **Windows CI** | More untested branches would add false confidence until someone runs them. |

## Audit 3 — open findings

Full report: [`audit-3.md`](audit-3.md). Two findings were fixed during it; four
are open and none is a security hole:

| # | Finding | Why it is still open |
|---|---|---|
| F4 | `extension.ts` is 2,521 lines and holds ~40 command registrations | a refactor with a wide blast radius; not worth it before the editor surfaces are verified |
| F7 | The TCP fallback is dormant code | kept for one release by decision, then deleted |

F3 (duplicated test shim) and F5 (no linter) were closed: one helper module, and
`npm run lint` in CI. The linter found three real defects on its first run.

## Known traps, so they are not rediscovered

- **`docs/` is the Pages site root.** A `../` asset resolves on disk and 404s on
  the site. The pages workflow now fails on any asset that escapes the root.
- **The bridge's suites rewrite their own `docs/batch-*.md` timestamps.** Restore
  them before committing, or the diff carries churn.
- **`ENOTEMPTY` on a Chrome profile cleanup** in `models`, `contract` and
  `custom-provider` is a flaky `/tmp` race in a container, not a regression. It
  passes on retry.
- **A hand-written CI suite list drifts.** The first Windows job listed
  `settings-panel` as browser-free; it spawns Chromium and died at 11 of 22.
  The list is now derived from each test file's own browser markers.
- **undici cannot allocate WASM** in some sandboxes, so the global `fetch` throws
  instead of rejecting. The 8.x harnesses probe for that and fall back to a
  `node:http` shim.
