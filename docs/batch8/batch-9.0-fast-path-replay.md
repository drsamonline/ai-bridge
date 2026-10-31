# Batch 9.0 — fast path, DOM as fallback

**Status: specified. Last. Changes what the DOM path is for.**

Acceptance: **when the fast path is challenged, the same request is replayed in
the tab we already own and the user sees one answer — no error, no second prompt.**

## Why

`docs/remaining.md` item 1 is our number-one open risk: no adapter has ever run
against the real ChatGPT, Claude or Gemini, only fixtures. The instinct is to
test the selectors more. Upstream shows a better answer: **make selectors the
fallback, not the only path.**

Qwen's flow, in their words: call the API directly from Node with the web app's
own headers; when the response is a challenge instead of a stream — an HTML
challenge page, or an `x5sec` / `RGV587` JSON body — replay the *same request*
inside the real browser session, which carries the cookies and fingerprint the
WAF trusts, and keep streaming the result back.

We are better placed than they are for the replay half: we already hold a live
CDP session on a tab the user opened and signed into. No profile directory, no
launcher, no stealth script.

## Shape

```
prompt ──► fast path (fetch with the tab's cookies + headers)
              │
              ├── stream ──────────────────────────► answer
              │
              └── challenge / HTML / 403 ──► replay in owned tab (page.evaluate fetch)
                                                 │
                                                 └── stream ──► answer
                                                        │
                                                        └── still challenged ──► DOM adapter (existing path)
```

Three rungs, each falling through to the next, and the DOM adapter stays exactly
as it is today as the floor. Nothing is removed.

## What lands

- `bridge/src/fastpath/` — per-provider request templates (endpoint, headers,
  body shape), challenge detection, replay-through-tab, and a per-provider
  enable flag.
- Cookies and fingerprint come from the session we already have:
  `Network.getCookies` over the existing `CDPSession`, plus the tab's own
  `User-Agent`.
- Router learns a fourth state per provider: `fast | replay | dom`, and prefers
  the cheapest rung that last worked.

## Acceptance checks

```
detect: an HTML body on a stream endpoint is a challenge
detect: an x5sec body is a challenge
detect: an RGV587 / FAIL_SYS_USER_VALIDATE body is a challenge
detect: a normal SSE stream is not a challenge
replay: a challenged request is replayed in the owned tab
replay: the replayed request carries the tab's cookies
replay: the answer is streamed from the replay, not buffered
replay: a replay that is also challenged falls through to the DOM adapter
replay: the user sees one answer and one prompt
router: the rung that last worked is preferred next time
router: a provider with the fast path disabled behaves exactly as today
safety: with no tab attached, the fast path is never attempted
```

## Why this is last

It is the only batch that can make things *worse* — a wrong challenge detector
adds a round trip to every request. It needs 8.1's stream handling and 8.4's
error taxonomy underneath it to be worth building at all. Until then, the honest
position stays what `remaining.md` says: fixtures only, and we say so.

## What it does not fix

ChatGPT and Claude sign their requests with device fingerprinting and PoW/Arkose
respectively. The fast path will work on some endpoints and not others, and a
provider that is always challenged is simply always on the DOM rung. This batch
removes the *single point of failure*; it does not remove the selectors.

## Result

**Status: machinery landed and tested; no provider template shipped.**
Harness: `npm run test:fastpath` (25/25).

### What landed

| Piece | Detail |
|---|---|
| `bridge/src/fastpath/types.ts` | `FastPathTemplate`, `renderTemplate`, `validateTemplate` |
| `bridge/src/fastpath/detect.ts` | `classifyResponse` → `stream` / `challenge` / `auth` / `error`, with the marker that fired |
| `bridge/src/fastpath/replay.ts` | `replayInPage`: the same request, run inside the owned tab, streamed back |
| `bridge/src/fastpath/policy.ts` | `RungPolicy`: which rung last worked, cheapest-first otherwise |
| `shared/src/control.ts` | `ctl.fastpath.set`, `ctl.fastpath.status` |

### The honest part: no templates

ChatGPT, Claude and Gemini all sign their requests with device fingerprints or
proof-of-work. None of them documents the shape, and this environment has no
account to capture one from. **Guessing a template would be fiction**, so none
ships: a template is configuration the user adds after capturing a request from
their own tab, and it is `enabled: false` until they do.

