# Batch 6.1 — router, Claude and Gemini adapters

Generated: 2026-10-30T04:21:24.122Z

Acceptance: **ChatGPT limit → Claude w/ context + toast.**

## Checks

```
PASS  the chain follows priority order
PASS  next() is the highest-priority provider
PASS  a disabled provider is skipped
PASS  a limit starts a cooldown of the configured length
PASS  a cooling provider drops out of the chain
PASS  still cooling just before expiry
PASS  the provider returns after its cooldown
PASS  a provider-supplied reset time wins over the default cooldown
PASS  failures back off exponentially
PASS  the last retry is exhausted and cools the provider
PASS  jitter keeps retries inside ±20%
PASS  linear backoff is not exponential
PASS  retries are bounded: the attempt after them is exhausted
PASS  a success clears failures and cooldown
PASS  no pre-warm candidates at the start of a cooldown
PASS  a provider at 80% cooldown becomes a pre-warm candidate
PASS  a provider whose cooldown expired is not a candidate
PASS  round-robin rotates the starting provider
PASS  priority can be changed through the router (§5.9 tab)
PASS  cooldown can be changed
PASS  a provider can be disabled
PASS  an unknown provider is refused
PASS  status reports state and cooldown progress
PASS  a cooldown can be cleared by hand
PASS  the prompt was answered by the fallback provider
PASS  the switch is recorded with its reason
PASS  the answer came back through Claude
PASS  a provider.switch event was emitted (the toast source)
PASS  the boot was injected into the new provider
PASS  ChatGPT is cooling and Claude is ready
PASS  the router reports the strategy and backoff
PASS  the second prompt skips the cooling provider entirely
PASS  the bridge reports its own RSS (§5.1 budget 30–50 MB)
PASS  the Router tab can reorder and retune a provider
PASS  cooldowns can be cleared through the control plane
```

Result: 35/35 passed.

## The failover, end to end

```
chatgpt url      http://127.0.0.1:<port>/chatgpt.html?variant=limit  (quota banner visible)
claude url       http://127.0.0.1:<port>/assistant.html?flavor=claude&variant=boot
boot             103/4000 tokens
answered by      claude
switched         [{"from":"chatgpt","to":"claude","reason":"limit"}]
answer           83 chars
router state     ["chatgpt:cooling","claude:ready","gemini:ready"]
second prompt    claude, switches=0
```

## Router policy (fake clock)

```
priority order   chatgpt → claude → gemini
cooldown         300 s per provider, provider-supplied resetAt wins
backoff          1000 ms, 2000 ms, then exhausted → cooldown
jitter           ±20% (0.8 → 800 ms, 1.2 → 1200 ms)
pre-warm         candidate at 80% of the cooldown, not after it expires
```
