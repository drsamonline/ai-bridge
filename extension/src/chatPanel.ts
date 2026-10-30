/**
 * Chat panel — spec §6 (Chat Panel row) and §5.4's streaming surface.
 *
 * Virtual-scrolled message list: only the rows intersecting the viewport (plus
 * overscan) exist in the DOM, positioned absolutely inside a spacer sized to the
 * full scroll height. Heights are measured once and cached, so 10k messages cost
 * the same as 10.
 *
 * Everything the panel shows comes from the extension host; the panel never
 * talks to the bridge itself.
 */

import * as vscode from 'vscode';

export interface PanelMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  streaming?: boolean;
  meta?: { firstTokenMs: number | null; totalMs: number; settledBy: string; chars: number };
}

export interface ProposalHunkData {
  key: string;
  path: string;
  index: number;
  added: number;
  removed: number;
  preview: string;
}

export interface ProposalCardData {
  summary: string;
  /** §6: accept/reject per hunk. */
  hunks?: ProposalHunkData[];
  canApply: boolean;
  files: Array<{ path: string; status: string; added: number; removed: number; reason?: string }>;
  refusals: Array<{ path: string; reason: string }>;
  /** Locked decisions that held this proposal (§5.8 banner + approval flow). */
  held?: Array<{ path: string; decisionId: string; what: string }>;
  waived?: string[];
}

export type ToPanel =
  | {
      type: 'user';
      id: string;
      text: string;
      /** What was actually sent, when T0 changed it (§5.6 preview). */
      compressed?: { text: string; percent: number; tokensBefore: number; tokensAfter: number };
    }
  | { type: 'assistant'; id: string; text: string; streaming: boolean }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string; meta: PanelMessage['meta'] }
  | { type: 'error'; id: string; text: string }
  | { type: 'status'; text: string }
  /** §6: the failover marker on a message that came from a different provider. */
  | { type: 'marker'; id: string; provider?: string; text?: string }
  | { type: 'proposal'; id: string; card: ProposalCardData }
  | { type: 'proposal.result'; id: string; ok: boolean; text: string }
  | { type: 'reset' };

