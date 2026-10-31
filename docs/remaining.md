# What is left

**600 checks across 20 suites, all green** (plus the compression benchmark, which writes a report).

## Closed since the last list

| Item | Detail |
|---|---|
| §5.12 **live preview on every tab** | Providers (model list), Router (failover chain), Compressor (T0 sample), State (boot size), Repo (query → attach/skip verdict), Performance (headroom before the 80% point). Verified in a real browser, not by string matching. |
| **Boot trimmed** | File shas dropped (the model never uses them; the applier keeps its own copy) and task lines capped at 160 chars. **975 tokens for a 37-item state, ~45 fewer** on that state — and it scales with file count. |
| **Repo context relevance gate** | `repo.contextMode: auto|always|off`; attaches a 500–900 token bundle only when the question names a file, symbol, `call()` or code term, and logs why when it skips. |

## Open — needs your machine

1. **Live selectors** for ChatGPT / Claude / Gemini (fixtures only so far).
2. **The 1-hour cap hold** (§7.1's real criterion). A 3-minute soak passes flat.
3. **The 10-minute soak** — `npm run soak`.
4. **Install the `.vsix`** — unsigned, not on the Marketplace.

## Open — buildable, deliberately not done

| Item | Why |
|---|---|
| **Windows** | the `ps`/PowerShell parsers exist but only Linux has run; more untested branches would add false confidence |
| **`ChatGPT (2 left)`** | no provider exposes a reliable remaining-count; a cooldown is shown instead |
| **T1 / T2 quality** | both are built, guarded and tested for safety, but never run against a real model — how much they actually save is unknown. T0's savings are measured: 17% overall, 0% on terse prompts, 37% on repo bundles |

## Batch 8 — the free-tier line

The roadmap is in [`batch8/roadmap.md`](batch8/roadmap.md). It changes two items
on this page.

- **Live selectors** (open item 1) stops being a blocker in batch 9.0: the fast
  path goes first and the DOM adapter becomes the fallback rung, which is a
  better answer than testing the selectors harder.
- **`ChatGPT (2 left)`** becomes honest for API endpoints in batch 8.0 — they
  report `usage` in the stream, so a remaining count is real rather than guessed.
  The DOM path keeps the cooldown.

Batch 8.0 is landed and tested (`npm run test:api`, 32/32). 8.1–9.0 are specified
and blocked on their predecessors.
