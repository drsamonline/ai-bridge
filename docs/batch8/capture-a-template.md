# Capturing a provider template

The fast path is machinery without a map: it can call a provider's own endpoint,
replay a request in your tab, and fall back to the DOM adapter — but it needs one
template per provider, and none ships. This is how to make one.

Nothing here is required for the extension to work. Without a template every
provider runs on the DOM rung exactly as it did before batch 9.0.

## 1. Find the request

1. Open the provider's web app in the browser you use for AI Bridge, signed in.
2. DevTools → **Network** → filter **Fetch/XHR** → clear.
3. Send one short message in the app ("hello").
4. Find the request that streams the answer. It is usually the last POST, and its
   response arrives in pieces (`text/event-stream`), or it returns JSON.

If you see no streaming request, the app may use WebSockets — that is not
supported by a template, and the DOM rung is the right answer for that provider.

## 2. Take four things

| Field | Where it comes from |
|---|---|
| `url` | the request URL — the full path, not just the host |
| `method` | almost always `POST` |
| `headers` | only what the endpoint needs *beyond* cookies. Leave auth out |
| `bodyTemplate` | the request body with the message text replaced by `{{prompt}}` |

Copy the body as JSON, then replace the message string with `{{prompt}}`:

```json
{"action":"next","messages":[{"author":{"role":"user"},"content":{"content_type":"text","parts":["{{prompt}}"]}}],"model":"auto"}
```

`{{prompt}}` is escaped for you — quotes, newlines and backslashes in what you
type are safe. A template without `{{prompt}}` is rejected, because it would send
a request with no question in it.

**Do not paste cookies or bearer tokens into `headers`.** The replay runs inside
your signed-in tab and the fast rung is a same-site request; a copied credential
is a credential in your settings file, and it will go stale.

## 3. Register it

```jsonc
// ctl.fastpath.set
{
  "templates": [{
    "providerId": "chatgpt",          // must match the adapter id
    "url": "https://chatgpt.com/backend-api/conversation",
    "method": "POST",
    "bodyTemplate": "{\"action\":\"next\",\"messages\":[{\"content\":{\"parts\":[\"{{prompt}}\"]}}]}",
    "enabled": true                    // off unless you say so
  }]
}
```

It starts disabled by default on purpose: a wrong template costs a round trip on
every prompt, so it should be a decision.

## 4. Watch what happens

```jsonc
// ctl.fastpath.status
{ "templates": [ … ], "rungs": [{ "providerId": "chatgpt", "rung": "fast", "answered": { "fast": 3 }, "fellThrough": { "fast": 1 } }] }
```

- `rung: "fast"` — it worked, and the next prompt skips straight to it.
- `fellThrough.fast` climbing — the endpoint refused (challenge or auth). The
  cascade moved down on its own; you saw one answer, not an error.
- Nothing answers and the DOM rung does — the template is wrong. Delete it or set
  `enabled: false`; the DOM path is unchanged either way.

## What a template does not fix

A provider that signs every request with a device fingerprint or proof-of-work
will keep refusing. That is not a template bug, and the cascade handles it by
staying on the rung that works. Expect some providers to live permanently on
`replay` or `dom` — that is the design, not a failure.
