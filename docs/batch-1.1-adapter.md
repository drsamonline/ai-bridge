# Batch 1.1 — ChatGPT adapter acceptance evidence

Generated: 2026-10-30T04:19:19.326Z
Node v20.20.2 · fixture http://127.0.0.1:<port>/chatgpt.html

The adapter runs unmodified through real CDP; only the page is a fixture that
reproduces ChatGPT's DOM contract. **Live-account selector verification is still
outstanding** — see the README section "Selectors need one live run".

## Checks

```
PASS  prompt returns the assistant text
PASS  answer streamed rather than arriving at once
PASS  deltas grow monotonically
PASS  first token under 3 s (§NFR)
PASS  settled by the copy-button sentinel
PASS  stream.start and stream.end events emitted
PASS  turn counted against the recycle budget
PASS  health reports the adapter ready
PASS  composer resolved via primary selector
PASS  send resolved via primary selector
PASS  send falls back when the primary selector is missing
PASS  prompt still works through the fallback selector
PASS  composer falls back when #prompt-textarea is absent
PASS  settles without the copy sentinel (stop-gone)
PASS  text still captured without the sentinel
PASS  degrades to the debounce rule when nothing signals completion
PASS  partial text preserved in the degraded path
PASS  health detects the usage-cap banner
PASS  limit kind classified as quota
PASS  prompt refuses while limited (ELIMIT)
PASS  unknown adapter fails with ENOADAPTER
```

Result: 21/21 passed.

First token: 458 ms · total 2116 ms · deltas 50 · settled by sentinel

## Selector matches (default variant)

```
composer       primary       #prompt-textarea
send           primary       [data-testid="send-button"]
stop           none          
assistantTurn  primary       [data-message-author-role="assistant"]
markdown       primary       .markdown
copySentinel   primary       button[data-testid="copy-turn-action-button"]
streamingFlag  none          
limitBanner    none          
```

## Bridge log (tail)

```
2026-10-30T04:18:58.823Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
2026-10-30T04:19:00.836Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":458,"totalMs":2116,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
2026-10-30T04:19:02.044Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
2026-10-30T04:19:02.643Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"http://127.0.0.1:47805/chatgpt.html?variant=no-primary-send","tabs":1}
2026-10-30T04:19:05.590Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"button[aria-label=\"Send prompt\"]"}
2026-10-30T04:19:05.612Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
2026-10-30T04:19:07.625Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":427,"totalMs":2034,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
2026-10-30T04:19:07.633Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
2026-10-30T04:19:08.091Z INFO  [bridge:cdp] tab opened {"id":"tab4","url":"http://127.0.0.1:47805/chatgpt.html?variant=no-composer-id","tabs":1}
2026-10-30T04:19:08.225Z INFO  [bridge:adapters:chatgpt] chatgpt: selector composer → fallback {"selector":"div.ProseMirror[contenteditable=\"true\"]"}
2026-10-30T04:19:10.193Z INFO  [bridge:cdp] tab closed {"id":"tab4","remaining":0}
2026-10-30T04:19:10.705Z INFO  [bridge:cdp] tab opened {"id":"tab5","url":"http://127.0.0.1:47805/chatgpt.html?variant=no-copy","tabs":1}
2026-10-30T04:19:10.905Z INFO  [bridge:adapters:chatgpt] chatgpt: selector composer → primary {"selector":"#prompt-textarea"}
2026-10-30T04:19:11.298Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-30T04:19:11.330Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
2026-10-30T04:19:13.591Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":439,"totalMs":2293,"settledBy":"stop-gone","chars":126,"turns":1,"switched":"none"}
2026-10-30T04:19:13.602Z INFO  [bridge:cdp] tab closed {"id":"tab5","remaining":0}
2026-10-30T04:19:14.014Z INFO  [bridge:cdp] tab opened {"id":"tab6","url":"http://127.0.0.1:47805/chatgpt.html?variant=stuck","tabs":1}
2026-10-30T04:19:14.530Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-30T04:19:14.587Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
2026-10-30T04:19:16.848Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":463,"totalMs":2317,"settledBy":"debounce","chars":126,"turns":1,"switched":"none"}
2026-10-30T04:19:16.864Z INFO  [bridge:cdp] tab closed {"id":"tab6","remaining":0}
2026-10-30T04:19:17.221Z INFO  [bridge:cdp] tab opened {"id":"tab7","url":"http://127.0.0.1:47805/chatgpt.html?variant=limit","tabs":1}
2026-10-30T04:19:17.423Z WARN  [bridge:adapters:chatgpt] chatgpt: limit banner detected (quota) {"selector":"[role=\"alert\"]","resetAt":1793334257423}
2026-10-30T04:19:17.439Z WARN  [bridge:adapters:chatgpt] chatgpt: limit banner detected (quota) {"selector":"[role=\"alert\"]","resetAt":1793334257439}
2026-10-30T04:19:19.179Z WARN  [bridge:adapters:chatgpt] chatgpt: limit banner detected (quota) {"selector":"[role=\"alert\"]","resetAt":1793334259179}
2026-10-30T04:19:19.180Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"http://127.0.0.1:47805/chatgpt.html?variant=limit"}
2026-10-30T04:19:19.202Z WARN  [bridge:adapters:chatgpt] chatgpt: limit banner detected (quota) {"selector":"[role=\"alert\"]","resetAt":1793334259202}
2026-10-30T04:19:19.203Z WARN  [bridge] router: chatgpt limited (quota) — cooling until 2026-10-30T04:24:19.202Z
2026-10-30T04:19:19.204Z WARN  [bridge] op ctl.prompt failed: ELIMIT: chatgpt is quota (resets in 5 min) — failover lands in batch 5.1/6.1
2026-10-30T04:19:19.205Z WARN  [bridge] op ctl.prompt failed: ENOADAPTER: no adapter "nope" — known: chatgpt, claude, gemini
2026-10-30T04:19:19.210Z INFO  [bridge] shutting down (SIGTERM)
2026-10-30T04:19:19.212Z INFO  [bridge] client disconnected 127.0.0.1:53716 {"code":1000,"reason":"client-close","requests":30,"clients":0}
2026-10-30T04:19:19.217Z INFO  [bridge:cdp] tab closed {"id":"tab7","remaining":0}
2026-10-30T04:19:19.218Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-30T04:19:19.226Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-30T04:19:19.290Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-30T04:19:19.291Z DEBUG [bridge] event detached had no subscribers
2026-10-30T04:19:19.292Z INFO  [bridge] server closed
2026-10-30T04:19:19.293Z INFO  [bridge] lock file removed
```
