# Batch 2.1 — state schema, gzip persistence, T1 worker

Generated: 2026-10-30T04:18:41.283Z
Node v20.20.2 · worker: inline

Acceptance: **10 turns → `state.full.json.gz` with deltas.**

## Checks

```
PASS  T1 ran on a worker thread, not the host thread
PASS  the worker bundle pulls no heavy modules
PASS  each turn stayed under 500 ms
PASS  10 turns produced state.full.json.gz
PASS  the file is real gzip
PASS  gunzipped state parses as JSON
PASS  state validates against the v3 schema
PASS  state carries deltas
PASS  deltas respect the §4 cap
PASS  deltas include edit / decide / add ops
PASS  delta summaries are redacted of secrets
PASS  the raw file does not contain the secret in plaintext
PASS  files mentioned in the turns are tracked
PASS  stack was detected from the turns
PASS  constraints were captured
PASS  TODO items landed in todo[]
PASS  DONE items landed in done[]
PASS  meta.updatedAt and bootTokenEstimate are set
PASS  no .tmp file was left behind
PASS  the write is atomic in shape (temp then rename)
PASS  snapshots were written (init + every 10 turns)
PASS  snapshot names are timestamped and labelled
PASS  a snapshot restores a valid state
PASS  delta list is capped at 200
PASS  the cap drops the oldest, not the newest
PASS  encrypted state uses the .aes suffix
PASS  encrypted bytes do not contain the plaintext path
PASS  encrypted state round-trips
PASS  a wrong key fails to decrypt rather than returning garbage
PASS  decrypting with the wrong key is detected
PASS  a corrupt file is detected and reported
PASS  a corrupt file is kept as .corrupt-* rather than deleted
PASS  recovery yields a fresh valid state
PASS  T1 extracts repo paths
PASS  T1 counts code fences
PASS  T1 captures TODO and DONE
PASS  T1 captures decisions
PASS  T1 emits one delta per extraction
PASS  redaction removes github and anthropic keys
PASS  validateState rejects a wrong version
PASS  validateState rejects a malformed delta
PASS  validateState rejects a non-locked decision
```

Result: 42/42 passed.

## What the file contains after 10 turns

```
deltas        15 (cap 200)
files         5 — src/format.ts, src/use-a.ts, lib/parser.py, src/use-b.ts, docs/README.md
stack         typescript, python, vitest, jest, markdown
constraints   2
todo / done   2 / 2
bootTokens    675
snapshots     2
```

## Turn latency (T1 in the worker, per turn)

```
min 4 ms · median 5 ms · max 13 ms
```

## Delta ops observed

```
edit: 11
decide: 2
add: 2
```

## Sample deltas

```
edit    src/format.ts          user referenced src/format.ts
edit    src/format.ts          assistant referenced src/format.ts
edit    src/use-a.ts           assistant referenced src/use-a.ts
decide  —                      keep the export name stable
edit    lib/parser.py          user referenced lib/parser.py
add     —                      TODO: add a test for the trim path. Also lib/parser.py imports the same idea.
edit    src/format.ts          assistant referenced src/format.ts
add     —                      TODO: cover the unicode case in src/format.ts.
edit    —                      DONE: extracted the trim logic. TODO: cover the unicode case in src/format.ts.
decide  —                      use vitest for the new tests rather than jest
edit    src/format.ts          assistant referenced src/format.ts
edit    src/use-b.ts           user referenced src/use-b.ts
```