That is also why `runtime.prompt()` is untouched. The machinery is reachable
through `ctl.fastpath.*`; wiring the rungs into the prompt loop is **9.0b**, and
it needs a real provider to point at before it is worth doing.

### What is better here than upstream

They had to launch a browser with a persistent profile to get a trusted session,
plus a stealth script to hide that it was headless. We attach to a tab the user
already signed into, so the replay is a `fetch` inside that page: the cookies and
the fingerprint are already there. `replayInPage` sends nothing of its own — no
`Network.getCookies`, no header mirroring — because the page supplies both.

### Decisions worth recording

- **A bare 403 is an error, not "signed out".** Every WAF in the list answers 403
  for a challenge it has already decided against; calling that auth would send the
  user to a login page that changes nothing.
- **Unknown is an error, not a guess.** A challenge page that changes its wording
  shows up as `error` — visible and reportable — rather than being silently
  classified as a stream.
- **A template without `{{prompt}}` is rejected**, not accepted-and-broken: it
  would send a request with no question in it, and get a plausible answer about
  nothing.
- **Two evaluates, not one.** Awaiting the fetch inside a single `evaluate` would
  block the read loop until the answer completed, which defeats streaming.

### Not proven

- **No provider has been replayed.** The harness runs the page-side functions
  against installed globals and a fake transport, which proves the handshake, the
  streaming and the timeouts — not that a real ChatGPT tab accepts the request.
- **The detector is written from public descriptions** of each challenge, not from
  a live session. Expect to add markers.
- **The rungs are not wired into `prompt()`** (9.0b).

### Verification

`test:fastpath` 25/25; handshake 12/12, router 35/35, extension-smoke 40/40,
release 26/26, api-tools 34/34, lm-provider 19/19, features-routing 27/27,
contract 31/31 (one flaky `ENOTEMPTY` profile cleanup, clean on retry).

---

## 9.0b — the rungs inside `prompt()`

**Status: landed, tested.** Harness: `npm run test:rungs` (11/11).

### What landed

`bridge/src/fastpath/attempt.ts` and a cascade in `BridgeRuntime.prompt()`:

```
prompt ──► template enabled? ──► fast ──► replay ──► dom (unchanged)
                                  │         │
                              challenge ─────┘
```

- **A provider with no enabled template never reaches the cascade**, so the DOM
  path is byte-for-byte what it was. That is every provider by default, and the
  DOM-path suites (chatgpt-fixture 21/21, models 20/20, contract 31/31,
  router 35/35, rotation 26/26) confirm it.
- **A challenge is not an error.** It records a fall-through and moves down a
  rung; the user sees one answer and one prompt.
- **A rung that fell through is not re-tried** when the router retries the prompt.
  The harness caught this: without it a challenged endpoint was hit three times
  per prompt, once per retry, for an answer that could not have changed.
- **The template is tried before the adapter lookup**, so a template can name a
  provider this build has no adapter for — the template is the definition then.

### A bug the harness found, and what it looked like

`extractTextFromEvent` read the OpenAI shape (`choices[0].delta.content`) and
missed a top-level `{"delta":{"text":…}}`. Every chunk of such a stream was
dropped, the fast rung produced nothing, and the failure surfaced as
`EFAST: the fast path returned nothing` — which reads like a broken endpoint
rather than a one-line extraction gap. Both shapes are read now, and plain-text
`data:` payloads pass through unchanged.

### Not proven

- **The replay rung has never run in this harness.** With no tab attached the
  cascade is `fast → dom`; `replayInPage` is covered by 9.0's own checks against
  installed globals, but the two together are not.
- **No real provider has answered on the fast rung.** Every check runs against a
  loopback server that speaks a shape we wrote ourselves.
- **The extraction rule is best-effort by design.** A template pointing at a
  stream we did not anticipate still produces text, but it may produce the wrong
  text; the template author is the one who can see that.

---

## 9.2 — capturing a template, and seeing what an endpoint is doing

**Status: landed, tested.** `npm run test:curl` (14/14).

The fast path had no way in: a template had to be assembled by hand from a
DevTools request, which is why the machinery stayed dormant. Two additions:

**Capture** — `AI Bridge: Capture Request as Template`. Copy the request as cURL,
run the command, pick the provider, and it is parsed, validated and saved
disabled. Two deliberate refusals inside `features/curl.ts`:

