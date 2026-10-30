/**
 * Settings panel HTML — spec §5.12.
 *
 * The markup is generated from `FIELDS`, so the panel can never drift from the
 * model. All validation happens in the host (cmd-response), which replies with
 * an inline error; the webview only renders what it is told.
 *
 * Written with string concatenation inside the webview script: this whole file is
 * a TypeScript template literal, and nested backticks would break it.
 */

import { FIELDS, TABS, TAB_META, type TabId } from './fields';

const ACTIONS: Record<TabId, Array<{ id: string; label: string; hint: string }>> = {
  providers: [
    { id: 'fetchModels', label: 'Fetch models', hint: 'scrape the provider picker (§5.10, on demand)' },
    { id: 'attachBrowser', label: 'Attach browser', hint: 'connectOverCDP to the first listening port' },
    { id: 'health', label: 'Check adapter health', hint: 're-probe every selector on the live page' },
  ],
  router: [
    { id: 'routerStatus', label: 'Router status', hint: 'provider states, cooldowns, pre-warm' },
    { id: 'rotate', label: 'Rotate session now', hint: 'boot → new page → inject' },
  ],
  compressor: [
    { id: 't1Status', label: 'T1 status', hint: 'why T1 is on or off on this machine' },
    { id: 'compressStats', label: 'Compression stats', hint: 'last run, passes, flagged jargon' },
  ],
  state: [
    { id: 'snapshot', label: 'Snapshot now', hint: 'write a restore point' },
    { id: 'rescan', label: 'Rescan workspace (T3)', hint: 're-read files and shas from disk' },
    { id: 'previewBoot', label: 'Preview boot', hint: 'the ≤4k continuation prompt' },
    { id: 'clearState', label: 'Clear state', hint: 'keeps decisions and glossary; snapshots first' },
  ],
  repo: [
    { id: 'indexRepo', label: 'Re-index workspace', hint: 'refresh the file list' },
    { id: 'decisions', label: 'Locked decisions', hint: 'what the edit guard enforces' },
  ],
  performance: [
    { id: 'gc', label: 'Collect garbage', hint: 'HeapProfiler.collectGarbage on every owned tab' },
    { id: 'ramNow', label: 'Sample RAM now', hint: 'take a reading immediately' },
  ],
};

export interface RenderOptions {
  nonce: string;
  /** Open on this tab — lets a command deep-link to Router, Repo, etc. */
  tab?: string;
  /** Live data the panel shows alongside fields. */
  snapshot: {
    ramPercent: number | null;
    ramUsedMb: number | null;
    ramCapMb: number | null;
    bootTokens: number | null;
    deltas: number | null;
    indexedFiles: number | null;
    snapshots: string[];
    health: Array<{ id: string; label: string; ready: boolean; limited: boolean; matches: number }>;
    t1: { enabled: boolean; reason: string } | null;
  };
}

