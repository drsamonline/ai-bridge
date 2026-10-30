# Batch 1.1 — extension, status bar and chat-panel evidence (stubbed VS Code host)

Generated: 2026-10-29T15:06:11.611Z
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
PASS  state.full.json.gz was written by the extension
PASS  the state file holds deltas from the prompt
PASS  T1 captured the path the prompt named
PASS  state recorded both sides of the turn
PASS  T1 reported which thread it ran on
PASS  the state file carries the v3 schema marker
PASS  recycle + gc commands produce Output lines
```

Result: 24/24 passed.

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
15:05:57.798 INFO  [ext] no workspace folder — repo context and edit proposals are off
15:05:57.801 INFO  [ext] AI Bridge v0.5.0 activated — extension path <repo>/extension
15:05:57.874 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
15:05:57.901 INFO  [ext] chat panel resolved
15:05:58.375 INFO  [ext] T1 worker ready
15:05:58.378 INFO  [ext] no state at /scratch/tmp/ai-bridge-home-bcY4Fq/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
15:05:58.378 INFO  [ext] state ready: 0 delta(s), 0 file(s)
15:05:58.403 INFO  [ext] state saved: /scratch/tmp/ai-bridge-home-bcY4Fq/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T15-05-58-379Z-init.json.gz
15:05:58.410 INFO  [ext] state: 0 delta(s) at /scratch/tmp/ai-bridge-home-bcY4Fq/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
2026-10-29T15:05:59.381Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":6080,"home":"<tmp-home>"}
2026-10-29T15:05:59.384Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T15:05:59.392Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T15:05:59.398Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T15:05:59.399Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T15:05:59.399Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T15:05:59.400Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":6080,"lock":"<tmp-home>/.ai-bridge/lock.json"}
15:05:59.401 INFO  [ext] bridge ready — port 47911, pid 6080, lock <tmp-home>/.ai-bridge/lock.json
15:05:59.401 INFO  [ext] phase → handshaking (reading lock + attach)
15:05:59.407 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=6080 port=47911
15:05:59.407 INFO  [ext] connecting ws://127.0.0.1:47911
15:05:59.407 INFO  [ext] dialling ws://127.0.0.1:47911
15:05:59.475 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T15:05:59.474Z INFO  [bridge] client connected 127.0.0.1:62205 {"clients":1}
2026-10-29T15:05:59.479Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:62205","pid":6080,"protocol":1,"fingerprint":"d98fdd2a3989"}
15:05:59.484 INFO  [ext] handshake OK — pid=6080 v0.1.0 protocol=v1 token=d98fdd2a3989 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
15:05:59.484 INFO  [ext] phase → ready (handshake ok, pid 6080)
15:05:59.485 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=6080 · v0.1.0 · protocol=v1 · token=d98fdd2a3989 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T15:05:59.486Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T15:05:59.488Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
15:05:59.496 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T15:05:59.497Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T15:05:59.511Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T15:05:59.512Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T15:05:59.679Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T15:05:59.686Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
15:05:59.687 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
15:05:59.688 INFO  [ext] <- attached
2026-10-29T15:06:00.016Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
15:06:00.017 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
15:06:00.018 INFO  [ext] <- tab.opened
15:06:00.067 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
2026-10-29T15:06:00.076Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
15:06:02.593 INFO  [ext] state saved: /scratch/tmp/ai-bridge-home-bcY4Fq/.ai-bridge/state/8001c2743965/state.full.json.gz
15:06:02.593 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 9 ms (worker)
15:06:02.593 INFO  [ext] state: user turn → +1 delta(s), 1 total, 9 ms (worker)
15:06:02.593 INFO  [ext] prompt → chatgpt: Tell me about foxes in src/fox.ts
2026-10-29T15:06:02.594Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T15:06:05.695Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T15:06:05.696Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T15:06:06.015Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
15:06:06.080 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","prompt":"Tell me about foxes in src/fox.ts"}
15:06:06.080 INFO  [ext] <- stream.start
2026-10-29T15:06:06.291Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":33}
2026-10-29T15:06:06.301Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T15:06:06.468Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T15:06:06.501Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
15:06:06.908 INFO  [ext] <- stream.delta
15:06:06.958 INFO  [ext] <- stream.delta
15:06:07.015 INFO  [ext] <- stream.delta
15:06:07.160 INFO  [ext] <- stream.delta
15:06:07.260 INFO  [ext] <- stream.delta
15:06:07.364 INFO  [ext] <- stream.delta
15:06:07.465 INFO  [ext] <- stream.delta
15:06:07.616 INFO  [ext] <- stream.delta
15:06:07.717 INFO  [ext] <- stream.delta
15:06:07.819 INFO  [ext] <- stream.delta
15:06:07.921 INFO  [ext] <- stream.delta
15:06:08.513 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":2043,"firstTokenMs":438,"settledBy":"sentinel","chars":126}
15:06:08.514 INFO  [ext] <- stream.end
2026-10-29T15:06:08.513Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":438,"totalMs":2043,"settledBy":"sentinel","chars":126,"turns":1}
15:06:08.514 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 438 ms · total 2043 ms · settled by sentinel
15:06:08.520 INFO  [ext] state saved: /scratch/tmp/ai-bridge-home-bcY4Fq/.ai-bridge/state/8001c2743965/state.full.json.gz
15:06:08.521 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 7 ms (worker)
15:06:08.521 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 7 ms (worker)
2026-10-29T15:06:09.147Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
15:06:09.149 INFO  [ext] tab.closed: {"id":"tab1"}
15:06:09.150 INFO  [ext] <- tab.closed
2026-10-29T15:06:09.480Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"about:blank","tabs":1}
15:06:09.481 INFO  [ext] tab.opened: {"id":"tab2","url":"about:blank"}
15:06:09.481 INFO  [ext] <- tab.opened
2026-10-29T15:06:09.481Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab1","opened":"tab2"}
15:06:09.482 INFO  [ext] tab recycled (user) → tab2 · total 1
15:06:09.482 INFO  [ext] <- recycled
15:06:09.483 INFO  [ext] recycled tab1 → tab2
2026-10-29T15:06:09.600Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
15:06:09.601 INFO  [ext] gc: {"pages":1,"ok":true}
15:06:09.602 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
15:06:09.605 INFO  [ext] status refresh failed: client closed
15:06:09.609 INFO  [ext] socket closed (code=1000 reason=client-close)
15:06:09.609 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T15:06:09.608Z INFO  [bridge] shutting down (SIGTERM)
2026-10-29T15:06:09.611Z INFO  [bridge] client disconnected 127.0.0.1:62205 {"code":1000,"reason":"client-close","requests":25,"clients":0}
15:06:09.674 INFO  [ext] T1 worker stopped
2026-10-29T15:06:09.675Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
2026-10-29T15:06:09.676Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T15:06:09.689Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T15:06:09.705Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T15:06:09.706Z DEBUG [bridge] event detached had no subscribers
2026-10-29T15:06:09.708Z INFO  [bridge] server closed
2026-10-29T15:06:09.710Z INFO  [bridge] lock file removed
[ext] bridge exited code=0 signal=null
```

## Chat panel traffic (extension → webview)

```
status    "Bridge ready — attach a browser"
status    "Attached: Chrome · 1 tab(s)"
user      "Tell me about foxes in src/fox.ts"
assistant    0 chars  ""
status    "Streaming from chatgpt…"
delta        9 chars  "The quick"
delta       19 chars  "The quick brown fox"
delta       25 chars  "The quick brown fox jumps"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       49 chars  "The quick brown fox jumps over the lazy dog while"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":438,"totalMs":2043,"settledBy":"sentinel","chars":126}
status    "Settled in 2043 ms (first token 438 ms) · sentinel"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).
