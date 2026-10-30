# Batch 4.1 — extension evidence: status bar, panel, repo, state, boot, guard, compressor, settings (stubbed VS Code host)

Generated: 2026-10-29T16:32:31.297Z
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
PASS  the settings panel opens with all six tabs
PASS  the panel is a webview with a nonce and no inline handler leaks
PASS  recycle + gc commands produce Output lines
```

Result: 34/34 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1197/8000 · tok 0/4k · tab 2s
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
16:32:17.198 INFO  [ext] no workspace folder — repo context and edit proposals are off
16:32:17.202 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
16:32:17.313 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
16:32:17.390 INFO  [ext] chat panel resolved
16:32:17.698 INFO  [ext] T0 worker ready
16:32:17.698 INFO  [ext] T0 compressor ready (worker thread), tier=auto, budget=4096 tokens
16:32:17.714 INFO  [ext] T1 off: low-end machine (2.0 GB < 8.0 GB) — staying on T0
16:32:17.923 INFO  [ext] T1 worker ready
16:32:17.968 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
16:32:17.970 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
16:32:17.970 INFO  [ext] state ready: 0 delta(s), 0 file(s)
16:32:17.999 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T16-32-17-972Z-init.json.gz
16:32:18.005 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
16:32:18.005 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-29T16:32:18.990Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":14940,"home":"<tmp-home>"}
2026-10-29T16:32:18.996Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T16:32:19.009Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T16:32:19.020Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T16:32:19.021Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T16:32:19.021Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T16:32:19.022Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":14940,"lock":"<tmp-home>/.ai-bridge/lock.json"}
16:32:19.024 INFO  [ext] bridge ready — port 47911, pid 14940, lock <tmp-home>/.ai-bridge/lock.json
16:32:19.024 INFO  [ext] phase → handshaking (reading lock + attach)
16:32:19.027 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=14940 port=47911
16:32:19.027 INFO  [ext] connecting ws://127.0.0.1:47911
16:32:19.027 INFO  [ext] dialling ws://127.0.0.1:47911
16:32:19.073 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T16:32:19.073Z INFO  [bridge] client connected 127.0.0.1:62940 {"clients":1}
2026-10-29T16:32:19.077Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:62940","pid":14940,"protocol":1,"fingerprint":"30489c963b02"}
16:32:19.081 INFO  [ext] handshake OK — pid=14940 v0.1.0 protocol=v1 token=30489c963b02 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
16:32:19.081 INFO  [ext] phase → ready (handshake ok, pid 14940)
16:32:19.081 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=14940 · v0.1.0 · protocol=v1 · token=30489c963b02 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T16:32:19.082Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T16:32:19.083Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
16:32:19.085 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T16:32:19.087Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T16:32:19.101Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T16:32:19.102Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T16:32:19.242Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T16:32:19.274Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
16:32:19.275 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
16:32:19.275 INFO  [ext] <- attached
2026-10-29T16:32:19.660Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T16:32:19.676Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
16:32:19.681 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
16:32:19.682 INFO  [ext] <- tab.opened
16:32:19.694 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
16:32:22.220 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
16:32:22.220 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 8 ms (worker)
16:32:22.220 INFO  [ext] state: user turn → +1 delta(s), 1 total, 8 ms (worker)
16:32:22.227 INFO  [ext] compressor tier: T0 — low-end machine (2.0 GB < 8.0 GB) — staying on T0
16:32:22.227 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
16:32:22.227 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
2026-10-29T16:32:22.229Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T16:32:25.347Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T16:32:25.348Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T16:32:25.612Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
16:32:25.684 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
16:32:25.684 INFO  [ext] <- stream.start
2026-10-29T16:32:25.890Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":54}
2026-10-29T16:32:25.901Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T16:32:26.071Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T16:32:26.110Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
16:32:26.515 INFO  [ext] <- stream.delta
16:32:26.568 INFO  [ext] <- stream.delta
16:32:26.618 INFO  [ext] <- stream.delta
16:32:26.669 INFO  [ext] <- stream.delta
16:32:26.769 INFO  [ext] <- stream.delta
16:32:26.869 INFO  [ext] <- stream.delta
16:32:26.971 INFO  [ext] <- stream.delta
16:32:27.072 INFO  [ext] <- stream.delta
16:32:27.122 INFO  [ext] <- stream.delta
16:32:27.225 INFO  [ext] <- stream.delta
16:32:27.325 INFO  [ext] <- stream.delta
16:32:27.425 INFO  [ext] <- stream.delta
16:32:27.526 INFO  [ext] <- stream.delta
16:32:28.119 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":2046,"firstTokenMs":441,"settledBy":"sentinel","chars":126}
16:32:28.119 INFO  [ext] <- stream.end
2026-10-29T16:32:28.118Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":441,"totalMs":2046,"settledBy":"sentinel","chars":126,"turns":1}
16:32:28.119 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 441 ms · total 2046 ms · settled by sentinel
16:32:28.125 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
16:32:28.125 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 6 ms (worker)
16:32:28.125 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 6 ms (worker)
16:32:28.804 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
16:32:28.804 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
16:32:28.804 INFO  [ext] boot injection cancelled
16:32:28.807 INFO  [ext] settings panel opened
2026-10-29T16:32:28.818Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
16:32:28.820 INFO  [ext] tab.closed: {"id":"tab1"}
16:32:28.820 INFO  [ext] <- tab.closed
16:32:29.181 INFO  [ext] tab.opened: {"id":"tab2","url":"about:blank"}
16:32:29.181 INFO  [ext] <- tab.opened
16:32:29.181 INFO  [ext] tab recycled (user) → tab2 · total 1
16:32:29.182 INFO  [ext] <- recycled
16:32:29.182 INFO  [ext] recycled tab1 → tab2
2026-10-29T16:32:29.178Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"about:blank","tabs":1}
2026-10-29T16:32:29.179Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab1","opened":"tab2"}
2026-10-29T16:32:29.278Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
16:32:29.279 INFO  [ext] gc: {"pages":1,"ok":true}
16:32:29.279 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
16:32:29.282 INFO  [ext] status refresh failed: client closed
16:32:29.286 INFO  [ext] socket closed (code=1000 reason=client-close)
16:32:29.286 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T16:32:29.285Z INFO  [bridge] shutting down (SIGTERM)
2026-10-29T16:32:29.287Z INFO  [bridge] client disconnected 127.0.0.1:62940 {"code":1000,"reason":"client-close","requests":27,"clients":0}
2026-10-29T16:32:29.302Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
2026-10-29T16:32:29.303Z DEBUG [bridge] event tab.closed had no subscribers
16:32:29.309 INFO  [ext] T1 worker stopped
16:32:29.309 ERROR [ext] T0 worker failed: T0 worker exited with code 1
2026-10-29T16:32:29.369Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T16:32:29.382Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T16:32:29.383Z DEBUG [bridge] event detached had no subscribers
2026-10-29T16:32:29.385Z INFO  [bridge] server closed
2026-10-29T16:32:29.386Z INFO  [bridge] lock file removed
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
done      {"firstTokenMs":441,"totalMs":2046,"settledBy":"sentinel","chars":126}
status    "Settled in 2046 ms (first token 441 ms) · sentinel"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).
