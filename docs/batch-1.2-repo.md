# Batch 1.2 — RepoReader + EditApplier acceptance evidence

Generated: 2026-10-30T09:12:43.460Z
Core modules run against a real temp repo through a `node:fs` port; no VS Code,
no browser, no model. Every assertion is against bytes on disk.

## Checks

```
PASS  reader indexes the repo
PASS  reader skips node_modules and binaries
PASS  bundle ranks the files that mention the symbol
PASS  bundle carries a sha per file
PASS  bundle states the edit-block protocol
PASS  bundle stays inside the token budget
PASS  signature extraction finds declarations
PASS  query terms drop intent words
PASS  proposal parses every edit block
PASS  proposal keeps hunks per file
PASS  prose outside the blocks is ignored
PASS  an answer with no blocks yields null (no change)
PASS  plan is applicable
PASS  plan touches three files
PASS  plan counts added and removed lines
PASS  plan summary renders as a diff card
PASS  plan produces an applyable diff (before ≠ after, per file)
PASS  apply succeeds
PASS  apply used ONE batch (single WorkspaceEdit)
PASS  that batch carried all three files
PASS  the rename landed on disk
PASS  a rejected proposal changes nothing on disk
PASS  a rejected proposal never calls the apply port
PASS  the plan was still available to review
PASS  apply refuses when a file changed after planning
PASS  the drift refusal wrote nothing
PASS  a SEARCH text that matches twice is refused
PASS  editing a file that does not exist is refused
PASS  ambiguous proposal object is well-formed
PASS  locked decision holds the edit (even in auto mode)
PASS  locked plan cannot be applied
PASS  locked decision left the file untouched
PASS  apply port never called for a held edit
PASS  a file block plans as a create
PASS  a file block creates the file
PASS  a plan lists its hunks with stable keys
PASS  a per-hunk selection applies only the chosen hunks
PASS  a per-hunk apply is still one WorkspaceEdit
PASS  a selection matching no hunk is refused, not silently applied
PASS  re-applying a stale plan is refused as drift
PASS  context gate: "tell me about foxes" → skip
PASS  context gate: "what is a process vs a thread" → skip
PASS  context gate: "thanks!" → skip
PASS  context gate: "refactor src/format.ts" → attach
PASS  context gate: "why does useEffect run twice?" → attach
PASS  context gate: "please fix the slug() helper" → attach
PASS  context gate: "what does `MAX_LENGTH` do" → attach
PASS  context gate: "add a test for the parser" → attach
PASS  the gate explains itself
PASS  lineDelta counts a clean one-line change
PASS  sha is stable and short
```

Result: 51/51 passed.

## The acceptance scenario

Prompt: `rename oldName to newName`.

- bundle: 3 files, 290 tokens
- plan: 3 files +5 −5 — applicable=true
- apply: one batch of 3 files
- reject: disk byte-identical, apply port never called

## Planned files

```
src/format.ts      ok       +1 −1  hunks=1
src/use-a.ts       ok       +2 −2  hunks=2
src/use-b.ts       ok       +2 −2  hunks=2
```
