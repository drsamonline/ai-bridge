# Batch 1.2 — chat panel evidence (virtual scroll + proposal cards)

Generated: 2026-10-30T09:34:21.011Z
Panel HTML: 17662 bytes · messages pushed: 1000 · viewport 420×640

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
PASS  a compressed message shows the text that was sent
PASS  the footer reports the saving
PASS  expanding reveals the original text
PASS  the toggle flips back
PASS  every hunk is listed with a checkbox
PASS  each hunk row names its file and delta
PASS  unticking a hunk sends only the selected keys
PASS  a held proposal shows the guard banner
PASS  a held proposal offers Approve override
PASS  the approve button carries the decision id
PASS  approving posts the decision id to the extension
```

Result: 29/29 passed.

## Measurement

- messages in the model: 1000
- rows in the DOM at rest: 21
- rows after scrolling to the end: 13
- spacer height (full scroll length): 69186px