export function renderSettingsHtml(opts: RenderOptions): string {
  const fieldsJson = JSON.stringify(FIELDS);
  const tabsJson = JSON.stringify(TABS);
  const metaJson = JSON.stringify(TAB_META);
  const actionsJson = JSON.stringify(ACTIONS);
  const snapshotJson = JSON.stringify(opts.snapshot);
  const openTabJson = JSON.stringify(opts.tab ?? '');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${opts.nonce}';" />
<style>
  :root { --gap: 14px; }
  * { box-sizing: border-box; }
  body {
    margin: 0; display: flex; height: 100vh; overflow: hidden;
    font: 13px/1.5 var(--vscode-font-family); color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  nav {
    flex: 0 0 176px; display: flex; flex-direction: column; gap: 2px; padding: 12px 8px;
    border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background);
  }
  nav button {
    text-align: left; padding: 7px 10px; border: 0; border-radius: 5px; cursor: pointer;
    background: none; color: var(--vscode-foreground); font: inherit;
  }
  nav button:hover { background: var(--vscode-list-hoverBackground); }
  nav button[aria-selected="true"] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  main { flex: 1 1 auto; overflow-y: auto; padding: 18px 22px 60px; }
  h2 { margin: 0 0 2px; font-size: 15px; }
  .blurb { opacity: .7; margin: 0 0 18px; }
  .row { display: grid; grid-template-columns: 220px 1fr; gap: 10px 16px; padding: 9px 0; border-bottom: 1px solid var(--vscode-panel-border); align-items: start; }
  .row label { font-weight: 600; padding-top: 3px; }
  .row .help { display: block; font-weight: 400; opacity: .62; font-size: 11px; margin-top: 3px; }
  .control { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  input[type="text"], input[type="number"], select, textarea {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 4px 6px;
    font: inherit; min-width: 120px;
  }
  textarea { width: 100%; min-height: 84px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"] { border-color: var(--vscode-inputValidation-errorBorder); }
  .unit { opacity: .6; font-size: 11px; }
  .error { display: none; color: var(--vscode-errorForeground); font-size: 11px; }
  .error.show { display: block; }
  .fixed { opacity: .6; font-size: 11px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 18px 0 8px; }
  button.act, button.secondary {
    padding: 5px 11px; border: 0; border-radius: 4px; cursor: pointer; font: inherit;
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
  }
  button.act:hover, button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .tile { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 12px; margin: 10px 0; }
  .tile h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
  .kv { display: flex; gap: 8px; flex-wrap: wrap; }
  .kv span { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 1px 9px; font-size: 11px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot.green { background: var(--vscode-charts-green); }
  .dot.yellow { background: var(--vscode-charts-yellow); }
  .dot.red { background: var(--vscode-charts-red); }
  .health-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  .health-row .name { min-width: 90px; font-weight: 600; }
  #status { position: fixed; bottom: 0; left: 176px; right: 0; padding: 6px 22px; font-size: 11px; opacity: .75; background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-panel-border); }
  #preview { white-space: pre-wrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; margin-top: 8px; }
  svg.spark { display: block; margin-top: 6px; }
</style>
</head>
<body>
  <nav id="tabs" role="tablist"></nav>
  <main id="panel" role="tabpanel"></main>
  <footer id="status" role="status" aria-live="polite">Loading…</footer>

<script nonce="${opts.nonce}">
(function () {
  var vscode = acquireVsCodeApi();
  var FIELDS = ${fieldsJson};
  var TABS = ${tabsJson};
  var OPEN_TAB = ${openTabJson};
  var META = ${metaJson};
  var ACTIONS = ${actionsJson};
  var snapshot = ${snapshotJson};

  var values = {};
  var errors = {};
  var activeTab = (typeof OPEN_TAB === 'string' && TABS.indexOf(OPEN_TAB) >= 0) ? OPEN_TAB : TABS[0];
  var samples = [];

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function renderTabs() {
    var nav = document.getElementById('tabs');
    nav.innerHTML = '';
    TABS.forEach(function (id) {
      var b = el('button', { role: 'tab', 'data-tab': id });
      b.textContent = META[id].label;
      b.setAttribute('aria-selected', id === activeTab ? 'true' : 'false');
      if (errors.countByTab && errors.countByTab[id]) b.textContent += ' (' + errors.countByTab[id] + ')';
      b.addEventListener('click', function () { activeTab = id; renderTabs(); renderPanel(); });
      nav.appendChild(b);
    });
  }

  function controlFor(f) {
    var wrap = el('div', { class: 'control' });
    var input;
    if (f.type === 'boolean') {
      input = el('input', { type: 'checkbox', 'data-key': f.key, id: 'f-' + f.key });
      input.checked = !!values[f.key];
      if (f.readOnly) input.disabled = true;
      input.addEventListener('change', function () { submit(f, input.checked); });
      wrap.appendChild(input);
      if (f.readOnly) wrap.appendChild(el('span', { class: 'fixed' }, 'fixed by §4'));
    } else if (f.type === 'enum') {
      input = el('select', { 'data-key': f.key, id: 'f-' + f.key });
      (f.options || []).forEach(function (o) {
        var opt = el('option', { value: o }, o);
        if (values[f.key] === o) opt.selected = true;
        input.appendChild(opt);
      });
      if (f.readOnly) input.disabled = true;
      input.addEventListener('change', function () { submit(f, input.value); });
      wrap.appendChild(input);
    } else if (f.type === 'number') {
      input = el('input', { type: 'number', 'data-key': f.key, id: 'f-' + f.key });
      if (f.min !== undefined) input.min = f.min;
      if (f.max !== undefined) input.max = f.max;
      if (f.step !== undefined) input.step = f.step;
      input.value = values[f.key];
      if (f.readOnly) input.disabled = true;
      input.addEventListener('input', function () { submit(f, input.value); });
      wrap.appendChild(input);
      if (f.unit) wrap.appendChild(el('span', { class: 'unit' }, f.unit));
    } else if (f.type === 'json') {
      input = el('textarea', { 'data-key': f.key, id: 'f-' + f.key, spellcheck: 'false' });
      input.value = JSON.stringify(values[f.key], null, 2);
      input.addEventListener('input', function () { submit(f, input.value); });
      wrap.appendChild(input);
    } else {
      input = el('input', { type: 'text', 'data-key': f.key, id: 'f-' + f.key });
      input.value = values[f.key] === undefined ? '' : values[f.key];
      if (f.readOnly) input.disabled = true;
      input.addEventListener('input', function () { submit(f, input.value); });
      wrap.appendChild(input);
    }
    input.setAttribute('aria-describedby', 'err-' + f.key);
    var err = el('div', { class: 'error', id: 'err-' + f.key, role: 'alert' });
    if (errors[f.key]) {
      err.classList.add('show');
      err.textContent = errors[f.key];
      input.setAttribute('aria-invalid', 'true');
    }
    wrap.appendChild(err);
    return wrap;
  }

  var pending = {};
  function submit(f, value) {
    // Optimistic local value; the host validates and replies with an error if any.
    values[f.key] = value;
    clearTimeout(pending[f.key]);
    pending[f.key] = setTimeout(function () {
      vscode.postMessage({ type: 'cmd', cmd: 'set', key: f.key, value: value });
    }, 260);
  }

  function tile(title) {
    var t = el('div', { class: 'tile' });
    t.appendChild(el('h3', null, title));
    // Any nodes passed after the title are appended — the preview blocks rely on it.
    for (var i = 1; i < arguments.length; i += 1) {
      var child = arguments[i];
      if (child) t.appendChild(child);
    }
    return t;
  }

  function liveTiles() {
    var out = document.createDocumentFragment();
    if (activeTab === 'performance') {
      var t = tile('Live memory');
      var kv = el('div', { class: 'kv' });
      kv.appendChild(el('span', null, 'browser ' + (snapshot.ramUsedMb === null ? '—' : snapshot.ramUsedMb + '/' + snapshot.ramCapMb + ' MB')));
      kv.appendChild(el('span', null, 'ext host ' + (snapshot.extMb === null || snapshot.extMb === undefined ? '—' : snapshot.extMb + ' MB')));
      kv.appendChild(el('span', null, 'boot ' + (snapshot.bootTokens === null ? '—' : snapshot.bootTokens + '/4k tok')));
      t.appendChild(kv);
      t.appendChild(sparkline());
      out.appendChild(t);
    }
    if (activeTab === 'state') {
      var ts = tile('Snapshots');
      if (!snapshot.snapshots || snapshot.snapshots.length === 0) ts.appendChild(el('div', { class: 'fixed' }, 'No snapshots yet.'));
      (snapshot.snapshots || []).forEach(function (name) {
        var row = el('div', { class: 'health-row' });
        row.appendChild(el('span', { class: 'name' }, name));
        var btn = el('button', { class: 'secondary' }, 'Restore');
        btn.addEventListener('click', function () { vscode.postMessage({ type: 'cmd', cmd: 'action', action: 'restore', value: name }); });
        row.appendChild(btn);
        ts.appendChild(row);
      });
      ts.appendChild(el('div', { class: 'fixed' }, 'deltas: ' + (snapshot.deltas === null ? '—' : snapshot.deltas)));
      out.appendChild(ts);
    }
    // §5.12: "every tab: … live preview". These read the live snapshot, so the
    // block is never stale and costs no round trip.
    if (activeTab === 'providers') {
      var pm = snapshot.models || [];
      out.appendChild(
        tile(
          'Preview — what the Providers tab would send',
          el('div', { class: 'help' },
            pm.length === 0
              ? 'No model list yet — press Fetch models on the Providers tab.'
              : pm.length + ' model(s) · ' + pm.filter(function (m) { return m.isFree; }).length + ' free · current: ' +
                ((pm.find(function (m) { return m.current; }) || {}).label || 'none')),
        ),
      );
    }
    if (activeTab === 'router') {
      var chain = (snapshot.router || []).slice().sort(function (a, b) { return a.priority - b.priority; });
      out.appendChild(
        tile(
          'Preview — the failover chain',
          el('div', { class: 'help' },
            chain.length === 0
              ? 'No providers reported yet — attach the browser to see the chain.'
              : chain.map(function (p) { return p.label + (p.state === 'cooling' ? ' (cooling)' : ''); }).join(' \u2192 ')),
        ),
      );
    }
    if (activeTab === 'state') {
      out.appendChild(
        tile(
          'Preview — the boot this state would produce',
          el('div', { class: 'help' },
            (snapshot.bootTokens == null ? 'no boot yet' : snapshot.bootTokens + ' tokens' + (snapshot.bootBudget ? ' (budget ' + snapshot.bootBudget + ')' : '')) +
            ' · ' + (snapshot.deltas == null ? 0 : snapshot.deltas) + ' delta(s) · ' +
            (snapshot.snapshots ? snapshot.snapshots.length : 0) + ' snapshot(s)'),
        ),
      );
    }
    if (activeTab === 'repo') {
      var rp = tile('Preview — what context a question would attach');
      rp.appendChild(el('div', { class: 'help' }, (snapshot.indexedFiles == null ? 0 : snapshot.indexedFiles) + ' indexed file(s)' + (snapshot.contextMode ? ' · mode: ' + snapshot.contextMode : '')));
      var q = el('input', { type: 'text', placeholder: 'try a question, e.g. refactor src/format.ts' });
      q.style.width = '100%';
      var go = el('button', { class: 'act' }, 'Preview');
      var verdict = el('div', { class: 'help' }, '');
      go.addEventListener('click', function () {
        vscode.postMessage({ type: 'cmd', cmd: 'action', action: 'previewRepo', value: q.value });
      });
      rp.appendChild(q);
      rp.appendChild(go);
      rp.appendChild(verdict);
      out.appendChild(rp);
    }
    if (activeTab === 'performance') {
      var used = snapshot.ramUsedMb, cap = snapshot.ramCapMb;
      out.appendChild(
        tile(
          'Preview — headroom at the current cap',
          el('div', { class: 'help' },
            used == null || cap == null
              ? 'no reading yet'
              : used + ' of ' + cap + ' MB used · ' + (cap - used) + ' MB headroom before the 80% recycle point at ' + Math.round(cap * 0.8) + ' MB'),
        ),
      );
    }
    if (activeTab === 'router' && snapshot.router && snapshot.router.length) {
      var tr = tile('Providers — order, cooldown, health (§5.9)');
      snapshot.router.forEach(function (p, idx) {
        var row = el('div', { class: 'health-row' });
        row.appendChild(el('span', { class: 'dot ' + (p.health === 'green' ? 'green' : p.health === 'red' ? 'red' : 'yellow') }));
        row.appendChild(el('span', { class: 'name' }, p.priority + '. ' + p.label));
        row.appendChild(el('span', { class: 'fixed' }, p.state));
        if (p.lastResponseMs != null) row.appendChild(el('span', { class: 'fixed' }, 'last ' + p.lastResponseMs + ' ms'));

        var cd = el('input', { type: 'number', min: '0', step: '60000', title: 'cooldown (ms)' });
        cd.value = String(p.cooldownMs);
        cd.style.width = '110px';
        cd.addEventListener('change', function () {
          vscode.postMessage({ type: 'cmd', cmd: 'action', action: 'routerConfigure', value: { id: p.id, cooldownMs: Number(cd.value) } });
        });
        row.appendChild(cd);

        var up = el('button', { class: 'secondary', title: 'move up' }, '\u2191');
        up.addEventListener('click', function () {
          vscode.postMessage({ type: 'cmd', cmd: 'action', action: 'routerConfigure', value: { id: p.id, priority: Math.max(1, p.priority - 1) } });
        });
        var down = el('button', { class: 'secondary', title: 'move down' }, '\u2193');
        down.addEventListener('click', function () {
          vscode.postMessage({ type: 'cmd', cmd: 'action', action: 'routerConfigure', value: { id: p.id, priority: p.priority + 1 } });
        });
        row.appendChild(up);
        row.appendChild(down);
        tr.appendChild(row);
      });
      var pw = el('button', { class: 'act', title: 'open the page of a provider at 80% cooldown' }, 'Pre-warm');
      pw.addEventListener('click', function () {
        vscode.postMessage({ type: 'cmd', cmd: 'action', action: 'routerPrewarm' });
      });
      tr.appendChild(pw);
      out.appendChild(tr);
    }
    if (activeTab === 'providers') {
      var th = tile('Provider health');
      if (!snapshot.health || snapshot.health.length === 0) {
        th.appendChild(el('div', { class: 'fixed' }, 'No adapter probed yet — attach a browser and press “Check adapter health”.'));
      }
      (snapshot.health || []).forEach(function (h) {
        var row = el('div', { class: 'health-row' });
        var dot = el('span', { class: 'dot ' + (h.limited ? 'red' : h.ready ? 'green' : 'yellow') });
        row.appendChild(dot);
        row.appendChild(el('span', { class: 'name' }, h.label));
        row.appendChild(el('span', { class: 'fixed' }, h.limited ? 'usage limit' : h.ready ? 'ready' : 'not ready'));
        if (h.matches) row.appendChild(el('span', { class: 'fixed' }, h.matches + ' selector(s) matched'));
        th.appendChild(row);
      });
      if (snapshot.models && snapshot.models.length) {
        th.appendChild(el('div', { class: 'fixed' }, 'Models:'));
        snapshot.models.forEach(function (m) {
          const row = el('div', { class: 'health-row' });
          row.appendChild(el('span', { class: 'name' }, m.label));
          row.appendChild(el('span', { class: 'fixed' }, (m.current ? 'current' : '') + (m.isFree ? ' · free' : ' · paid')));
          th.appendChild(row);
        });
      }
      out.appendChild(th);
    }
    if (activeTab === 'compressor') {
      var tc = tile('Preview — T0 on a sample, before you use it');
      var ta = el('textarea', { id: 'preview-input', spellcheck: 'false' });
      ta.value = 'Please could you kindly refactor the formatSlug helper in src/format.ts, thank you so much!';
      tc.appendChild(ta);
      var btn = el('button', { class: 'act' }, 'Compress');
      btn.addEventListener('click', function () {
        vscode.postMessage({ type: 'cmd', cmd: 'action', action: 'compressPreview', value: ta.value });
      });
      tc.appendChild(btn);
      var out2 = el('div', { id: 'preview' });
      out2.textContent = 'Press Compress to see T0 on this text.';
      tc.appendChild(out2);
      if (snapshot.t1) {
        tc.appendChild(el('div', { class: 'fixed' }, 'T1: ' + (snapshot.t1.enabled ? 'enabled' : 'off') + ' — ' + snapshot.t1.reason));
      }
      out.appendChild(tc);
    }
    return out;
  }

  function sparkline() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '48');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Browser memory over the last samples');
    if (!samples.length) return svg;
    var max = 100;
    var step = samples.length > 1 ? 100 / (samples.length - 1) : 0;
    var pts = samples.map(function (v, i) { return (i * step).toFixed(1) + ',' + (48 - Math.min(48, (v / max) * 48)).toFixed(1); }).join(' ');
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', pts);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--vscode-charts-blue)');
    line.setAttribute('stroke-width', '1.5');
    svg.appendChild(line);
    return svg;
  }

  function renderPanel() {
    var main = document.getElementById('panel');
    main.innerHTML = '';
    main.appendChild(el('h2', null, META[activeTab].label));
    main.appendChild(el('p', { class: 'blurb' }, META[activeTab].blurb));

    FIELDS.filter(function (f) { return f.tab === activeTab; }).forEach(function (f) {
      var row = el('div', { class: 'row' });
      var label = el('label', { for: 'f-' + f.key });
      label.textContent = f.label;
      label.appendChild(el('span', { class: 'help' }, f.help));
      row.appendChild(label);
      row.appendChild(controlFor(f));
      main.appendChild(row);
    });

    main.appendChild(liveTiles());

    var acts = el('div', { class: 'actions' });
    (ACTIONS[activeTab] || []).forEach(function (a) {
      var b = el('button', { class: 'act', title: a.hint });
      b.textContent = a.label;
      b.addEventListener('click', function () { vscode.postMessage({ type: 'cmd', cmd: 'action', action: a.id }); });
      acts.appendChild(b);
    });
    var resetTab = el('button', { class: 'secondary', title: 'Reset this tab to defaults' });
    resetTab.textContent = 'Reset tab';
    resetTab.addEventListener('click', function () { vscode.postMessage({ type: 'cmd', cmd: 'resetTab', tab: activeTab }); });
    acts.appendChild(resetTab);
    main.appendChild(acts);
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'state') {
      // The footer says "Loading…" only until the first real state arrives.
      var footer = document.getElementById('status');
      if (footer && footer.textContent === 'Loading…') footer.textContent = '';
      values = msg.values || {};
      errors = msg.errors || {};
      if (msg.samples) samples = msg.samples;
      if (msg.snapshot) snapshot = msg.snapshot;
      renderTabs();
      renderPanel();
    } else if (msg.type === 'validation') {
      errors[msg.key] = msg.error || null;
      var input = document.getElementById('f-' + msg.key);
      var err = document.getElementById('err-' + msg.key);
      if (input && err) {
        if (msg.error) {
          input.setAttribute('aria-invalid', 'true');
          err.textContent = msg.error;
          err.classList.add('show');
        } else {
          input.removeAttribute('aria-invalid');
          err.textContent = '';
          err.classList.remove('show');
        }
      }
      if (msg.value !== undefined) values[msg.key] = msg.value;
    } else if (msg.type === 'status') {
      document.getElementById('status').textContent = msg.text;
    } else if (msg.type === 'preview') {
      var out = document.getElementById('preview');
      if (out) {
        out.textContent = msg.before + ' → ' + msg.after + ' tokens (⇣' + msg.percent + '%)\\n\\n' + msg.text;
      }
    } else if (msg.type === 'samples') {
      samples = msg.samples || [];
      if (activeTab === 'performance') renderPanel();
    }
  });

  renderTabs();
  renderPanel();
  vscode.postMessage({ type: 'cmd', cmd: 'ready' });
})();
</script>
</body>
</html>`;
}
