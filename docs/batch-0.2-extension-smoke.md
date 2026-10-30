# Batch 0.2 — extension + status bar evidence (stubbed VS Code host)

Generated: 2026-10-29T14:44:59.196Z
Node v20.20.2 · stub host 1.94.0-stub · fixture /usr/local/bin/chromium-headless-shell

## Checks

```
PASS  handshake logged to Output
PASS  CDP attach logged to Output
PASS  status bar shows the attached browser
PASS  status bar shows a live RAM meter
PASS  status bar shows tab age
PASS  status bar is visible
PASS  tooltip carries the RAM detail and source
PASS  acceptance rendering is exactly "Attached: Edge · RAM 120/500"
PASS  panel received the user message
PASS  panel received an assistant placeholder
PASS  panel received streamed deltas (not one blob)
PASS  panel deltas grow
PASS  panel received the settled answer
PASS  first token under 3 s in the panel path
PASS  answer settled by the copy sentinel
PASS  end-to-end prompt under 10 s in a stubbed host
PASS  status bar shows the ✓ settle time
PASS  recycle + gc commands produce Output lines
```

Result: 18/18 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1196/8000 · tab 2s
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
14:44:45.090 INFO  [ext] AI Bridge v0.3.0 activated — extension path <repo>/extension
14:44:45.102 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
14:44:45.258 INFO  [ext] chat panel resolved
2026-10-29T14:44:46.783Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":3367,"home":"<tmp-home>"}
2026-10-29T14:44:46.794Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T14:44:46.807Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T14:44:46.815Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T14:44:46.816Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T14:44:46.817Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T14:44:46.819Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":3367,"lock":"<tmp-home>/.ai-bridge/lock.json"}
14:44:46.821 INFO  [ext] bridge ready — port 47911, pid 3367, lock <tmp-home>/.ai-bridge/lock.json
14:44:46.821 INFO  [ext] phase → handshaking (reading lock + attach)
14:44:46.836 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=3367 port=47911
14:44:46.836 INFO  [ext] connecting ws://127.0.0.1:47911
14:44:46.836 INFO  [ext] dialling ws://127.0.0.1:47911
14:44:46.862 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T14:44:46.859Z INFO  [bridge] client connected 127.0.0.1:51687 {"clients":1}
2026-10-29T14:44:46.870Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:51687","pid":3367,"protocol":1,"fingerprint":"3cc744859850"}
14:44:46.875 INFO  [ext] handshake OK — pid=3367 v0.1.0 protocol=v1 token=3cc744859850 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
14:44:46.875 INFO  [ext] phase → ready (handshake ok, pid 3367)
14:44:46.875 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=3367 · v0.1.0 · protocol=v1 · token=3cc744859850 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T14:44:46.877Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T14:44:46.877Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
14:44:46.880 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T14:44:46.881Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T14:44:46.896Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T14:44:46.897Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T14:44:47.049Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T14:44:47.074Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
14:44:47.075 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
14:44:47.076 INFO  [ext] <- attached
2026-10-29T14:44:47.390Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
14:44:47.391 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
14:44:47.392 INFO  [ext] <- tab.opened
14:44:47.393 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
2026-10-29T14:44:47.396Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
14:44:49.985 INFO  [ext] prompt → chatgpt: Tell me about foxes
2026-10-29T14:44:49.986Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T14:44:53.151Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T14:44:53.151Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T14:44:53.524Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
14:44:53.577 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","prompt":"Tell me about foxes"}
14:44:53.578 INFO  [ext] <- stream.start
2026-10-29T14:44:53.837Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":19}
2026-10-29T14:44:53.855Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T14:44:53.977Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T14:44:54.053Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
14:44:54.458 INFO  [ext] <- stream.delta
14:44:54.510 INFO  [ext] <- stream.delta
14:44:54.560 INFO  [ext] <- stream.delta
14:44:54.610 INFO  [ext] <- stream.delta
14:44:54.712 INFO  [ext] <- stream.delta
14:44:54.811 INFO  [ext] <- stream.delta
14:44:54.863 INFO  [ext] <- stream.delta
14:44:54.964 INFO  [ext] <- stream.delta
14:44:55.062 INFO  [ext] <- stream.delta
14:44:55.167 INFO  [ext] <- stream.delta
14:44:55.217 INFO  [ext] <- stream.delta
14:44:55.317 INFO  [ext] <- stream.delta
14:44:55.419 INFO  [ext] <- stream.delta
14:44:56.063 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":2084,"firstTokenMs":478,"settledBy":"sentinel","chars":126}
14:44:56.064 INFO  [ext] <- stream.end
2026-10-29T14:44:56.063Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":478,"totalMs":2084,"settledBy":"sentinel","chars":126,"turns":1}
14:44:56.064 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 478 ms · total 2084 ms · settled by sentinel
2026-10-29T14:44:56.756Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
14:44:56.760 INFO  [ext] tab.closed: {"id":"tab1"}
14:44:56.760 INFO  [ext] <- tab.closed
2026-10-29T14:44:57.087Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"about:blank","tabs":1}
14:44:57.088 INFO  [ext] tab.opened: {"id":"tab2","url":"about:blank"}
14:44:57.089 INFO  [ext] <- tab.opened
2026-10-29T14:44:57.088Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab1","opened":"tab2"}
14:44:57.089 INFO  [ext] tab recycled (user) → tab2 · total 1
14:44:57.089 INFO  [ext] <- recycled
14:44:57.090 INFO  [ext] recycled tab1 → tab2
2026-10-29T14:44:57.186Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
14:44:57.188 INFO  [ext] gc: {"pages":1,"ok":true}
14:44:57.189 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
14:44:57.192 INFO  [ext] status refresh failed: client closed
14:44:57.196 INFO  [ext] socket closed (code=1000 reason=client-close)
14:44:57.197 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T14:44:57.196Z INFO  [bridge] shutting down (SIGTERM)
2026-10-29T14:44:57.198Z INFO  [bridge] client disconnected 127.0.0.1:51687 {"code":1000,"reason":"client-close","requests":27,"clients":0}
2026-10-29T14:44:57.206Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
2026-10-29T14:44:57.209Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T14:44:57.275Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T14:44:57.284Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T14:44:57.284Z DEBUG [bridge] event detached had no subscribers
2026-10-29T14:44:57.286Z INFO  [bridge] server closed
2026-10-29T14:44:57.288Z INFO  [bridge] lock file removed
[ext] bridge exited code=0 signal=null
```

## Chat panel traffic (extension → webview)

```
status    "Bridge ready — attach a browser"
status    "Attached: Chrome · 1 tab(s)"
user      "Tell me about foxes"
assistant    0 chars  ""
status    "Streaming from chatgpt…"
delta        9 chars  "The quick"
delta       19 chars  "The quick brown fox"
delta       25 chars  "The quick brown fox jumps"
delta       30 chars  "The quick brown fox jumps over"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       53 chars  "The quick brown fox jumps over the lazy dog while the"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       81 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":478,"totalMs":2084,"settledBy":"sentinel","chars":126}
status    "Settled in 2084 ms (first token 478 ms) · sentinel"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).
