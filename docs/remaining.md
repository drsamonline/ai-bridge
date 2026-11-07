# What is left

**942 checks across 35 suites, all green** — verified locally and re-run by CI on
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
| **Local models** | `AI Bridge: Add Local Model` probes Ollama, LM Studio, llama.cpp and vLLM and registers one in a click (10.1). |
| **VSCodium / Open VSX** | The release workflow publishes to Open VSX — with `OVSX_PAT` on the first publish, then trusted publishing (OIDC, no stored secret) once the registration exists. The README covers the Copilot-less case. |
| **Browser modes** | `attach` / `launch` / `off` in settings, with an optional headless launch and a profile of its own (10.0). |
| **Rung rows for web chats** | The Providers tab shows which rung is answering per provider and how often one stepped down (9.4). |
| **Endpoint status and a Test button** | The Providers tab shows signed-in / no key / error per endpoint, and one click sends a real prompt (9.2, 9.3). |
| **Settings UI for the new features** | Endpoints and per-feature models are editable in the Providers tab, and the panel pushes them to the bridge. |

## Open — needs your machine

Ordered by what unblocks the most.

0. **If anything fails, run `AI Bridge: Diagnose` first.** It checks the extension
   version, the bridge entry, playwright-core, the browser, the mode, the lock file
   and the bridge phase, and prints what is missing with what to do about it.
1. **Install 0.48.0 and confirm the bridge starts.** Everything below depends on
   this, and it has never worked on a real machine. Until 0.45.0 the `.vsix` did
   not contain the bridge at all, so every install activated and died at the first
   command; 0.46.0 stopped the console windows; 0.47.0 added Chromium forks.
   `AI Bridge: Start Bridge` → the log must show `listening on …bridge.sock`.
2. **One answered prompt.** `Ctrl+Alt+A`, type "hello". This is the first time the
   product would have done its job outside a test harness.
3. **Launch mode, end to end** — the launcher is tested for its arguments and its
   failure paths, never against a real browser.
4. **A provider template.** The fast path is inert for ChatGPT / Claude / Gemini
   until one exists. `AI Bridge: Capture Request as Template` turns a copied cURL
   into one; [`batch8/capture-a-template.md`](batch8/capture-a-template.md) is the
   longer procedure.
5. **Open VSX trusted publisher** — the extension is published (0.44.0 was the
   first). What is left is registering the workflow at
   `open-vsx.org/user-settings/trusted-publishers` and then **deleting
   `OVSX_PAT`**; while the secret exists it takes precedence and the migration is
   not real.
6. **Live selectors** for the three web chats — fixtures only so far.
7. **Editor surfaces** — Copilot rendering, the SCM commit button, the diff view,
   the report file write. Wired and smoke-tested; never seen in a real editor.
8. **The 10-minute soak** (`npm run soak`) and the 1-hour cap hold.
9. **Windows** — unblocked in 9.5 (local socket, no token on disk), and the
   console-window fix landed in 0.46.0. The CI job runs every browser-free suite;
   `test/handshake.cjs` still declares `@platform linux` because it asserts POSIX
   modes, which is the harness, not the product. No green run yet.

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
