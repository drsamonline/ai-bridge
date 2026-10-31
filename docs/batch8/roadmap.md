# Roadmap 8 — the free-tier productivity line

**Status: open. Batches 8.0, 8.1 and 8.4 landed and tested; 8.2, 8.3 and 9.0 specified.**

Batches 0.1–7.3 built a bridge that drives a logged-in web chat over CDP, with
three adapters, a router, project state, compression, rotation and a watchdog.
That line is closed. This roadmap adds a second axis: **more useful work per free
tier**, without giving up the thing this project is for — no API keys, no second
subscription, the tab you already have.

## Where the work comes from

`AppsGanin/ai-free-vscode`, MIT, commit `6f53bad`. It solves the same problem
from the opposite end: it *launches* its own browser, prefers each provider's
private HTTP API, and registers as a Copilot Chat model provider with a full
tool-calling layer. Its provider set (Qwen, DeepSeek, Kimi, Z.ai) does not
overlap ours (ChatGPT, Claude, Gemini), so nothing here is a fork or a merge —
it is a set of parts, and one architectural idea, taken deliberately.

Per-file provenance is in [`attribution.md`](./attribution.md). Nothing is
copied without being listed there.

## What we are actually buying

| Goal | Mechanism | Batch |
|---|---|---|
| **Capacity** — reach free API tiers, not just three web chats | OpenAI-compatible transport (OpenRouter free pool, Groq, AI Studio, Cerebras, GitHub Models, Ollama) | 8.0 |
| **Productivity** — agent mode, not a chat box | tool-call layer; native where the endpoint supports it, prompt protocol where it does not | 8.1 |
| **Productivity** — reachable from Copilot and agent mode | `languageModelChatProviders` contribution | 8.2 |
| **Economy** — stop burning the good model on chores | per-feature model routing, capability flags, thinking off for service requests | 8.3 |
| **Protection** — one expired session must not cost the chain | typed errors, `retry-after`, network retry, `forgetRejected`, idle timeout, abort-is-not-failure | 8.4 |
| **Resilience** — selectors stop being a single point of failure | fast path first, transparent replay in the owned tab on a challenge | 9.0 |

## Sequence and dependencies

```
8.0 API transport ──► 8.1 tool layer ──► 8.2 Copilot provider
        │                    │
        └──► 8.3 feature routing ◄──┘
                    │
                    └──► 8.4 resilience ──► 9.0 fast path + replay
```

8.0 and 8.4 touch no shared type. 8.1 adds control events. 8.2 is the only batch
that may raise `engines.vscode` — see its open decision. 9.0 is the only batch
that changes what the DOM path is *for*.

## Ground rules, non-negotiable

1. **The frozen contracts stay frozen.** `shared/src/types.ts` says so at the top
   of the file. New operations go in `shared/src/control.ts` as `ctl.*` — that
   second union exists precisely so a new op can never collide with a §4 one.
   `Settings` is not widened; API endpoint config travels in its own shape.
2. **The DOM path is never edited to make room for an API path.** Every batch
   adds a branch beside it. If a batch cannot be reverted by deleting a folder,
   it is designed wrong.
3. **No key touches the disk.** The bridge holds endpoint keys in memory for the
   life of the process. Persistence is the extension's job (SecretStorage, batch
   8.0b), passed over the loopback socket that is already token-authenticated.
4. **Every batch ships its own acceptance harness** in `test/`, in the same shape
   as 0.1–7.3: a `PASS`/`FAIL` list, a result line, and a record in `docs/`.
5. **Nothing is claimed that was not run.** Each batch doc separates *ported*,
   *adapted* and *referenced*, and its checks say what they actually exercised.

## What we deliberately do not take

- **Browser ownership.** `launchPersistentProfile`, per-provider profile
  directories, `channel: "chrome"` launches. Our thesis is the tab you opened;
  adopting their launcher would delete the product's reason to exist.
- **Their settings webview.** We have six tabs with live previews and a
  controller; theirs is one page.
- **The DSH plugin.** Interesting as a host seam, not needed here.
- **Their gaps as if they were features.** They have no per-hunk applier, no
  boot-prompt state, no rotation, no RAM watchdog. A port must not touch those
  four; they are why this repo exists.

## Open items this line changes

`docs/remaining.md` lists **`ChatGPT (2 left)`** as permanently deferred because
"no provider exposes a reliable remaining-count". Batch 8.0 makes that true for
API endpoints only: they report `usage` in the stream. The DOM path keeps the
cooldown. The item moves from *not doable* to *doable where it is honest*.

It also demotes **live selectors** (item 1) from blocker to fallback path — batch
9.0 — which is a better answer than "test the selectors more".

## How to run a batch

```bash
npm run build          # tsc -b shared bridge extension
npm run test:api       # batch 8.0 harness
npm run test:all       # the whole line, unchanged by 8.x
```
