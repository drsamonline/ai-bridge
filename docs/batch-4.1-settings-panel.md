# Batch 4.1 — settings panel (UI evidence)

Generated: 2026-10-30T09:34:10.981Z
Panel HTML: 32760 bytes · six tabs · driven by the real SettingsController

## Checks

```
PASS  the panel ships a CSP with a nonce
PASS  all six tabs are present in the markup
PASS  the six tabs render with the first selected
PASS  the Providers tab renders its fields
PASS  every one of the six tabs shows a live preview
PASS  the previews are built from the live snapshot, not placeholders
PASS  an out-of-range value shows an inline error
PASS  the invalid value was not written to the store
PASS  correcting the value clears the error
PASS  the corrected value reached the store
PASS  switching tabs renders that tab’s fields
PASS  §4 protectCode is rendered as fixed and disabled
PASS  the T0 preview round-trips through the host
PASS  an action button posts a command the host runs
PASS  provider health renders 🟢 / 🔴 from the live probe
PASS  the performance tab draws a RAM sparkline
PASS  reset posts a resetTab command for the active tab
```

Result: 17/17 passed.

## The inline error, as the browser saw it

```
input: aiBridge.bridge.port = 99999
aria-invalid: true
error shown: true
message: Must be at most 65535.
stored: yes (WRONG)
```
