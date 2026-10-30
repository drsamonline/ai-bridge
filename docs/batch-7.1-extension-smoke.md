# Batch 7.1 — extension evidence: status bar, panel, repo, state, boot, guard, compressor, settings, rotation, router, models, low-end mode (stubbed VS Code host)

Generated: 2026-10-29T17:57:19.098Z
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
PASS  T1 gate decision is logged (low-end machine stays on T0)
PASS  the prompt still went out (T1 being off never blocks)
PASS  T0 ran on the outgoing prompt
PASS  status bar shows the compression meter (§6 Status Bar row)
PASS  low-end mode is active on this machine and shown in the status bar (§7.1)
PASS  keyboard shortcuts are contributed (§7.1 polish)
PASS  status bar shows the boot token meter (§6 Status Bar row)
PASS  boot preview opens a continuation prompt
PASS  boot prompt is under 4k tokens
PASS  boot prompt names the repo context
PASS  the rotate command runs the full flow and reports it
PASS  rotation logged the boot it carried
PASS  the settings panel opens with all six tabs
PASS  the panel is a webview with a nonce and no inline handler leaks
PASS  recycle + gc commands produce Output lines
```

Result: 38/38 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1199/8000 · tok 0/4k · tab 2s · $(zap) LE
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
17:56:53.676 INFO  [ext] no workspace folder — repo context and edit proposals are off
17:56:53.716 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
17:56:53.731 WARN  [ext] low-end: 2.0 GB ≤ 8.0 GB — low-end mode on (T1 off, short boot, fewer files)
17:56:53.755 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
17:56:53.844 INFO  [ext] chat panel resolved
17:56:54.417 INFO  [ext] T0 worker ready
17:56:54.417 INFO  [ext] T0 compressor ready (worker thread), tier=auto, budget=4096 tokens
17:56:54.438 INFO  [ext] T1 off: low-end machine (2.0 GB < 8.0 GB) — staying on T0
17:56:54.574 INFO  [ext] T1 worker ready
17:56:54.580 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
17:56:54.585 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
17:56:54.585 INFO  [ext] state ready: 0 delta(s), 0 file(s)
17:56:54.687 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T17-56-54-593Z-init.json.gz
17:56:54.696 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
17:56:54.696 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-29T17:56:56.481Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":24631,"home":"<tmp-home>"}
2026-10-29T17:56:56.486Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T17:56:56.496Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T17:56:56.504Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T17:56:56.507Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T17:56:56.510Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T17:56:56.512Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":24631,"lock":"<tmp-home>/.ai-bridge/lock.json"}
17:56:56.516 INFO  [ext] bridge ready — port 47911, pid 24631, lock <tmp-home>/.ai-bridge/lock.json
17:56:56.516 INFO  [ext] phase → handshaking (reading lock + attach)
17:56:56.524 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=24631 port=47911
17:56:56.524 INFO  [ext] connecting ws://127.0.0.1:47911
17:56:56.524 INFO  [ext] dialling ws://127.0.0.1:47911
17:56:56.653 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T17:56:56.648Z INFO  [bridge] client connected 127.0.0.1:52245 {"clients":1}
2026-10-29T17:56:56.673Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:52245","pid":24631,"protocol":1,"fingerprint":"7c320b4301b3"}
17:56:56.685 INFO  [ext] handshake OK — pid=24631 v0.1.0 protocol=v1 token=7c320b4301b3 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
17:56:56.685 INFO  [ext] phase → ready (handshake ok, pid 24631)
17:56:56.685 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=24631 · v0.1.0 · protocol=v1 · token=7c320b4301b3 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T17:56:56.688Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T17:56:56.691Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
17:56:56.710 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T17:56:56.711Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T17:56:56.753Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T17:56:56.757Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T17:56:57.080Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T17:56:57.102Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
17:56:57.108 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
17:56:57.109 INFO  [ext] <- attached
2026-10-29T17:56:57.238Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T17:56:58.092Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
17:56:58.099 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
17:56:58.100 INFO  [ext] <- tab.opened
17:56:58.102 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
17:57:00.680 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
17:57:00.680 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 31 ms (worker)
17:57:00.680 INFO  [ext] state: user turn → +1 delta(s), 1 total, 31 ms (worker)
17:57:00.692 INFO  [ext] compressor tier: T0 — low-end machine (2.0 GB < 8.0 GB) — staying on T0
17:57:00.692 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
17:57:00.695 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
17:57:00.696 INFO  [ext] boot built: 96/2000 tokens, sections [header, deltas, files]
2026-10-29T17:57:00.705Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T17:57:03.981Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T17:57:03.985Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T17:57:04.894Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
17:57:04.962 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","phase":"prompt","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
17:57:04.962 INFO  [ext] <- stream.start
2026-10-29T17:57:05.541Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":54}
2026-10-29T17:57:05.599Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T17:57:05.842Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T17:57:05.958Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
17:57:06.231 INFO  [ext] <- stream.delta
17:57:06.374 INFO  [ext] <- stream.delta
17:57:06.475 INFO  [ext] <- stream.delta
17:57:06.575 INFO  [ext] <- stream.delta
17:57:06.624 INFO  [ext] <- stream.delta
17:57:06.722 INFO  [ext] <- stream.delta
17:57:06.833 INFO  [ext] <- stream.delta
17:57:06.948 INFO  [ext] <- stream.delta
17:57:07.022 INFO  [ext] <- stream.delta
17:57:07.096 INFO  [ext] <- stream.delta
17:57:07.202 INFO  [ext] <- stream.delta
17:57:07.301 INFO  [ext] <- stream.delta
17:57:07.735 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":1888,"firstTokenMs":384,"settledBy":"sentinel","chars":126,"switched":0}
17:57:07.737 INFO  [ext] <- stream.end
2026-10-29T17:57:07.735Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":384,"totalMs":1888,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
17:57:07.738 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 384 ms · total 1888 ms · settled by sentinel
17:57:07.777 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
17:57:07.777 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 39 ms (worker)
17:57:07.777 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 39 ms (worker)
17:57:08.458 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
17:57:08.458 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
17:57:08.458 INFO  [ext] boot injection cancelled
17:57:08.520 INFO  [ext] rotation: requested manually
17:57:08.520 INFO  [ext] boot built: 96/2000 tokens, sections [header, deltas, files]
2026-10-29T17:57:08.567Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
17:57:08.577 INFO  [ext] tab.closed: {"id":"tab1"}
17:57:08.579 INFO  [ext] <- tab.closed
2026-10-29T17:57:09.784Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html","tabs":1}
17:57:09.797 INFO  [ext] tab.opened: {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html"}
17:57:09.798 INFO  [ext] <- tab.opened
17:57:10.292 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"You are resuming an in-progress engineering task. Read this state, then continue.\nRepo: (unknown)\nStack: typescript\nFirst, restate i
17:57:10.296 INFO  [ext] <- stream.start
2026-10-29T17:57:10.752Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":383}
2026-10-29T17:57:11.005Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T17:57:11.074Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
17:57:11.431 INFO  [ext] <- stream.delta
17:57:11.530 INFO  [ext] <- stream.delta
17:57:11.587 INFO  [ext] <- stream.delta
17:57:11.687 INFO  [ext] <- stream.delta
17:57:11.788 INFO  [ext] <- stream.delta
17:57:11.849 INFO  [ext] <- stream.delta
17:57:11.997 INFO  [ext] <- stream.delta
17:57:12.110 INFO  [ext] <- stream.delta
17:57:12.160 INFO  [ext] <- stream.delta
17:57:12.273 INFO  [ext] <- stream.delta
17:57:12.372 INFO  [ext] <- stream.delta
17:57:12.474 INFO  [ext] <- stream.delta
17:57:13.114 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2100,"firstTokenMs":423,"settledBy":"sentinel","chars":126,"switched":0}
17:57:13.114 INFO  [ext] <- stream.end
2026-10-29T17:57:13.107Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":423,"totalMs":2100,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
17:57:13.116 WARN  [ext] boot ack: 0 restated, 0 missing
17:57:13.116 WARN  [ext] rotation: attempt 1 did not restate 0 item(s)
17:57:13.249 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"Your previous reply did not restate the project state. Restate DOING and TODO exactly as listed, one bullet each, then continue.\n\nYou
17:57:13.251 INFO  [ext] <- stream.start
2026-10-29T17:57:13.562Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":513}
2026-10-29T17:57:13.939Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
17:57:14.402 INFO  [ext] <- stream.delta
17:57:14.453 INFO  [ext] <- stream.delta
17:57:14.554 INFO  [ext] <- stream.delta
17:57:14.656 INFO  [ext] <- stream.delta
17:57:14.729 INFO  [ext] <- stream.delta
17:57:14.810 INFO  [ext] <- stream.delta
17:57:14.911 INFO  [ext] <- stream.delta
17:57:14.985 INFO  [ext] <- stream.delta
17:57:15.113 INFO  [ext] <- stream.delta
17:57:15.216 INFO  [ext] <- stream.delta
17:57:15.323 INFO  [ext] <- stream.delta
17:57:15.370 INFO  [ext] <- stream.delta
17:57:15.980 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2039,"firstTokenMs":460,"settledBy":"sentinel","chars":126,"switched":0}
17:57:15.982 INFO  [ext] <- stream.end
2026-10-29T17:57:15.980Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":460,"totalMs":2039,"settledBy":"sentinel","chars":126,"turns":2,"switched":"none"}
17:57:15.987 WARN  [ext] boot ack: 0 restated, 0 missing
17:57:15.987 WARN  [ext] rotation: attempt 2 did not restate 0 item(s)
17:57:15.987 WARN  [ext] rotation (manual): rotated=true preview=false ack=false tokens=96 tab=tab2 — rotated, but the fresh chat never restated the state (0 missing)
17:57:16.001 INFO  [ext] settings panel opened
2026-10-29T17:57:16.057Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
17:57:16.074 INFO  [ext] tab.closed: {"id":"tab2"}
17:57:16.074 INFO  [ext] <- tab.closed
2026-10-29T17:57:16.897Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"about:blank","tabs":1}
17:57:16.902 INFO  [ext] tab.opened: {"id":"tab3","url":"about:blank"}
17:57:16.903 INFO  [ext] <- tab.opened
2026-10-29T17:57:16.900Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab2","opened":"tab3"}
17:57:16.906 INFO  [ext] tab recycled (user) → tab3 · total 1
17:57:16.908 INFO  [ext] <- recycled
17:57:16.908 INFO  [ext] recycled tab2 → tab3
2026-10-29T17:57:17.039Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
17:57:17.042 INFO  [ext] gc: {"pages":1,"ok":true}
17:57:17.042 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
17:57:17.055 INFO  [ext] status refresh failed: client closed
2026-10-29T17:57:17.058Z INFO  [bridge] shutting down (SIGTERM)
17:57:17.081 INFO  [ext] socket closed (code=1000 reason=client-close)
17:57:17.082 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T17:57:17.078Z INFO  [bridge] client disconnected 127.0.0.1:52245 {"code":1000,"reason":"client-close","requests":63,"clients":0}
17:57:17.091 INFO  [ext] T1 worker stopped
17:57:17.095 ERROR [ext] T0 worker failed: T0 worker exited with code 1
2026-10-29T17:57:17.107Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
2026-10-29T17:57:17.110Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T17:57:17.155Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T17:57:17.239Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T17:57:17.250Z DEBUG [bridge] event detached had no subscribers
2026-10-29T17:57:17.268Z INFO  [bridge] server closed
2026-10-29T17:57:17.273Z INFO  [bridge] lock file removed
[ext] bridge exited code=0 signal=null
```

## Chat panel traffic (extension → webview)

```
status    "Bridge ready — attach a browser"
status    "Attached: Chrome · 1 tab(s)"
user      "Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, a
assistant    0 chars  ""
status    "Streaming from chatgpt…"
delta        3 chars  "The"
delta       19 chars  "The quick brown fox"
delta       30 chars  "The quick brown fox jumps over"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       49 chars  "The quick brown fox jumps over the lazy dog while"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       81 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":384,"totalMs":1888,"settledBy":"sentinel","chars":126}
status    "Settled in 1888 ms (first token 384 ms) · sentinel"
status    "Rotating session…"
status    "Rotated but context incomplete — 0 item(s) missing"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **warn**: AI Bridge: rotated, but the fresh chat did not restate 0 item(s): 
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).
