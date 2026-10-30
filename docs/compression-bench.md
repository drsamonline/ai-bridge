# Does compression actually save tokens?

Generated: 2026-10-30T04:13:53.691Z

Measured with the project's own conservative counter (max of chars/4 and words×1.35),
on realistic inputs. Fidelity checks that numbers, negations and code fences survive.

| group | case | tokens | saved | fidelity |
|---|---|---|---|---|
| A · short chat | polite one-liner | 34 → 21 | ⇣38% | ok |
| A · short chat | terse one-liner | 8 → 8 | ⇣0% | ok |
| A · short chat | ordinary question | 29 → 29 | ⇣0% | ok |
| B · verbose brief | spec paragraph | 113 → 80 | ⇣29% | ok |
| B · verbose brief | requirements list | 99 → 75 | ⇣24% | ok |
| C · pasted log | stack trace + noise | 83 → 71 | ⇣14% | ok |
| D · code heavy | code request | 68 → 59 | ⇣13% | ok |
| E · repeated | boot prompt | 975 → 974 | ⇣0% | ok |
| E · repeated | repo bundle | 588 → 370 | ⇣37% | ok |

**Total: 1997 → 1687 tokens (16% saved).**

## Trimming the boot

The boot is sent on every failover and compression cannot touch it (⇣0% — it is already
terse structured markdown). Two changes were made instead:

- **File shas removed.** The model never uses them; the applier keeps its own copy.
  Files block: 100 → 82 tokens.
- **Task lines capped at 160 characters**, so one verbose item cannot crowd out ten short ones.
  Full text stays in state and in the T3 export.

Boot for the same state: **975 tokens**, about **45 fewer** than the previous format.

## The bigger lever: not sending context that is not needed

A repo bundle is **588 tokens on every prompt**. The relevance gate decides whether
the question actually needs it:

| query | context | reason |
|---|---|---|
| tell me about foxes | skip | no file, symbol or code term — context would be dead weight |
| what is the difference between a process and a thread | skip | no file, symbol or code term — context would be dead weight |
| thanks! | skip | pleasantry — no context needed |
| refactor src/format.ts to handle empty input | **attach** | names a file (src/format.ts) |
| why does useEffect run twice? | **attach** | names a symbol (useEffect) |
| please fix the slug() helper | **attach** | names a symbol (slug()) |

In this sample, 3 of 6 questions need no bundle —
about **1764 tokens avoided**, against 310 tokens saved by compressing everything.

## Before / after, one example per group

### A · short chat — polite one-liner

```
Hi there! Please could you kindly help me understand why my React component re-renders twice when the parent updates? Thank you so much!
```

becomes

```
help me understand why my React component re-renders twice when the parent updates?!
```

### B · verbose brief — spec paragraph

```
I would like you to please review the authentication module and let me know if there are any issues with it.
Basically, in order to improve the security posture, we must ensure that every request is validated at the edge.
Please note that we must not change the public API of the module at this point in time, because there are
consumers that depend on it. I hope this helps clarify what I am looking for. Thank you so much for your time!
```

becomes

```
review the authentication module and let me know if there are any issues with it. to improve the security posture, we must ensure that every request is validated at the edge.
we must not change the public API of the module now, because there are
consumers that depend on it. clarify what I am looking for. for your time!
```

### C · pasted log — stack trace + noise

```
Hi, I keep getting this error and I would like you to please tell me what it means. Thanks!
TypeError: Cannot read properties of undefined (reading 'trim')
    at slug (src/format.ts:12:9)
    at normalise (src/format.ts:24:3)
    at processInput (src/pipeline.ts:88:11)
I have tried restarting and it still happens. Please help!
```

becomes

```
I keep getting this error and tell me what it means!
TypeError: Cannot read properties of undefined (reading 'trim')
    at slug (src/format.ts:12:9)
    at normalise (src/format.ts:24:3)
    at processInput (src/pipeline.ts:88:11)
I have tried restarting and it still happens. help!
```
