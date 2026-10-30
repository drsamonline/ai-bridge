# "Any provider" — custom provider adapter (spec §1)

Generated: 2026-10-30T04:19:58.944Z

## Checks

```
PASS  a minimal config is accepted
PASS  a missing composer selector is rejected with a reason
PASS  a non-http url is rejected
PASS  a bad id is rejected
PASS  generic fallbacks fill the roles the user did not supply
PASS  the bridge accepts a valid custom provider
PASS  the bridge rejects an invalid one with a reason
PASS  the custom provider appears in the adapter list
PASS  the custom adapter resolves its configured selectors
PASS  a prompt to a custom provider is answered
PASS  the custom provider is reachable through the router chain
PASS  the custom provider joined the router
```

Result: 12/12 passed.

## The config used

```json
{
  "id": "mychat",
  "label": "My Chat",
  "url": "http://127.0.0.1:PORT/mychat.html",
  "selectors": {
    "composer": {
      "primary": "#ask"
    },
    "send": {
      "primary": "#go"
    }
  }
}
```

Roles not supplied (assistantTurn, markdown, stop, copySentinel, streamingFlag,
limitBanner) fall back to generic guesses; the observer's debounce rule covers a
page with no copy sentinel.
