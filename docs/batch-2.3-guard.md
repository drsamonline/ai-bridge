# Batch 2.3 — locked-decision guard, approval flow, bootstrap ack retry

Generated: 2026-10-30T04:18:39.444Z

Acceptance: **Locked edit held + banner + approval flow.**

## Checks

```
PASS  legacy decisions migrate into ProjectState.decisions
PASS  the interim store is cleared after migration
PASS  migration is idempotent (no duplicates on a second run)
PASS  decisionsFromState maps every locked decision
PASS  a path scope in `why` becomes a paths filter
PASS  an edit that removes locked text is held
PASS  the plan names the decision that held it (for the banner)
PASS  a held plan cannot be applied
PASS  apply refuses a held plan
PASS  nothing was written while held
PASS  approving the override re-plans the change as applicable
PASS  the override is still recorded in the plan
PASS  an approved override applies in one batch
PASS  the override leaves an audit delta in the state
PASS  the decision itself stays locked after an override
PASS  a decision scoped to another file does not block this one
PASS  a decision scoped to this file does block it
PASS  a chat that ignores the boot is retried once
PASS  the retry passes and is reported as such
PASS  the retry prompt carries the stricter preamble
PASS  the attempt history records both tries
PASS  a chat that never complies is retried exactly once
PASS  failure reports what was missing
PASS  a real chat that will not restate is retried through the bridge
PASS  the second attempt really reached the page
PASS  a compliant chat needs no retry
```

Result: 26/26 passed.

## The hold

```
src/policy.ts: ELOCKED: would remove locked decision "DO NOT REMOVE THIS LINE: audit trail required" (d-legacy-1)
```

Held by: d-legacy-1 "DO NOT REMOVE THIS LINE: audit trail required" in src/policy.ts

## The approval flow

1. plan refuses (ELOCKED) — nothing written, apply port untouched
2. user approves the override → re-plan with waived=[d-legacy-1] → applicable=true
3. apply → one batch, 1 file(s) written
4. audit delta: override approved by user: locked decision "DO NOT REMOVE THIS LINE: audit trail required" [d-legacy-1] touched in src/policy.ts
5. decision stays locked: true

## Ack retry

- unit, complies on retry: attempts=2 ok=true
- unit, never complies: attempts=2 ok=false missing=2
- e2e through the bridge (variant=boot-bad): attempts=2 ok=false
- e2e through the bridge (variant=boot): attempts=1 ok=true
