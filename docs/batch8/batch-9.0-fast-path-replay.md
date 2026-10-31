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
