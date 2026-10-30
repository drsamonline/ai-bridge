# Batch 0.1 — acceptance evidence

Generated: 2026-10-30T04:18:52.817Z
Node: v20.20.2 · platform: linux x64
Harness HOME: <tmp-home> (throwaway directory, deleted after the run)

## Checks

```
PASS  lock dir exists with mode 0700
PASS  lock file exists with mode 0600
PASS  lock shape is valid (v/host/port/token/pid)
PASS  lock mode is world/group inaccessible
PASS  handshake ok
PASS  handshake reports the real bridge pid
PASS  handshake token fingerprint matches lock token
PASS  client state is "connected"
PASS  wrong token is rejected with close code 4001
PASS  non-attach first frame rejected with 4001
PASS  unimplemented op answers ENOTIMPL
PASS  lock file removed on SIGTERM
```

Result: 12/12 passed.

## Extension-side log (the exact lines the "AI Bridge" Output channel shows)

```
INFO  lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=5403 port=47801
INFO  dialling ws://127.0.0.1:47801
INFO  socket open — sending { op: "attach" }
INFO  handshake OK — pid=5403 v0.1.0 protocol=v1 token=4d6716556911 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
INFO  socket closed (code=1000 reason=client-close)
```

## Bridge-side log (piped into the same Output channel)

```
2026-10-30T04:18:52.668Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":5403,"home":"<tmp-home>"}
2026-10-30T04:18:52.687Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-30T04:18:52.694Z INFO  [bridge] listening on ws://127.0.0.1:47801 {"protocol":1,"maxPayload":8388608}
2026-10-30T04:18:52.700Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47801}
2026-10-30T04:18:52.700Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47801","hint":"waiting for { op: \"attach\" }"}
2026-10-30T04:18:52.701Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-30T04:18:52.702Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":500}
AI_BRIDGE_READY {"port":47801,"pid":5403,"lock":"<tmp-home>/.ai-bridge/lock.json"}
2026-10-30T04:18:52.765Z INFO  [bridge] client connected 127.0.0.1:42684 {"clients":1}
2026-10-30T04:18:52.771Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:42684","pid":5403,"protocol":1,"fingerprint":"4d6716556911"}
2026-10-30T04:18:52.788Z INFO  [bridge] client connected 127.0.0.1:49543 {"clients":2}
2026-10-30T04:18:52.789Z WARN  [bridge] rejected client: EAUTH: token mismatch {"code":4001,"reason":"bad-token"}
2026-10-30T04:18:52.794Z INFO  [bridge] client disconnected 127.0.0.1:49543 {"code":4001,"reason":"bad-token","requests":1,"clients":1}
2026-10-30T04:18:52.797Z INFO  [bridge] client connected 127.0.0.1:64455 {"clients":2}
2026-10-30T04:18:52.798Z WARN  [bridge] rejected client: EAUTH: attach required first {"code":4001,"reason":"not-authed"}
2026-10-30T04:18:52.800Z INFO  [bridge] client disconnected 127.0.0.1:64455 {"code":4001,"reason":"not-authed","requests":1,"clients":1}
2026-10-30T04:18:52.804Z INFO  [bridge] shutting down (SIGTERM)
2026-10-30T04:18:52.805Z INFO  [bridge] server closed
2026-10-30T04:18:52.806Z INFO  [bridge] lock file removed
```

## Lock file as written on disk

```json
{
  "v": 1,
  "host": "127.0.0.1",
  "port": 47801,
  "token": "ae05…5c02 (redacted)",
  "pid": 5403,
  "startedAt": 1793333932688,
  "version": "0.1.0",
  "protocol": 1
}
```

Modes: dir 0700 · file 0600