export type FromPanel =
  | { type: 'send'; text: string }
  | { type: 'clear' }
  | { type: 'ready' }
  | {
      type: 'proposal.action';
      id: string;
      action: 'accept' | 'reject' | 'diff' | 'approve';
      /** §6 per-hunk accept: omitted means every hunk. */
      hunks?: string[];
      decisionId?: string;
    };

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'aiBridge.chatView';

  private view: vscode.WebviewView | null = null;
  private pending: ToPanel[] = [];
  private handler: (msg: FromPanel) => void = () => undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: (level: 'info' | 'warn' | 'error', text: string) => void,
  ) {}

  onMessage(handler: (msg: FromPanel) => void): void {
    this.handler = handler;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: FromPanel) => {
      if (msg?.type === 'ready') {
        // Replay anything that arrived before the view existed.
        for (const m of this.pending) void view.webview.postMessage(m);
        this.pending = [];
        return;
      }
      this.handler(msg);
    });
    this.log('info', 'chat panel resolved');
  }

  /** Post to the webview, buffering until it exists (retainContextWhenHidden helps, but not at startup). */
  post(msg: ToPanel): void {
    if (!this.view) {
      this.pending.push(msg);
      if (this.pending.length > 500) this.pending.shift();
      return;
    }
    void this.view.webview.postMessage(msg);
  }

  reveal(): void {
    void vscode.commands.executeCommand(`${ChatPanelProvider.viewType}.focus`);
  }

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  private html(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 24 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62)),
    ).join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  :root { --gap: 10px; --pad: 10px; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column;
    font: 13px/1.45 var(--vscode-font-family); color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  header {
    display: flex; align-items: center; gap: 8px; padding: 8px var(--pad);
    border-bottom: 1px solid var(--vscode-panel-border); flex: 0 0 auto;
  }
  header .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-charts-red); }
  header .dot.ok { background: var(--vscode-charts-green); }
  header .dot.busy { background: var(--vscode-charts-yellow); }
  #status { flex: 1; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #viewport { position: relative; flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; contain: strict; }
  #spacer { position: relative; width: 100%; }
  .msg {
    position: absolute; left: var(--pad); right: var(--pad);
    padding: 8px 10px; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .msg.user { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  .msg.assistant { background: var(--vscode-editorWidget-background); }
  .msg.system { opacity: .75; font-style: italic; }
  .msg.error { border-left: 3px solid var(--vscode-charts-red); }
  .msg .who { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; opacity: .55; margin-bottom: 3px; }
  .msg .meta { font-size: 10px; opacity: .55; margin-top: 5px; }
  .msg .marker {
    display: inline-block; font-size: 10px; margin-top: 5px; padding: 1px 7px; border-radius: 9px;
    background: var(--vscode-inputValidation-warningBackground, rgba(255,200,0,.15));
    color: var(--vscode-foreground);
  }
  .msg .compress { font-size: 10px; opacity: .7; margin-top: 5px; }
  .msg .compress button {
    background: none; border: 0; padding: 0; margin-left: 6px; cursor: pointer;
    color: var(--vscode-textLink-foreground); font: inherit; text-decoration: underline;
  }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; margin-top: 4px; }
  .card .card-head { font-weight: 600; margin-bottom: 6px; }
  .card ul { margin: 0 0 8px; padding-left: 16px; }
  .card li { margin: 2px 0; }
  .card .refused { color: var(--vscode-charts-red); }
  .card .held {
    margin: 6px 0; padding: 6px 8px; border-radius: 4px;
    border-left: 3px solid var(--vscode-charts-yellow);
    background: var(--vscode-inputValidation-warningBackground, rgba(255,180,0,.08));
    font-size: 12px;
  }
  .card .held strong { display: block; margin-bottom: 2px; }
  .card .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .card .outcome { margin-top: 6px; font-size: 11px; opacity: .8; }
  .cursor::after { content: "▍"; animation: blink 1s steps(2) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  form { flex: 0 0 auto; display: flex; gap: 6px; padding: var(--pad); border-top: 1px solid var(--vscode-panel-border); }
  textarea {
    flex: 1; resize: none; min-height: 52px; max-height: 180px; padding: 7px 8px;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; font: inherit;
  }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  button {
    padding: 0 12px; border: 0; border-radius: 6px; cursor: pointer; font: inherit;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  button:disabled { opacity: .5; cursor: default; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
  <header>
    <span class="dot" id="dot" aria-hidden="true"></span>
    <span id="status" role="status" aria-live="polite">Not attached</span>
    <button class="secondary" id="clear" title="Clear conversation">Clear</button>
  </header>
  <div id="viewport" tabindex="0" role="log" aria-label="Conversation">
    <div id="spacer"></div>
  </div>
  <form id="composer">
    <textarea id="input" placeholder="Ask the page… (Enter to send, Shift+Enter for newline)" aria-label="Prompt"></textarea>
    <button id="send" type="submit">Send</button>
  </form>

<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const viewport = document.getElementById('viewport');
  const spacer = document.getElementById('spacer');
  const statusEl = document.getElementById('status');
  const dot = document.getElementById('dot');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const clearBtn = document.getElementById('clear');

  const GAP = 10, PAD = 10, OVERSCAN = 600, ESTIMATE = 64;
  /** @type {{id:string,role:string,text:string,streaming:boolean,meta:any,error?:boolean}[]} */
  let msgs = [];
  const heights = new Map();
  let rendered = new Map(); // id -> element currently in the DOM
  let rafPending = false;

  const estimate = (m) => heights.get(m.id) || (m.role === 'user' ? 52 : ESTIMATE);

  function layout() {
    let y = 0;
    const offsets = new Map();
    for (const m of msgs) {
      offsets.set(m.id, y);
      y += estimate(m) + GAP;
    }
    spacer.style.height = Math.max(0, y) + 'px';
    return offsets;
  }

  function cardEl(m) {
    const card = document.createElement('div');
    card.className = 'card';

    const head = document.createElement('div');
    head.className = 'card-head';
    head.textContent = 'Proposed change \u00b7 ' + m.card.summary;
    card.appendChild(head);

    const list = document.createElement('ul');
    for (const f of m.card.files) {
      const li = document.createElement('li');
      const refused = f.status === 'refused';
      li.className = refused ? 'refused' : '';
      li.textContent =
        f.path + '  ' + (refused ? 'refused' : f.status === 'create' ? 'new file' : '+' + f.added + ' \u2212' + f.removed) +
        (f.reason ? ' \u2014 ' + f.reason : '');
      list.appendChild(li);
    }
    card.appendChild(list);

    // §6 Diff View: accept/reject per hunk.
    if (m.card.hunks && m.card.hunks.length > 0) {
      const hunks = document.createElement('ul');
      hunks.className = 'hunks';
      m.card.hunks.forEach(function (h) {
        const li = document.createElement('li');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.dataset.hunk = h.key;
        const label = document.createElement('span');
        label.textContent = h.path + ' +' + h.added + ' \u2212' + h.removed;
        const pv = document.createElement('span');
        pv.className = 'p';
        pv.textContent = h.preview;
        li.append(cb, label, pv);
        hunks.appendChild(li);
      });
      card.appendChild(hunks);
    }

    const held = m.card.held || [];
    if (held.length && !m.outcome) {
      const banner = document.createElement('div');
      banner.className = 'held';
      const title = document.createElement('strong');
      title.textContent = '\u26a0\ufe0f Held by a locked decision';
      banner.appendChild(title);
      for (const h of held) {
        const line = document.createElement('div');
        line.textContent = h.path + ' \u2014 "' + h.what + '"';
        banner.appendChild(line);
      }
      card.appendChild(banner);
    }

    if (m.outcome) {
      const out = document.createElement('div');
      out.className = 'outcome';
      out.textContent = m.outcome;
      card.appendChild(out);
    }

    if (m.outcome) return card;

    const actions = document.createElement('div');
    actions.className = 'actions';
    const mk = (act, label, secondary) => {
      const b = document.createElement('button');
      b.dataset.act = act;
      b.dataset.pid = m.id;
      b.textContent = label;
      b.className = secondary ? 'secondary' : 'act';
      return b;
    };
    actions.appendChild(mk('diff', 'Review diff', true));
    if (m.card.canApply) actions.appendChild(mk('accept', 'Accept'));
    for (const h of held) {
      if ((m.card.waived || []).includes(h.decisionId)) continue;
      const btn = mk('approve', 'Approve override', true);
      btn.dataset.decision = h.decisionId;
      btn.title = 'Override "' + h.what + '" for ' + h.path;
      actions.appendChild(btn);
    }
    actions.appendChild(mk('reject', 'Reject', true));
    card.appendChild(actions);

    return card;
  }

  function messageEl(m) {
    const el = document.createElement('div');
    el.className = 'msg ' + m.role + (m.error ? ' error' : '') + (m.card ? ' proposal' : '');
    el.dataset.id = m.id;
    if (m.card) {
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = 'Bridge';
      el.append(who, cardEl(m));
      return el;
    }
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Assistant' : 'Bridge';
    const body = document.createElement('div');
    body.className = 'body' + (m.streaming ? ' cursor' : '');
    body.textContent = m.compressed && !m.showOriginal ? m.compressed.text : m.text;
    el.append(who, body);
    if (m.marker) {
      const badge = document.createElement('span');
      badge.className = 'marker';
      badge.textContent = m.marker;
      el.appendChild(badge);
    }
    if (m.compressed) {
      const foot = document.createElement('div');
      foot.className = 'compress';
      foot.textContent =
        '⇣' + m.compressed.percent + '% (' + m.compressed.tokensBefore + '→' + m.compressed.tokensAfter + ' tokens)';
      const toggle = document.createElement('button');
      toggle.dataset.toggle = m.id;
      toggle.textContent = m.showOriginal ? 'show sent' : 'show original';
      foot.appendChild(toggle);
      el.appendChild(foot);
    }
    if (m.meta) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      const first = m.meta.firstTokenMs != null ? m.meta.firstTokenMs + ' ms to first token · ' : '';
      var bits = [first + m.meta.totalMs + ' ms total', m.meta.settledBy];
      if (typeof m.meta.chars === 'number') bits.push(m.meta.chars + ' chars');
      meta.textContent = bits.join(' · ');
      el.appendChild(meta);
    }
    return el;
  }

  function render(force) {
    const offsets = layout();
    const top = viewport.scrollTop - OVERSCAN;
    const bottom = viewport.scrollTop + viewport.clientHeight + OVERSCAN;

    const wanted = new Set();
    for (const m of msgs) {
      const y = offsets.get(m.id);
      const h = estimate(m);
      if (y + h >= top && y <= bottom) wanted.add(m.id);
    }

    // Drop rows that scrolled out of the window — this is the whole point.
    for (const [id, el] of rendered) {
      if (!wanted.has(id)) {
        el.remove();
        rendered.delete(id);
      }
    }

    let changed = false;
    for (const m of msgs) {
      if (!wanted.has(m.id)) continue;
      const y = offsets.get(m.id);
      let el = rendered.get(m.id);
      const stale = el && el.dataset.sig !== signature(m);
      if (!el || stale) {
        if (el) el.remove();
        el = messageEl(m);
        el.dataset.sig = signature(m);
        el.style.transform = 'translateY(' + y + 'px)';
        spacer.appendChild(el);
        rendered.set(m.id, el);
      } else {
        el.style.transform = 'translateY(' + y + 'px)';
      }
      // Measure after paint; a correction triggers one more layout pass.
      const measured = el.getBoundingClientRect().height;
      const prev = heights.get(m.id);
      if (measured > 0 && (prev == null || Math.abs(prev - measured) > 1)) {
        heights.set(m.id, measured);
        changed = true;
      }
    }
    if (changed && !force) schedule();
  }

  function signature(m) {
    return (
      m.role + '|' + m.streaming + '|' + (m.error ? 1 : 0) + '|' + (m.meta ? 1 : 0) + '|' + m.text.length +
      '|' + (m.marker || '') +
      '|' + (m.card ? m.card.summary + (m.outcome || '') : '') +
      '|' + (m.compressed ? 'c' + m.compressed.percent : '') + '|' + (m.showOriginal ? 'o' : 's')
    );
  }

  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render(false);
    });
  }

  function atBottom() {
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40;
  }
  function toBottom() {
    viewport.scrollTop = viewport.scrollHeight;
  }

  const find = (id) => msgs.find((m) => m.id === id);

  window.addEventListener('message', (event) => {
    const msg = event.data;
    const stick = atBottom();
    if (msg.type === 'user') {
      msgs.push({
        id: msg.id,
        role: 'user',
        text: msg.text,
        streaming: false,
        ...(msg.compressed ? { compressed: msg.compressed } : {}),
      });
    } else if (msg.type === 'assistant') {
      msgs.push({ id: msg.id, role: 'assistant', text: msg.text, streaming: !!msg.streaming });
    } else if (msg.type === 'delta') {
      const m = find(msg.id);
      if (m) {
        m.text = msg.text;
        m.streaming = true;
      }
    } else if (msg.type === 'done') {
      const m = find(msg.id);
      if (m) {
        m.streaming = false;
        m.meta = msg.meta;
      }
    } else if (msg.type === 'error') {
      const m = find(msg.id);
      if (m) {
        m.streaming = false;
        m.error = true;
        m.text = m.text ? m.text + '\\n\\n' + msg.text : msg.text;
      } else {
        msgs.push({ id: 'err' + Date.now(), role: 'system', text: msg.text, streaming: false, error: true });
      }
    } else if (msg.type === 'proposal') {
      msgs.push({ id: msg.id, role: 'system', text: '', streaming: false, card: msg.card });
    } else if (msg.type === 'proposal.result') {
      const m = find(msg.id);
      if (m) {
        m.card = m.card || { summary: '', files: [], refusals: [] };
        m.outcome = msg.text;
        m.error = !msg.ok;
      }
    } else if (msg.type === 'marker') {
      const target = find(msg.id);
      if (target) {
        target.marker = msg.text || (msg.provider ? 'via ' + msg.provider : '');
        schedule();
      }
    } else if (msg.type === 'status') {
      statusEl.textContent = msg.text;
      dot.className = 'dot' + (msg.state ? ' ' + msg.state : '');
    } else if (msg.type === 'reset') {
      msgs = [];
      heights.clear();
      for (const [, el] of rendered) el.remove();
      rendered.clear();
    }
    schedule();
    if (stick) requestAnimationFrame(toBottom);
  });

  spacer.addEventListener('click', (e) => {
    const toggle = e.target && e.target.closest ? e.target.closest('button[data-toggle]') : null;
    if (toggle) {
      const m = find(toggle.dataset.toggle);
      if (m) {
        m.showOriginal = !m.showOriginal;
        schedule();
      }
      return;
    }
    const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) return;
    // §6: Accept carries the ticked hunks; omitted means "all of them".
    let hunks;
    if (btn.dataset.act === 'accept') {
      const card = btn.closest('.card');
      const boxes = card ? [...card.querySelectorAll('input[data-hunk]')] : [];
      const checked = boxes.filter((b) => b.checked).map((b) => b.dataset.hunk);
      if (boxes.length > 0 && checked.length !== boxes.length) hunks = checked;
    }
    vscode.postMessage({
      type: 'proposal.action',
      id: btn.dataset.pid,
      action: btn.dataset.act,
      decisionId: btn.dataset.decision,
      ...(hunks ? { hunks } : {}),
    });
  });

  viewport.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', () => {
    heights.clear();
    schedule();
  });

  document.getElementById('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    vscode.postMessage({ type: 'send', text });
    input.value = '';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('composer').requestSubmit();
    }
  });

  clearBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'clear' });
    msgs = [];
    heights.clear();
    for (const [, el] of rendered) el.remove();
    rendered.clear();
    schedule();
  });

  // Expose a tiny hook so the extension's smoke test can assert on the rendered
  // window without scraping the DOM.
  window.__aiBridgePanel = {
    stats: () => ({ total: msgs.length, rendered: rendered.size, scrollHeight: spacer.style.height }),
    text: () => msgs.map((m) => m.role + ': ' + m.text).join('\\n---\\n'),
    compressFooter: () =>
      [...document.querySelectorAll('.msg .compress')].map((f) => f.textContent || ''),
    cards: () =>
      [...document.querySelectorAll('.card')].map((c) => ({
        head: c.querySelector('.card-head')?.textContent || '',
        rows: [...c.querySelectorAll('li')].map((li) => li.textContent),
        buttons: [...c.querySelectorAll('button[data-act]')].map((b) => b.dataset.act),
      })),
  };

  vscode.postMessage({ type: 'ready' });
  schedule();
})();
</script>
</body>
</html>`;
  }
}
