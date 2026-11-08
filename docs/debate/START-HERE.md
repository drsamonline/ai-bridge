# Start here

Everything you have to do, in order, assuming nothing. Each step says what you
should see before you move on. If a step does not look like that, stop there — the
next step will not work and you will not know why.

Two things to know first, because they explain most of the confusion:

- **There are two Chrome extensions and they are not the same thing.** The one in
  the VS Code Marketplace is the product. The one you load from `shell/extension` is
  a *window* onto the debate engine. You do not need both to start.
- **Chrome 136 will not let a program drive your everyday browser.** Not a bug, not
  our bug — a security change. You need a second, separate Chrome profile for that,
  and you sign into it once. Step 2.

---

## 1. Get it built

```bash
git clone https://github.com/drsamonline/ai-bridge.git
cd ai-bridge
npm install
npm run build
npm run build:bundle
```

**You should see:** `copy-assets: 2 file(s)` from the second, and no red text from
either.

If `npm run build` fails on a type error, run `npm run clean` first and try again. The
build keeps compiled files for source files that no longer exist, and that produces
errors that make no sense.

---

## 2. Make a Chrome you can drive, and sign in once

This is the step everything else waits behind.

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-debug"
```

On macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-debug"
```

On Windows (PowerShell):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\chrome-debug"
```

**Both switches are required.** With the port alone, Chrome opens and nothing listens,
and the only symptom is a refused connection. That is Chrome 136 refusing to debug
your real profile.

In that new window, sign in once to:

- chatgpt.com
- claude.ai
- gemini.google.com

Then leave the window open. Do not copy your normal profile into it — it will not
work, by design. You sign in once here and every later launch on that folder is
already signed in.

**Check it worked:**

```bash
curl http://127.0.0.1:9222/json/version
```

**You should see:** a JSON object with `"Browser"` and `"webSocketDebuggerUrl"`. If
you get "connection refused", Chrome is not running with both switches, or another
Chrome already owns that folder — quit every window on it and start again.

---

## 3. Start the bridge

```bash
npm run bridge
```

**You should see:** `bridge ready` and `served shell: http://127.0.0.1:...?nonce=...`

Leave it running. Everything below talks to this process.

---

## 4. Check the three providers answer

In a terminal:

```bash
# the health of each adapter against the real pages
node -e "
const { BridgeClient } = require('./shared/dist/index.js');
(async () => {
  const c = new BridgeClient();
  await c.connect();
  console.log(JSON.stringify(await c.request({ op: 'ctl.health' }), null, 2));
  c.close();
})();
"
```

**You should see:** one entry per provider with `ready: true` and each selector
`via: "primary"`.

**If a provider is not ready:** that is the selector gate, and it is the one thing
worth sending me. Copy the whole JSON.

---

## 5. Use it in VS Code (the main way)

```bash
code --install-extension ai-bridge-0.48.0.vsix
```

VSCodium: `codium --install-extension ai-bridge-0.48.0.vsix`

Then reload the window. Open the AI Bridge icon in the activity bar — you will see
**two** views:

- **Chat** — the normal multi-provider chat
- **Debate** — the new one

Press `Ctrl+Shift+P` and run **AI Bridge: Diagnose** if anything looks wrong; it
prints a page you can paste to me.

---

## 6. Use it as its own app (no editor)

```bash
npm run debate
```

**You should see:** a window with no tabs and no address bar, listing sessions.
Close the window and the bridge stops.

---

## 7. Use it as a Chrome extension (optional, the third window)

```bash
npm run debate:zip          # builds ai-bridge-debate-chrome.zip
unzip ai-bridge-debate-chrome.zip -d /tmp/debate-shell
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → choose `/tmp/debate-shell`
4. Copy the **ID** shown on the card — 32 letters, a–p

Register the bridge with Chrome, using that ID:

```bash
node scripts/install-native-host.mjs --extension-id <PASTE_THE_ID> --write
```

On Windows it prints a `reg add ...` line — run it. The file alone does nothing there.

Then reload the extension and click its toolbar button. The side panel should list
sessions.

**If the panel says the host disconnected:** the host path in the manifest must be
absolute and must point at `bridge/dist/native-host.js`. Run the installer with
`--host "$(pwd)/bridge/dist/native-host.js"` to be explicit.

---

## 8. The first real debate

From any of the windows in steps 5–7:

1. Pick a **Planner** (chatgpt), an **Auditor** (claude), and **3 debaters**
2. Set the round budget to **3** for the first run — fewer things to go wrong
3. Press **Create**, then **Run**
4. Watch the log pane

**You should see:** sessions moving from `INITIALIZING` to `ACTIVE`, and the round
number climbing. If a provider needs a sign-in, its tab is brought to the front and
you get five minutes to do it.

**You should end with:** `CONSENSUS` or `HANDED_OFF`, and a folder under
`~/.ai-bridge/sessions/<id>/` containing a bundle.

This is the step nobody has done yet. Send me the log pane and the bundle folder
listing, whatever it says.

---

## 9. Release the engine (only after step 8 works)

```bash
git tag debate-v0.1.0
git push origin debate-v0.1.0
```

That fires the engine release and produces `ai-bridge-debate-0.1.0.tar.gz`. The
extension's own release (`v0.48.x`) is separate and unaffected.

---

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `connection refused` on 9222 | Chrome 136 ignored the port | Both switches, and quit every Chrome on that folder first |
| `ENOCDP: nothing listening` | same | same |
| A provider tab shows a login page | the debugging profile signed out | sign in in that window; the engine waits 5 minutes |
| Panel says "missing from this build" | `npm run build` was not run before packaging | run it, then rebuild the `.vsix` |
| Debate view is empty | bridge not running | `npm run bridge` |
| `npm run build` type errors that make no sense | stale compiled files | `npm run clean && npm run build` |

---

## What to send me, in order of usefulness

1. The `ctl.health` JSON from step 4 — this is the one that unblocks real work
2. The log pane from step 8, and the list of files in the bundle folder
3. The Diagnose page from step 5, if the extension misbehaves
