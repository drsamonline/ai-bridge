/**
 * The A shell's background worker — a relay, and nothing else.
 *
 * It launches the native host (the bridge, in stdio mode) and forwards ctl.* calls
 * from the side panel to it. There is no token here: Chrome launching the host is
 * the authorisation, the same way socket permissions are for the unix socket.
 *
 * One subtlety worth knowing: the host is launched on first use and *stays* for the
 * life of the worker. Chrome may stop an idle worker at any time, which drops the
 * port — so every call reconnects if the port has gone, rather than assuming it.
 */

const HOST = 'com.drsamonline.ai_bridge_debate';

let port = null;
let seq = 0;
const pending = new Map();

function ensurePort() {
  if (port) return port;

  port = chrome.runtime.connectNative(HOST);

  port.onMessage.addListener((msg) => {
    const slot = msg && msg.id != null ? pending.get(msg.id) : null;
    if (!slot) return;
    pending.delete(msg.id);
    msg.error ? slot.reject(new Error(msg.error)) : slot.resolve(msg.result ?? msg);
  });

  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || 'the host disconnected';
    for (const slot of pending.values()) slot.reject(new Error(reason));
    pending.clear();
    port = null;
  });

  return port;
}

function call(op, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    try {
      ensurePort().postMessage({ op, ...args, id });
    } catch (err) {
      pending.delete(id);
      reject(new Error(`${op} could not be sent: ${err.message}`));
      return;
    }
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${op} timed out`));
      }
    }, 30000);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg || msg.type !== 'ai-bridge:call') return false;
  call(msg.op, msg.args)
    .then((result) => respond({ result }))
    .catch((err) => respond({ error: err.message }));
  return true; // keep the channel open for the async reply
});

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});
