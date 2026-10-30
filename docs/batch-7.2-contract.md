# Batch 7.2 — contract tests + breakage report

Generated: 2026-10-30T09:21:45.156Z

Acceptance: **CI green; report JSON has no chat content.**

## Checks

```
PASS  the report carries the adapter, role and selectors tried
PASS  the host is kept but the path and query are not
PASS  the error is reduced to a code, not the page text
PASS  the shape carries tag and attribute names only
PASS  the report declares that it holds no chat content
PASS  no chat fragment appears anywhere in the report JSON
PASS  the guard would catch a leak if one existed
PASS  an API key cannot appear because no free text is copied
PASS  a file path cannot appear because no free text is copied
PASS  ChatGPT: the adapter reports ready on its fixture
PASS  ChatGPT: composer and send both resolve
PASS  ChatGPT: a prompt is answered and settles
PASS  ChatGPT: the usage banner is detected
PASS  Claude: the adapter reports ready on its fixture
PASS  Claude: composer and send both resolve
PASS  Claude: a prompt is answered and settles
PASS  Claude: the usage banner is detected
PASS  Gemini: the adapter reports ready on its fixture
PASS  Gemini: composer and send both resolve
PASS  Gemini: a prompt is answered and settles
PASS  Gemini: the usage banner is detected
PASS  the broken fixture is detected as not ready
PASS  the composer no longer resolves
PASS  the contract predicate FAILS on the broken fixture (CI would go red)
PASS  a healthy fixture still passes the same predicate
PASS  diagnostics describe the page without reading its text
PASS  a report built from the live page leaks no conversation
PASS  a CI workflow exists
PASS  CI runs the full suite
PASS  CI installs a browser for the CDP suites
PASS  CI covers every test file in the repo
```

Result: 31/31 passed.

## The adapter contract, per provider

| adapter | ready | composer | send | answered | settled by | limit detected |
|---|---|---|---|---|---|---|
| ChatGPT | yes | yes | yes | yes | sentinel | quota |
| Claude | yes | yes | yes | yes | sentinel | quota |
| Gemini | yes | yes | yes | yes | sentinel | quota |

## A report built from a live page

```json
{
  "schema": 1,
  "when": "2026-10-30T09:21:44.753Z",
  "adapter": {
    "id": "claude",
    "host": "unknown",
    "role": "composer",
    "via": "primary"
  },
  "selectors": {
    "tried": [
      "div.ProseMirror[contenteditable=\"true\"]"
    ],
    "matched": "div.ProseMirror[contenteditable=\"true\"]"
  },
  "error": {
    "code": "ENOSELECTOR",
    "message": "ENOSELECTOR while resolving composer on unknown"
  },
  "environment": {
    "extensionVersion": "0.15.0",
    "bridgeVersion": null,
    "platform": "linux-x64",
    "nodeVersion": "v20.20.2"
  },
  "shape": {
    "tags": [
      "body",
      "main",
      "div",
```

Privacy guard on that report:

```
{"ok":true,"leaked":[]}
```

The three chat fragments used in the test:

```
- my patient has a persistent cough since March
- here is my API key sk-live-abcdef1234567890
- src/private/patient-notes.ts
```
