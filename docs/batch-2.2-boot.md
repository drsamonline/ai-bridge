# Batch 2.2 — T2, T3, buildBoot()≤4k

Generated: 2026-10-30T09:12:55.133Z

Acceptance: **New chat + boot → AI restates DOING/TODO correctly.**

The model is played by the ChatGPT DOM fixture driven through the real bridge,
adapter and CDP path. A second fixture variant refuses to restate, and the ack
check must fail there — a test that cannot fail proves nothing.

## Checks

```
PASS  boot is under 4k tokens
PASS  boot carries a DOING section with the in-flight work
PASS  boot carries a TODO section
PASS  boot instructs the model to restate before working
PASS  boot names the repo and stack
PASS  meta.bootTokenEstimate is updated from the real boot
PASS  an oversized state still fits in 4k
PASS  trimming keeps DOING
PASS  trimming keeps LOCKED DECISIONS
PASS  trimming drops the low-priority sections
PASS  countTokens is conservative for code
PASS  a fresh chat answered the boot prompt
PASS  the answer restates every DOING/TODO item
PASS  verifyAck reports ok for a compliant restatement
PASS  a chat that ignores the boot fails the ack check
PASS  T2 ran on its 5-turn interval
PASS  T2 extracts work items from a window
PASS  T2 merge does not duplicate what T1 already recorded
PASS  T2 recorded which backend ran
PASS  a failing T2 backend falls back instead of stalling
PASS  T3 fills in a sha that was missing
PASS  T3 drops a tracked file that no longer exists
PASS  T3 adds a file named in recent deltas
PASS  T3 computes a dirty hash
PASS  T3 recomputes the stack from real extensions
PASS  T3 detects a file changed on disk
PASS  the dirty hash moves when a file changes
PASS  parsePatch reads a fenced JSON block
PASS  parsePatch tolerates prose around the JSON
PASS  parsePatch returns null for an answer with no JSON
```

Result: 30/30 passed.

## The boot prompt that was sent

```
You are resuming an in-progress engineering task. Read this state, then continue.
Repo: <tmp>/repo
Stack: typescript, vitest
First, restate in one short list: what is DOING right now, and what is next in TODO.
Do not start work before restating. Do not contradict LOCKED DECISIONS.

## DOING (in flight right now)
- editing src/api.ts  [src/api.ts]

## TODO (next, in order)
- add a unicode test in src/format.test.ts.  [src/format.test.ts]
- document the API constant in src/api.ts  [src/api.ts]

## CONSTRAINTS
- keep slug() pure
- use vitest for these tests
- change the public export names

## RECENT CHANGES (newest first)
- decide: use vitest for these tests
- edit: DONE: renamed the helper. Next I am editing src/api.ts.
- edit src/api.ts: assistant referenced src/api.ts
- add: TODO: document the API constant in src/api.ts
- edit src/api.ts: user referenced src/api.ts
- decide: keep slug() pure
- add: TODO: add a unicode test in src/format.test.ts.
- edit src/format.test.ts: assistant referenced src/format.test.ts
- edit src/format.ts: user referenced src/format.ts

## FILES IN PLAY
- src/format.ts
- src/format.test.ts
- src/api.ts

## DONE (recently)
- renamed the helper. Next I am editing src/api.ts.
```

Tokens: 312/4000 · sections [header, doing, todo, constraints, deltas, files, done]

## What the fresh chat answered

```
Restating the state I was given. DOING: - editing src/api.ts TODO: - add a unicode test in src/format.test.ts. - document the API constant in src/api.ts.
```

Ack: ok=true · restated 3 · missing 0

## Oversized state

500 todo / 300 files / 80 glossary / 200 deltas → 1247 tokens, kept [header, decisions, doing, todo], trimmed [glossary, files, deltas, todo]

## T2 / T3

- T2: heuristic in 7 ms — {"doing":0,"todo":0,"done":0,"decisions":0,"files":0,"glossary":0}
- T2 fallback on a broken backend: heuristic (fallback) (model went away)
- T3: 2 files, dirtyHash 6f200d6443e43037; after an edit: src/api.ts → cec20b48d7e31da2
