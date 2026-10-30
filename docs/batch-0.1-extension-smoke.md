# Batch 0.1 — extension activation evidence (stubbed VS Code host)

Generated: 2026-10-29T14:13:54.538Z
Node: v20.20.2 · stub host: 1.94.0-stub

## "AI Bridge" Output channel — captured verbatim

```
14:13:52.699 INFO  [ext] AI Bridge v0.1.0 activated — extension path <repo>/extension
14:13:52.701 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
2026-10-29T14:13:52.930Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":284,"home":"<tmp-home>"}
2026-10-29T14:13:52.934Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T14:13:52.968Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T14:13:52.974Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T14:13:52.974Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
AI_BRIDGE_READY {"port":47911,"pid":284,"lock":"<tmp-home>/.ai-bridge/lock.json"}
14:13:52.975 INFO  [ext] bridge ready — port 47911, pid 284, lock <tmp-home>/.ai-bridge/lock.json
14:13:52.976 INFO  [ext] phase → handshaking (reading lock + attach)
14:13:52.977 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=284 port=47911
14:13:52.977 INFO  [ext] connecting ws://127.0.0.1:47911
14:13:52.977 INFO  [ext] dialling ws://127.0.0.1:47911
14:13:52.993 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T14:13:52.991Z INFO  [bridge] client connected 127.0.0.1:56064 {"clients":1}
2026-10-29T14:13:52.997Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:56064","pid":284,"protocol":1,"fingerprint":"c0024215e1dd"}
14:13:53.001 INFO  [ext] handshake OK — pid=284 v0.1.0 protocol=v1 token=c0024215e1dd caps=[attach]
14:13:53.001 INFO  [ext] phase → ready (handshake ok, pid 284)
14:13:53.001 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=284 · v0.1.0 · protocol=v1 · token=c0024215e1dd · caps=[attach]
14:13:53.026 INFO  [ext] phase → handshaking (reading lock + attach)
14:13:53.027 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=284 port=47911
14:13:53.027 INFO  [ext] connecting ws://127.0.0.1:47911
14:13:53.027 INFO  [ext] dialling ws://127.0.0.1:47911
14:13:53.032 INFO  [ext] socket closed (code=1000 reason=client-close)
14:13:53.033 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T14:13:53.031Z INFO  [bridge] client connected 127.0.0.1:42590 {"clients":2}
2026-10-29T14:13:53.035Z INFO  [bridge] client disconnected 127.0.0.1:56064 {"code":1000,"reason":"client-close","requests":1,"clients":1}
2026-10-29T14:13:53.036Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:42590","pid":284,"protocol":1,"fingerprint":"c0024215e1dd"}
14:13:53.037 INFO  [ext] handshake OK — pid=284 v0.1.0 protocol=v1 token=c0024215e1dd caps=[attach]
14:13:53.037 INFO  [ext] phase → ready (handshake ok, pid 284)
14:13:53.037 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=284 · v0.1.0 · protocol=v1 · token=c0024215e1dd · caps=[attach]
[ext] stopping bridge (SIGTERM)
2026-10-29T14:13:53.038Z INFO  [bridge] shutting down (SIGTERM)
14:13:53.041 INFO  [ext] socket closed (code=1001 reason=bridge-shutdown)
14:13:53.041 INFO  [ext] socket closed during shutdown (code 1001)
2026-10-29T14:13:53.041Z INFO  [bridge] server closed
2026-10-29T14:13:53.042Z INFO  [bridge] lock file removed
[ext] bridge exited code=0 signal=null
```

## Status bar / commands

- status bar text after activation: `$(plug) Bridge: ready · 127.0.0.1:47911`
- status bar visible: true
- commands registered: 7
- toasts raised: none
- lock file present at handshake: true
