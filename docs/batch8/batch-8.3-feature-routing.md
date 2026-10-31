# Batch 8.3 — per-feature model routing

**Status: specified. Blocked on 8.1.**

Acceptance: **a commit message never burns the chat model's quota; a model that
is unfit for chat still serves commits, fixes and suggestions.**

## Why

We choose one model and use it for everything. On a free tier that is the most
expensive mistake available: the strong model's daily allowance goes on commit
messages and one-line fixes, and is gone before the work that needed it.

Upstream routes by feature — `commit.model`, `suggestions.model`, `fix.model`,
each defaulting to `auto` — and every model declares which features it fits
(`chat | commit | suggestions | fix`). The flags are independent: a model hidden
from chat still works for the other three. Each picker lists only the fit ones.

## What lands

- `extension/src/features/` — commit message generation, inline suggestion,
  quick fix, each with its own model setting and its own prompt
  (upstream's Conventional Commits prompt is a good default and worth taking).
- **Capability flags on `ModelInfo`** in `shared/src/types.ts` — this is a shape
  change, so it is additive: `capabilities?: { chat, commit, suggestions, fix,
  thinking }`, absent meaning all true.
- **Service requests run thinking off.** `thinkingEnabled(models, id, hasTools,
  override)` returns false for `override: 'off'`, which every service request
  passes. Reasoning costs latency and quota and buys nothing for a commit subject.
- **Bounded generation:** suggestions stop at 30 s, 12 lines or 600 characters,
  whichever comes first. On a slow free backend an unbounded request is a hung
  editor.
- **Small payloads:** prefix 2 000 / suffix 800 characters by default, so the
  request stays inside a free tier's comfort zone.

## Acceptance checks

```
routing: commit uses commit.model, not chat
routing: fix uses fix.model
routing: suggestions use suggestions.model
routing: auto picks the first signed-in model fit for that feature
flags: a chat-hidden model still appears in the commit picker
flags: a model with no flags declared is fit for everything
flags: an unfit model is never selected by auto
thinking: a service request never enables thinking
thinking: chat enables thinking only when the model declares it
thinking: tools disable thinking even when the model declares it
bounds: a suggestion stops at 12 lines
bounds: a suggestion stops at 600 characters
bounds: a suggestion stops at 30 s and offers what arrived
prompt: the commit prompt asks for Conventional Commits and nothing else
```

## Risks

- More model choices means more ways to misconfigure. `auto` must always resolve
  to something; a feature whose model is missing falls back rather than failing.
- Feature traffic competes with chat for the same rate limit. 8.4's cooldown
  accounting is what stops one feature starving another.