- **credentials never survive the parse** — `authorization`, `cookie`,
  `content-length`, `host`, `accept-encoding` and `connection` are dropped, so a
  copied token cannot become a secret in a settings file. The replay uses the
  tab's own session, which is the whole point of the rung;
- **no silent guess about the prompt** — the longest string in the body becomes
  `{{prompt}}`, and the confirmation shows exactly which path was replaced and
  what it held. A wrong guess here would send the wrong text forever.

A template is saved **disabled**: it should be enabled after it is seen answering,
not before.

**Endpoint status** — the Providers tab now lists each endpoint with a dot
(signed in / no key / error), its model count and its last error. A rejected key
used to be visible only in the Output channel.

**Windows CI** — a `windows-latest` job builds, bundles, and runs every
browser-free suite. The CDP suites stay on Linux, where they are known to work;
adding them to Windows would produce a red run that says nothing about the code.

Not proven: no captured template has been run against a real provider, and the
Windows job has not completed a first run.

---

## 9.3 — "Test" an endpoint from the panel

**Status: landed, tested.** `settings-panel` 19/19.

Each endpoint row in the Providers tab now carries a **Test** button: it sends one
eight-token prompt (`Reply with the single word: ok`) through that endpoint and
reports the round trip — `answered in 412 ms — "ok"`, or the error verbatim. It
then re-pushes the endpoint list so the dot and the error text reflect what just
happened.

The point is the distinction between *configured* and *working*. A captured
template or a typed base URL looks identical in the panel whether it answers or
not, and the previous answer to "did it work?" was reading the Output channel.

Scope note: the button tests an **endpoint**, not the DOM cascade. Endpoints have
no rungs — `ctl.api.prompt` is a direct request. Which rung answered is a property
of `ctl.prompt`, and the panel has no row for a web chat's cascade yet.

---

## 9.4 — the rung rows

**Status: landed, tested.** `settings-panel` 20/20.

The Providers tab showed endpoints but not the cascade, so "which rung is
answering" was invisible even though `ctl.prompt` knew. It now lists each web
chat that has been prompted with:

- a dot — green once a rung has answered, amber once one has fallen through,
  empty before anything has been tried;
- `answering on fast` (or `replay`, or `no rung has answered`);
- how many times it answered, and how many times a rung stepped down.

`ctl.fastpath.set` does not return this state, so the panel reads it back from
`ctl.fastpath.status` after every push rather than inferring it from the config.

Endpoints are deliberately absent: `ctl.api.prompt` is a direct request with no
rungs, so a rung row for one would be a lie.

---

## 10.0 — browser modes: attach, launch, off

**Status: landed, tested.** `npm run test:launch` (10/10).

The project's oldest claim was "it never launches a browser". That is still the
**default** and still the honest one — an attached browser is signed in, already
trusted, and its RAM is the user's to see. But typing a debugging-port command
every morning is a real cost, so the claim became a setting:

| `browser.mode` | What happens |
|---|---|
| `attach` (default) | Use a browser you started with `--remote-debugging-port=9222`. Never launches anything. |
| `launch` | Start Chrome/Edge with a profile **of its own** under `~/.ai-bridge/browser-profile`, then attach. |
| `off` | No browser at all — API endpoints only. |

Supporting settings: `browser.exePath` (empty = auto-detect), `browser.profileDir`,
`browser.headless`, `browser.launchOnStart` (off by default — a window appearing on
every VS Code start is a surprise), and the command **AI Bridge: Launch Browser**.

Two decisions worth stating:

- **`--user-data-dir` is not optional.** Recent Chrome ignores
  `--remote-debugging-port` on the default profile, so a launcher that omits it
  works on old versions and silently fails on new ones. The harness pins it.
- **A profile of its own** means launch mode never fights with the browser you are
  already using, and the 500 MB cap measures only the AI tabs.

### A bug the harness found

The first launcher checked `child.pid` and moved on. A binary that does not exist
fails *asynchronously*, through an `error` event — with no listener that is an
uncaught exception, so a wrong `exePath` crashed the bridge instead of reporting
it. It now awaits `spawn`/`error` and returns `ESPAWN: could not start …`.

Not proven: no real browser has been launched by this code. The assertions are the
arguments we would pass and the failure paths, which is the part that can be wrong
silently.
