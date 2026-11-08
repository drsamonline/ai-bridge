# Live gate — what has to run on a signed-in machine

Everything in batches 1–4 is proven against fakes and a local fixture page. Batch
5 is the part that cannot be: it needs a Chrome that is signed in to the three
chat UIs, and the sandbox this was built in can reach none of them.

This document is the checklist for closing it. Each step says what to run, what
success looks like, and what to send back if it does not.

---

## 0. Before anything

```bash
cd ai-bridge && git pull
npm install && npm run clean && npm run build && npm run build:bundle
node scripts/run-suites.mjs --timeout=200
```

Expect **42 of 43 suites green**. `repo-edit` is the one that fails on Windows and
nowhere else — four checks with `The "string" argument must be of type string.
Received type undefined`, a pre-existing path bug in the applier. Do not chase it
before step 2.

---

## 1. Attach, do not launch

```bash
# BOTH switches. Chrome 136+ ignores --remote-debugging-port when it would use the
# default profile — the browser opens, nothing listens, and the only symptom is a
# refused connection.
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-debug"
npm run bridge
```

**Why this changed, and what it costs.** From Chrome 136 the two debugging switches
are ignored on the default user data directory. The reason is cookie theft: after
App-Bound Encryption, starting the user's own Chrome with a port and asking it for
cookies over CDP became the cheap attack. A non-default directory uses a different
encryption key, so a debugger attached to it cannot see your everyday profile.

Two consequences that matter more than the flag:

- **A debugging profile starts signed out.** Copying your real profile into it does
  not restore the sessions — different key, by design. You sign in once inside
  `$HOME/chrome-debug` and every later launch on that directory is signed in again.
- **A second launch on a profile Chrome already owns is a no-op.** It hands the
  command line to the running process, which drops the flags. Quit every window on
  that directory first.

The route that still reaches your real, everyday profile is `chrome.debugger` from
an extension plus native messaging — no port, no second browser. That is the MV3
architecture Option A described, and this is the strongest argument for it.

The bridge binds a unix socket and prints `listening on …`. If it also prints a
served-shell URL with a nonce, `AI_BRIDGE_TRANSPORT=tcp` is set — leave it unset
unless you are testing the shell page.

**Success:** `ctl.status` reports `attached` with your browser's name and version.

---

## 2. Live selector validation — gate 5.1

This is the one that has never been done. The adapters have only ever run against
`test/fixtures/*.html`.

For each of ChatGPT, Claude and Gemini, in the attached browser:

1. Open the site, sign in, start a **new chat**.
2. `ctl.health` for that adapter — expect `ready: true` and every selector
   resolved `via: primary`.
3. `ctl.prompt` with a short question — expect a settled answer, and `settledBy`
   of `sentinel` or `stop-gone`, **never** `debounce`.
4. Ask a second question in the same thread — the composer must accept it.

**What failure looks like, and what each means:**

| Symptom | Meaning | Fix |
|---|---|---|
| `health.ready: false`, selectors `via: none` | the composer moved | update `adapters/<provider>.ts` selectors |
| resolves `via: fallback` | the primary is stale | same, and re-check the fallback still matches something real |
| `settledBy: debounce` | the copy button and stop button both moved | the adapter's sentinel selectors are wrong; do not trust the answer |
| `ELIMIT` on the first prompt | you are rate-limited on that account | wait, or use a different account |

Record the result per provider in `docs/debate/LIVE-RESULTS.md` — one line each:
adapter, ready, resolved via, settledBy, and the selector that had to change.

---

## 3. Fastpath template — gate 5.2

Until a template exists, every turn is typed into the composer and the timing
model is guesswork.

1. In the attached browser, open the provider, open DevTools → Network.
2. Send one message. Find the request whose response streams the answer.
3. Right-click → Copy → **Copy as cURL**.
4. `AI Bridge: Capture Request as Template` (or `docs/batch8/capture-a-template.md`).
5. `ctl.fastpath.status` — the template must show `enabled: true`.

**Success:** `ctl.prompt` answers with `settledBy: sentinel` and no typing in the
page. The timing drops from ~300 s per turn to seconds.

Do this for one provider only. One template proves the path; three is polish.

---

## 4. First real session — gate 5.5

Only after 2 and 3.

```bash
# a five-participant roster, planner and auditor required
node -e "…"    # ctl.session.create — see step 5
```

Until `ctl.session.*` exists (it is the deferred half of batch 3), drive the
runner directly:

```bash
node --input-type=module -e "
import { SessionRunner } from './bridge/dist/runtime/runner.js';
import { createLiveDispatch } from './bridge/dist/runtime/liveDispatch.js';
// … one lease per participant, then run()
"
```

**Success looks like:** five tabs leased, turns cycling in roster order, a
`plans/plan-v1.md` after the first planner turn, and — at the end — a
`bundle/` with five files and a manifest whose `artifacts` all carry a 64-character
hash.

**Send back:** the manifest, and `objections-resolved.md`. Those two say more about
whether the debate was worth its cost than the transcript does.

---

## 5. What is still code-shaped, not browser-shaped

These do not need a signed-in machine and can be done before step 4:

- `ctl.session.*` — create, state, resume, bundle, handoff. Needs a
  `PROTOCOL_VERSION` bump in `shared/src/types.ts`, which is marked frozen, so it
  wants its own commit and a note in the file.
- `AWAITING_LOGIN` — the transition and `signin.ts` both exist; promotion to a
  visible tab is a `CdpController` operation and needs the controller, not a page.
- `liveDispatch.ts` — written and typechecked, never executed against a page. Its
  first real run is step 4.

---

## The honest summary

Forty-three suites prove the engine. None of them proves the product, because the
product is five consumer chat UIs that change their DOM without telling anyone.
Steps 2 and 3 are the difference between a debate engine and a debate engine that
works, and no amount of testing in a sandbox closes them.
