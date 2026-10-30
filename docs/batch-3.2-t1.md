# Batch 3.2 — T1 compressor (opt-in local model)

Generated: 2026-10-30T04:18:45.880Z

Acceptance: **Identifiers preserved; low-end stays T0.**

## Checks

```
PASS  below 8 GB the gate keeps T1 off
PASS  8 GB and above the gate permits T1
PASS  the user can force T1 on against the gate
PASS  the user can force T1 off on a big machine
PASS  the threshold is configurable
PASS  this low-end machine stays on T0 (the acceptance line)
PASS  identifiers are extracted from prose, code and paths
PASS  snake_case and CamelCase both count
PASS  a declaration name is captured even without backticks
PASS  verifyIdentifiers reports exactly what went missing
PASS  a safe, shorter T1 result is used
PASS  the T1 result keeps every identifier
PASS  T1 beats T0 on tokens
PASS  the ratio and savedChars are consistent
PASS  a model that renames an identifier is rejected
PASS  the rejected result is byte-identical to T0 output
PASS  a model that drops a code fence is rejected
PASS  the protected-span rejection keeps T0 output
PASS  a model that makes the prompt longer is rejected
PASS  a backend that throws falls back to T0
PASS  a slow backend does not block the prompt
PASS  an unavailable backend leaves T0 in charge
PASS  an in-process model over the 150 MB band is refused
PASS  an in-process model inside the band is allowed
PASS  on a low-end machine T1 never runs, even with a perfect model
PASS  forcing T1 on overrides the low-end gate
PASS  the Ollama backend probes /api/tags
PASS  Ollama reports available when the server answers
PASS  a T1 result from Ollama goes through the same guards
PASS  the request carried the compression instruction
PASS  Ollama reports unavailable when nothing is listening
PASS  a dead Ollama leaves T0 in charge
PASS  the llama.cpp backend is optional and reports unavailable without the dependency
PASS  a missing llama.cpp dependency degrades to T0 without throwing
PASS  the provider T2 backend is available whenever it can send
PASS  T2 sends a compression instruction, not the raw text
PASS  T2 returns the rewritten request
PASS  a fenced reply is unwrapped
PASS  an empty reply is an error, not an empty prompt
PASS  T2 goes through the same identifier guard as T1
PASS  a T2 reply that loses identifiers falls back to T0
```

Result: 41/41 passed.

## The memory gate

```
 2 GB → T1 off  low-end machine (2.0 GB < 8.0 GB) — staying on T0
 4 GB → T1 off  low-end machine (4.0 GB < 8.0 GB) — staying on T0
 8 GB → T1 on   8.0 GB ≥ 8.0 GB — T1 permitted
16 GB → T1 on   16.0 GB ≥ 8.0 GB — T1 permitted
32 GB → T1 on   32.0 GB ≥ 8.0 GB — T1 permitted
this machine 2.05 GB → T1 off  low-end machine (2.0 GB < 8.0 GB) — staying on T0
```

## The identifier guard

```
input      Please could you kindly refactor the `formatSlug` helper in src/format.ts so that MAX_LENGTH is respected and `parseInput` stays pure, thank you so much!
identifiers ["formatSlug","parseInput","MAX_LENGTH","src/format.ts"]
good model  refactor `formatSlug` in src/format.ts; keep MAX_LENGTH; `parseInput` stays pure
  → tier T1, 39→20 tokens, 4 identifier(s) preserved, 8 tokens saved over T0
mangling    refactor slugify in src/format.ts; keep MAX_LENGTH; parseInput stays pure
  → tier T0, rejected=identifiers, missing=["formatSlug"]
```

## What is not proven here

No llama.cpp or Ollama is installed in this environment, so no real model was run.
The Ollama path is exercised against a stub HTTP server: that proves the protocol,
the guards and the fallback, not the model's compression quality or its 50–150 MB
footprint. Those need a machine with a local model — the same machine that will pass
the 8 GB gate.
