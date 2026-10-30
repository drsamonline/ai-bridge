# Batch 1.1 — chat panel virtual-scroll evidence

Generated: 2026-10-29T14:57:00.444Z
Panel HTML: 13115 bytes · messages pushed: 1000 · viewport 420×640

## Checks

```
PASS  panel ships a CSP with a nonce
PASS  panel markup has the virtual-scroll structure
PASS  all messages are in the model
PASS  only a window of rows exists in the DOM
PASS  spacer is sized to the full scroll height
PASS  scrolling to the end renders the newest message
PASS  row count stays bounded after scrolling
PASS  streaming updates a single row instead of appending per delta
PASS  deltas update that row in place
PASS  settled meta renders under the message
PASS  proposal card renders in the panel
PASS  card head shows the diff summary
PASS  card lists every file
PASS  card offers review / accept / reject
PASS  accepting posts the action to the extension
PASS  the card records the outcome and drops its buttons
PASS  a refused proposal hides Accept
PASS  a refused row shows the reason
```

Result: 18/18 passed.

## Measurement

- messages in the model: 1000
- rows in the DOM at rest: 21
- rows after scrolling to the end: 13
- spacer height (full scroll length): 69186px
