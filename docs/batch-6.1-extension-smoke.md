# Batch 6.1 — extension evidence: status bar, panel, repo, state, boot, guard, compressor, settings, rotation, router (stubbed VS Code host)

Generated: 2026-10-29T17:23:52.996Z
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

Result: 36/36 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1174/8000 · tok 0/4k · tab 2s
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
17:23:31.541 INFO  [ext] no workspace folder — repo context and edit proposals are off
17:23:31.565 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
17:23:31.650 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
17:23:31.811 INFO  [ext] chat panel resolved
17:23:32.127 INFO  [ext] T0 worker ready
17:23:32.127 INFO  [ext] T0 compressor ready (worker thread), tier=auto, budget=4096 tokens
17:23:32.145 INFO  [ext] T1 off: low-end machine (2.0 GB < 8.0 GB) — staying on T0
17:23:32.289 INFO  [ext] T1 worker ready
17:23:32.297 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
17:23:32.304 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
17:23:32.305 INFO  [ext] state ready: 0 delta(s), 0 file(s)
17:23:32.377 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T17-23-32-307Z-init.json.gz
17:23:32.392 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
17:23:32.392 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-29T17:23:33.805Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":20994,"home":"<tmp-home>"}
2026-10-29T17:23:33.808Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T17:23:33.818Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T17:23:33.825Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T17:23:33.826Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T17:23:33.827Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T17:23:33.829Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":20994,"lock":"<tmp-home>/.ai-bridge/lock.json"}
17:23:33.830 INFO  [ext] bridge ready — port 47911, pid 20994, lock <tmp-home>/.ai-bridge/lock.json
17:23:33.831 INFO  [ext] phase → handshaking (reading lock + attach)
17:23:33.838 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=20994 port=47911
17:23:33.838 INFO  [ext] connecting ws://127.0.0.1:47911
17:23:33.838 INFO  [ext] dialling ws://127.0.0.1:47911
17:23:33.910 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T17:23:33.909Z INFO  [bridge] client connected 127.0.0.1:17281 {"clients":1}
2026-10-29T17:23:33.919Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:17281","pid":20994,"protocol":1,"fingerprint":"28931f27ad71"}
17:23:33.925 INFO  [ext] handshake OK — pid=20994 v0.1.0 protocol=v1 token=28931f27ad71 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
17:23:33.925 INFO  [ext] phase → ready (handshake ok, pid 20994)
17:23:33.926 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=20994 · v0.1.0 · protocol=v1 · token=28931f27ad71 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T17:23:33.928Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T17:23:33.929Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
17:23:33.933 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T17:23:33.934Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T17:23:33.956Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T17:23:33.957Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T17:23:34.281Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T17:23:34.297Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
17:23:34.300 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
17:23:34.300 INFO  [ext] <- attached
2026-10-29T17:23:34.466Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T17:23:34.826Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
17:23:34.829 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
17:23:34.830 INFO  [ext] <- tab.opened
17:23:34.833 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
17:23:37.448 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
17:23:37.448 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 43 ms (worker)
17:23:37.448 INFO  [ext] state: user turn → +1 delta(s), 1 total, 43 ms (worker)
17:23:37.469 INFO  [ext] compressor tier: T0 — low-end machine (2.0 GB < 8.0 GB) — staying on T0
17:23:37.469 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
17:23:37.471 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
17:23:37.475 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
2026-10-29T17:23:37.485Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T17:23:40.629Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T17:23:40.630Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T17:23:41.241Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
17:23:41.291 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","phase":"prompt","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
17:23:41.295 INFO  [ext] <- stream.start
2026-10-29T17:23:41.642Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":54}
2026-10-29T17:23:41.667Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T17:23:41.841Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T17:23:41.918Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
17:23:42.275 INFO  [ext] <- stream.delta
17:23:42.378 INFO  [ext] <- stream.delta
17:23:42.439 INFO  [ext] <- stream.delta
17:23:42.579 INFO  [ext] <- stream.delta
17:23:42.679 INFO  [ext] <- stream.delta
17:23:42.734 INFO  [ext] <- stream.delta
17:23:42.832 INFO  [ext] <- stream.delta
17:23:42.933 INFO  [ext] <- stream.delta
17:23:43.034 INFO  [ext] <- stream.delta
17:23:43.135 INFO  [ext] <- stream.delta
17:23:43.285 INFO  [ext] <- stream.delta
17:23:43.693 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":1850,"firstTokenMs":432,"settledBy":"sentinel","chars":126,"switched":0}
17:23:43.694 INFO  [ext] <- stream.end
2026-10-29T17:23:43.693Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":432,"totalMs":1850,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
17:23:43.695 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 432 ms · total 1850 ms · settled by sentinel
17:23:43.721 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
17:23:43.721 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 26 ms (worker)
17:23:43.721 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 26 ms (worker)
17:23:44.333 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
17:23:44.333 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
17:23:44.334 INFO  [ext] boot injection cancelled
17:23:44.401 INFO  [ext] rotation: requested manually
17:23:44.401 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
2026-10-29T17:23:44.425Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
17:23:44.431 INFO  [ext] tab.closed: {"id":"tab1"}
17:23:44.431 INFO  [ext] <- tab.closed
2026-10-29T17:23:45.073Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html","tabs":1}
17:23:45.076 INFO  [ext] tab.opened: {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html"}
17:23:45.076 INFO  [ext] <- tab.opened
17:23:45.331 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"You are resuming an in-progress engineering task. Read this state, then continue.\nRepo: (unknown)\nStack: typescript\nFirst, restate i
17:23:45.334 INFO  [ext] <- stream.start
2026-10-29T17:23:45.570Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":383}
2026-10-29T17:23:45.695Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T17:23:45.780Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
17:23:46.186 INFO  [ext] <- stream.delta
17:23:46.241 INFO  [ext] <- stream.delta
17:23:46.340 INFO  [ext] <- stream.delta
17:23:46.443 INFO  [ext] <- stream.delta
17:23:46.541 INFO  [ext] <- stream.delta
17:23:46.647 INFO  [ext] <- stream.delta
17:23:46.697 INFO  [ext] <- stream.delta
17:23:46.797 INFO  [ext] <- stream.delta
17:23:46.899 INFO  [ext] <- stream.delta
17:23:47.000 INFO  [ext] <- stream.delta
17:23:47.101 INFO  [ext] <- stream.delta
17:23:47.202 INFO  [ext] <- stream.delta
17:23:47.792 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2095,"firstTokenMs":490,"settledBy":"sentinel","chars":126,"switched":0}
17:23:47.792 INFO  [ext] <- stream.end
2026-10-29T17:23:47.792Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":490,"totalMs":2095,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
17:23:47.795 WARN  [ext] boot ack: 0 restated, 0 missing
17:23:47.795 WARN  [ext] rotation: attempt 1 did not restate 0 item(s)
17:23:47.899 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"Your previous reply did not restate the project state. Restate DOING and TODO exactly as listed, one bullet each, then continue.\n\nYou
17:23:47.899 INFO  [ext] <- stream.start
2026-10-29T17:23:48.144Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":513}
2026-10-29T17:23:48.362Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
17:23:48.827 INFO  [ext] <- stream.delta
17:23:48.883 INFO  [ext] <- stream.delta
17:23:48.974 INFO  [ext] <- stream.delta
17:23:49.076 INFO  [ext] <- stream.delta
17:23:49.178 INFO  [ext] <- stream.delta
17:23:49.281 INFO  [ext] <- stream.delta
17:23:49.369 INFO  [ext] <- stream.delta
17:23:49.482 INFO  [ext] <- stream.delta
17:23:49.533 INFO  [ext] <- stream.delta
17:23:49.627 INFO  [ext] <- stream.delta
17:23:49.739 INFO  [ext] <- stream.delta
17:23:49.840 INFO  [ext] <- stream.delta
17:23:50.381 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2017,"firstTokenMs":457,"settledBy":"sentinel","chars":126,"switched":0}
17:23:50.381 INFO  [ext] <- stream.end
2026-10-29T17:23:50.381Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":457,"totalMs":2017,"settledBy":"sentinel","chars":126,"turns":2,"switched":"none"}
17:23:50.384 WARN  [ext] boot ack: 0 restated, 0 missing
17:23:50.384 WARN  [ext] rotation: attempt 2 did not restate 0 item(s)
17:23:50.384 WARN  [ext] rotation (manual): rotated=true preview=false ack=false tokens=96 tab=tab2 — rotated, but the fresh chat never restated the state (0 missing)
17:23:50.388 INFO  [ext] settings panel opened
2026-10-29T17:23:50.400Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
17:23:50.403 INFO  [ext] tab.closed: {"id":"tab2"}
17:23:50.403 INFO  [ext] <- tab.closed
2026-10-29T17:23:50.822Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"about:blank","tabs":1}
17:23:50.824 INFO  [ext] tab.opened: {"id":"tab3","url":"about:blank"}
17:23:50.827 INFO  [ext] <- tab.opened
17:23:50.829 INFO  [ext] tab recycled (user) → tab3 · total 1
17:23:50.829 INFO  [ext] <- recycled
17:23:50.830 INFO  [ext] recycled tab2 → tab3
2026-10-29T17:23:50.824Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab2","opened":"tab3"}
2026-10-29T17:23:50.928Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
17:23:50.931 INFO  [ext] gc: {"pages":1,"ok":true}
17:23:50.932 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
17:23:50.941 INFO  [ext] status refresh failed: client closed
2026-10-29T17:23:50.952Z INFO  [bridge] shutting down (SIGTERM)
17:23:50.962 INFO  [ext] socket closed (code=1000 reason=client-close)
17:23:50.962 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T17:23:50.963Z INFO  [bridge] client disconnected 127.0.0.1:17281 {"code":1000,"reason":"client-close","requests":62,"clients":0}
17:23:50.991 INFO  [ext] T1 worker stopped
17:23:50.992 ERROR [ext] T0 worker failed: T0 worker exited with code 1
2026-10-29T17:23:50.998Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
2026-10-29T17:23:51.001Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T17:23:51.012Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T17:23:51.039Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T17:23:51.040Z DEBUG [bridge] event detached had no subscribers
2026-10-29T17:23:51.043Z INFO  [bridge] server closed
2026-10-29T17:23:51.047Z INFO  [bridge] lock file removed
[ext] bridge exited code=0 signal=null
```

## Chat panel traffic (extension → webview)

```
status    "Bridge ready — attach a browser"
status    "Attached: Chrome · 1 tab(s)"
user      "Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, a
assistant    0 chars  ""
status    "Streaming from chatgpt…"
delta        9 chars  "The quick"
delta       19 chars  "The quick brown fox"
delta       25 chars  "The quick brown fox jumps"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       49 chars  "The quick brown fox jumps over the lazy dog while"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       81 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":432,"totalMs":1850,"settledBy":"sentinel","chars":126}
status    "Settled in 1850 ms (first token 432 ms) · sentinel"
status    "Rotating session…"
status    "Rotated but context incomplete — 0 item(s) missing"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **warn**: AI Bridge: rotated, but the fresh chat did not restate 0 item(s): 
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).
