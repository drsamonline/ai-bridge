# Batch 5.1 — session rotation

Generated: 2026-10-30T09:37:11.967Z

Acceptance: **Simulated limit → context preserved, preview shown.**

## Checks

```
PASS  a detected limit triggers a rotation
PASS  the boot preview is shown on failover
PASS  a fresh page is opened
PASS  the boot is injected into the new page
PASS  context is reported preserved when the chat restates it
PASS  the result names the new tab and the boot size
PASS  no limit means no rotation
PASS  a manual rotation does not require a limit
PASS  manual rotation proceeds without a limit
PASS  cancelling the preview keeps the page and injects nothing
PASS  an edited boot is what gets injected
PASS  the preview can be turned off
PASS  a chat that does not restate is retried once
PASS  the retry prompt carries the stricter preamble
PASS  failure to restate is reported honestly
PASS  an injection error is reported, not swallowed
PASS  an empty boot stops the rotation before touching the page
PASS  the real adapter detects the quota banner
PASS  a prompt is refused while limited
PASS  the rotation ran against the real limit
PASS  the boot preview was shown
PASS  a different page was opened
PASS  the fresh chat restated the state (context preserved)
PASS  the boot stayed inside the 4k budget
PASS  rotation did not disturb the project state
PASS  the rotated session accepts new prompts
```

Result: 26/26 passed.

## The end-to-end rotation

```
limit probe      {"limited":true,"kind":"quota","resetAt":1793353326110}
prompt while limited → ELIMIT: chatgpt is quota (resets in 5 min) — failover lands in batch 5.1/6.1
boot             132/4000 tokens
preview shown    true
new tab          tab3 (was tab2)
ack              ok=true, missing=0
context preserved true
state deltas     0 (unchanged: true)
follow-up prompt 83 chars
```

## The boot that carried the context

```
You are resuming an in-progress engineering task. Read this state, then continue.
Repo: <tmp>
First, restate in one short list: what is DOING right now, and what is next in TODO.
Do not start work before restating. Do not contradict LOCKED DECISIONS.

## LOCKED DECISIONS (must not be contradicted or removed)
- never rotate on a hunch — because test [d1]

## DOING (in flight right now)
- finish the rotation flow  [src/rotation.ts]

## TODO (next, in order)
- wire the manual rotate command
```
