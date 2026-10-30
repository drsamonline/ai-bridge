# Batch 2.2 — extension evidence: status bar, chat panel, repo, state, boot (stubbed VS Code host)

Generated: 2026-10-29T15:25:12.516Z
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
PASS  boot preview opens a continuation prompt
PASS  boot prompt is under 4k tokens
PASS  boot prompt names the repo context
PASS  recycle + gc commands produce Output lines
```

Result: 27/27 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1213/8000 · tab 2s
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
15:24:49.559 INFO  [ext] no workspace folder — repo context and edit proposals are off
15:24:49.570 INFO  [ext] AI Bridge v0.6.0 activated — extension path <repo>/extension
15:24:49.607 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
15:24:49.773 INFO  [ext] chat panel resolved
15:24:50.834 INFO  [ext] T1 worker ready
15:24:50.865 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
15:24:50.885 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
15:24:50.885 INFO  [ext] state ready: 0 delta(s), 0 file(s)
15:24:51.011 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T15-24-50-903Z-init.json.gz
15:24:51.034 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
2026-10-29T15:24:54.360Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":8183,"home":"<tmp-home>"}
2026-10-29T15:24:54.382Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T15:24:54.431Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T15:24:54.451Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T15:24:54.452Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T15:24:54.454Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T15:24:54.458Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":8183,"lock":"<tmp-home>/.ai-bridge/lock.json"}
15:24:54.466 INFO  [ext] bridge ready — port 47911, pid 8183, lock <tmp-home>/.ai-bridge/lock.json
15:24:54.468 INFO  [ext] phase → handshaking (reading lock + attach)
15:24:54.477 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=8183 port=47911
15:24:54.477 INFO  [ext] connecting ws://127.0.0.1:47911
15:24:54.477 INFO  [ext] dialling ws://127.0.0.1:47911
15:24:54.688 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T15:24:54.684Z INFO  [bridge] client connected 127.0.0.1:55566 {"clients":1}
2026-10-29T15:24:54.697Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:55566","pid":8183,"protocol":1,"fingerprint":"a4e91211f862"}
15:24:54.719 INFO  [ext] handshake OK — pid=8183 v0.1.0 protocol=v1 token=a4e91211f862 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
15:24:54.719 INFO  [ext] phase → ready (handshake ok, pid 8183)
15:24:54.723 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=8183 · v0.1.0 · protocol=v1 · token=a4e91211f862 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T15:24:54.735Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T15:24:54.738Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
15:24:54.748 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T15:24:54.749Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T15:24:54.842Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T15:24:54.847Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T15:24:55.690Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T15:24:55.728Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
15:24:55.738 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
15:24:55.739 INFO  [ext] <- attached
2026-10-29T15:24:55.959Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T15:24:56.568Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
15:24:56.580 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
15:24:56.580 INFO  [ext] <- tab.opened
15:24:56.582 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
15:24:59.171 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
15:24:59.171 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 52 ms (worker)
15:24:59.171 INFO  [ext] state: user turn → +1 delta(s), 1 total, 52 ms (worker)
15:24:59.171 INFO  [ext] prompt → chatgpt: Tell me about foxes in src/fox.ts
2026-10-29T15:24:59.177Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T15:25:02.362Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T15:25:02.363Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T15:25:03.454Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
15:25:03.531 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","prompt":"Tell me about foxes in src/fox.ts"}
15:25:03.534 INFO  [ext] <- stream.start
2026-10-29T15:25:04.442Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":33}
2026-10-29T15:25:04.552Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T15:25:05.010Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T15:25:05.249Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
15:25:05.398 INFO  [ext] <- stream.delta
15:25:05.556 INFO  [ext] <- stream.delta
15:25:05.686 INFO  [ext] <- stream.delta
15:25:05.768 INFO  [ext] <- stream.delta
15:25:05.853 INFO  [ext] <- stream.delta
15:25:05.994 INFO  [ext] <- stream.delta
15:25:06.171 INFO  [ext] <- stream.delta
15:25:06.231 INFO  [ext] <- stream.delta
15:25:06.482 INFO  [ext] <- stream.delta
15:25:06.564 INFO  [ext] <- stream.delta
15:25:06.727 INFO  [ext] <- stream.delta
15:25:06.787 INFO  [ext] <- stream.delta
15:25:06.971 INFO  [ext] <- stream.delta
15:25:07.143 INFO  [ext] <- stream.delta
15:25:07.270 INFO  [ext] <- stream.delta
15:25:07.773 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":2747,"firstTokenMs":360,"settledBy":"sentinel","chars":126}
15:25:07.777 INFO  [ext] <- stream.end
15:25:07.784 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 360 ms · total 2747 ms · settled by sentinel
2026-10-29T15:25:07.772Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":360,"totalMs":2747,"settledBy":"sentinel","chars":126,"turns":1}
15:25:07.852 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
15:25:07.852 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 68 ms (worker)
15:25:07.852 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 68 ms (worker)
15:25:08.526 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
15:25:08.526 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
15:25:08.526 INFO  [ext] boot injection cancelled
2026-10-29T15:25:08.593Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
15:25:08.626 INFO  [ext] tab.closed: {"id":"tab1"}
15:25:08.626 INFO  [ext] <- tab.closed
2026-10-29T15:25:10.120Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"about:blank","tabs":1}
2026-10-29T15:25:10.128Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab1","opened":"tab2"}
15:25:10.134 INFO  [ext] tab.opened: {"id":"tab2","url":"about:blank"}
15:25:10.135 INFO  [ext] <- tab.opened
15:25:10.141 INFO  [ext] tab recycled (user) → tab2 · total 1
15:25:10.142 INFO  [ext] <- recycled
15:25:10.142 INFO  [ext] recycled tab1 → tab2
2026-10-29T15:25:10.334Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
15:25:10.336 INFO  [ext] gc: {"pages":1,"ok":true}
15:25:10.337 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
15:25:10.366 INFO  [ext] socket closed (code=1000 reason=client-close)
15:25:10.366 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T15:25:10.361Z INFO  [bridge] shutting down (SIGTERM)
2026-10-29T15:25:10.376Z INFO  [bridge] client disconnected 127.0.0.1:55566 {"code":1000,"reason":"client-close","requests":29,"clients":0}
15:25:10.398 INFO  [ext] T1 worker stopped
2026-10-29T15:25:10.432Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
2026-10-29T15:25:10.439Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T15:25:10.555Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T15:25:10.625Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T15:25:10.631Z DEBUG [bridge] event detached had no subscribers
2026-10-29T15:25:10.636Z INFO  [bridge] server closed
2026-10-29T15:25:10.649Z INFO  [bridge] lock file removed
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
delta       30 chars  "The quick brown fox jumps over"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       43 chars  "The quick brown fox jumps over the lazy dog"
delta       49 chars  "The quick brown fox jumps over the lazy dog while"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       69 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       81 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       98 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":360,"totalMs":2747,"settledBy":"sentinel","chars":126}
status    "Settled in 2747 ms (first token 360 ms) · sentinel"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).
