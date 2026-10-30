# Batch 7.1 — low-end mode + polish

Generated: 2026-10-30T04:21:05.810Z

Acceptance: **8 GB laptop: 3s watchdog, GC button, low-end toggle works.**

## Checks

```
PASS  an 8 GB laptop is low-end under auto
PASS  a 4 GB laptop is low-end under auto
PASS  a 16 GB machine is not low-end under auto
PASS  the toggle forces low-end on a big machine
PASS  the toggle forces it off on a small one
PASS  the threshold is configurable
PASS  low-end halves the boot budget
PASS  low-end trims the repo bundle
PASS  low-end closes T1
PASS  the watchdog stays at 3 s in both modes (§5.11)
PASS  the 4000 budget is genuinely exceeded without the low-end cap
PASS  the low-end boot stays inside its own budget
PASS  the low-end boot is strictly smaller
PASS  the low-end boot still carries DOING
PASS  low-end includes fewer files
PASS  the low-end bundle still answers the query
PASS  the watchdog runs on the 3 s default (§5.11 / §7.1)
PASS  the GC button collects garbage on every owned tab
PASS  the RAM reading is available for the Performance tab
PASS  a tab was opened for the attach
```

Result: 20/20 passed.

## What the toggle actually changes

| setting | normal | low-end |
|---|---|---|
| boot budget | 4000 tok | 2000 tok |
| repo files | 12 | 4 |
| repo budget | 3000 tok | 1200 tok |
| T1 allowed | true | false |
| watchdog poll | 3000 ms | 3000 ms |

Measured: boot 3574 → 1071 tokens; repo bundle 12 → 4 files.
