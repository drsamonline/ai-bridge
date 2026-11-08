# Handover — what is left, and whose side it is on

Two workstreams, two release lines, one repository. This splits the remaining work
by what it needs, not by what it is: anything that needs a signed-in browser is
yours, anything that needs only this checkout is mine.

Every item names a file or a command, so a claim here can be checked rather than
believed.

---

## Your side

These need a machine that is signed in to the three chat UIs. Nothing in a sandbox
closes them, and no amount of testing substitutes.

| # | What | Where it is written down | Done when |
|---|---|---|---|
| 1 | Live selector validation — ChatGPT, Claude, Gemini | `LIVE-GATE.md` step 2 | `ctl.health` reports `ready: true`, every selector `via: primary`, and `ctl.prompt` settles `sentinel` or `stop-gone` — never `debounce` |
| 2 | One fastpath provider template | `LIVE-GATE.md` step 3 | `ctl.fastpath.status` shows `enabled: true` and a prompt answers with no typing |
| 3 | First real session, five participants | `LIVE-GATE.md` step 4 | `bundle/manifest.json` exists, its four `artifacts` all carry 64-character hashes, and `objections-resolved.md` says something useful |
| 4 | Run `liveDispatch.ts` once | `bridge/src/runtime/liveDispatch.ts` | It has executed against a page. It typechecks; it has never run. Expect the first surprises here, not in the suite |
| 5 | Tag the first engine release | `.github/workflows/debate-release.yml` | `git tag debate-v0.1.0 && git push origin debate-v0.1.0` produces a tarball. The workflow has never fired |
| 6 | Install and Diagnose 0.48.0 | the other session's steps | The panel says 0.48.0, `AI Bridge: Diagnose` runs, and "hello" answers |

### Decisions only you can make

- **Shared provider accounts.** Two participants may name the same provider and
  therefore share a quota. `validateRoster` reports it (`sharedAccounts`) rather
  than blocking it. Should the roster forbid it? `docs/debate/DECISIONS.md` —
  "Still undecided".
- **The stall threshold.** `STALL_THRESHOLD = 0.95`, two consecutive turns by the
  same participant. A debater legitimately repeating "no objection to this
  revision" will trip it. One constant in `runtime/questions.ts`; real model output
  is the only way to know if it is too eager.
- **The Anthropic endpoint.** The other session's finding — adding `/v1/messages`
  alongside the OpenAI shape — is workstream A and a real reach win. It is a
  decision, not a task: it changes what ai-bridge is.

---

## My side

All of this is code-shaped: no browser, no account, and a test can prove each one.

| # | What | Files | Why it matters |
|---|---|---|---|
| 1 | ~~**Windows CI is red**~~ — **fixed.** It was `test/repo-edit.cjs`'s `readAll`, which keyed its file map with an unnormalised `path.relative` | `test/repo-edit.cjs` | The applier was never at fault: on Windows the map keys were `src\\format.ts` while the checks indexed `src/format.ts`, so every lookup was undefined |
| 2 | **Delta transport (§7)** | `runtime/payload.ts`, `runtime/runner.ts` | Every turn re-sends the full plan and context. Per participant thread that is ~70 k tokens by round 7, and unbounded once the user forces rounds. `bootTransport.ts` already has `composeBoot`/`deltaLineCount` |
| 3 | **Context block drops whole messages** | `runtime/runner.ts` `contextBlock` | One long turn can crowd out several short ones. The budget is respected; the sharing is not fair |
| 4 | **`AWAITING_LOGIN` promotion** | `runtime/runner.ts`, `cdp/controller.ts` | The transition and `signin.ts` both exist; promotion to a visible tab is a controller op and needs no page |
| 5 | **The debate UI does not exist** | `bridge/src/server.ts` | The shell page is a placeholder that exchanges the nonce and says so. The side panel is the actual product surface |
| 6 | **No end-to-end shell test** | `test/server-guard.cjs` | The guard is tested pure. Nothing proves nonce → `/auth` → token over a real socket, and that is a five-minute test |
| 7 | **Landing page says "step 1 of 7"** | `docs/debate/make-badges.mjs` | Fixed in this pass — badges now read 11 modules / 44 suites / live: not yet run. Worth re-running after each batch |

Order I would take them: **1**, because a red CI is the thing that lets the others
rot; then **6** and **7** as quick wins; then **2** and **3** together, since both
are about what a participant receives; then **4**; then **5**, which is the only
large one left and wants the live gate open first.

---

## What is not on either list, on purpose

- **Extracting to a second repository.** Everything is in four directories, so it
  is a `git mv` whenever you want it. It buys isolation the two release lines
  already give you, and costs a `shared` package to publish. Not worth it yet.
- **Publishing to npm.** The engine manifest is `private: true` and the extension
  ships as a `.vsix`. Neither needs a registry.
- **More spec.** Six drafts produced a specification the code now disagrees with in
  exactly one place — `AWAITING_LOGIN` — and that is written down in `DECISIONS.md`.
  A seventh draft would add words, not agreement.

---

## The state, in numbers

- **44 suites**, all green after `npm run clean && npm run build` (Windows: 43, the
  `repo-edit` failure above).
- **11 runtime modules** plus three repo modules and a server guard.
- **Two release lines**: `v0.48.0` for the extension, `debate-v0.1.0` for the engine.
- **Zero sessions played against a live chat UI.** That is the number that matters.
