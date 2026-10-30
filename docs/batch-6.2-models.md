# Batch 6.2 — model discovery, isFree routing, delta-only transport

Generated: 2026-10-30T09:36:59.055Z

Acceptance: **5 failovers → boot ≤4k each, all deltas present, model list populates Providers tab.**

## Checks

```
PASS  a "free"/"mini"/"flash" label counts as free
PASS  a "pro"/"opus"/"max" label counts as paid
PASS  an explicit data-chat-model-free attribute wins
PASS  an unknown label defaults to paid (conservative)
PASS  duplicates collapse and exactly one model is current
PASS  priority still wins over free-ness
PASS  within one priority, a free model is tried first
PASS  the delta is appended under its own heading
PASS  every delta line survives composition
PASS  no delta means the boot goes out untouched
PASS  the delta line count is reported
PASS  the model list is scraped from the picker
PASS  the current model is identified
PASS  isFree distinguishes the free tier
PASS  an account with no picker infers a single default model
PASS  all five rounds failed over to the fallback provider
PASS  every injected boot stayed inside 4k tokens
PASS  every round carried both delta lines
PASS  the provider echoed the deltas back (they arrived intact)
PASS  the boot itself was restated each round
```

Result: 20/20 passed.

## Model discovery

```
picker account   [{"id":"claude-sonnet","label":"Claude Sonnet 4.5","isFree":false,"current":true},{"id":"claude-haiku","label":"Claude Haiku","isFree":true,"current":false}]
no-picker account [{"id":"default-model","label":"Default model","isFree":false,"current":true}]
```

## Five failovers

| round | answered by | switches | boot chars | delta lines |
|---|---|---|---|---|
| 1 | claude | 1 | 482 | 2 |
| 2 | claude | 1 | 482 | 2 |
| 3 | claude | 1 | 482 | 2 |
| 4 | claude | 1 | 482 | 2 |
| 5 | claude | 1 | 482 | 2 |

## What the provider said when it received the boot (round 1)

```
Restating the state I was given. DOING: - finish delta-only transport TODO: - polish in 7.1 SINCE: - edited bootTransport.ts - decided to prefer free models.
```
