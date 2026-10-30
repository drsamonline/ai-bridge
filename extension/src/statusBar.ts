/**
 * Status bar composition (spec §6, Status Bar row).
 *
 * 0.2 fills the parts that exist: browser attach state and the RAM meter.
 * Model · token meter · compression % · streaming arrive with their batches and
 * are appended here, in this order, without re-laying-out the item.
 */

import type { BrowserStatus, RamSample } from '@ai-bridge/shared';

export type Phase = 'stopped' | 'starting' | 'handshaking' | 'ready' | 'error';

export interface StreamState {
  active: boolean;
  elapsedMs: number;
  /** Last completed prompt, for the `✓ 2.1s` marker. */
  lastMs: number | null;
  lastAt: number;
}

export interface MeterState {
  phase: Phase;
  browser: BrowserStatus | null;
  ram: RamSample | null;
  extRssBytes: number;
  extCapBytes: number;
  blocked: boolean;
  lastError: string | null;
  lowEnd?: { active: boolean; reason: string };
  /** §5.9/§5.10/§6: which provider and model are actually in use. */
  provider?: { id: string; label: string; cooling: boolean; cooldownMsLeft: number } | null;
  model?: { label: string; isFree: boolean } | null;
  /** Optional so a 0.2-era caller (and its tests) still works. */
  stream?: StreamState;
  /** T0 compression, once 3.1 has run on a prompt. */
  compress?: {
    percent: number;
    tokensBefore: number;
    tokensAfter: number;
    cacheHit: boolean;
    tier?: 'T0' | 'T1';
    t1Reason?: string;
  } | null;
  /** State layer counters, once 2.1 has started it. */
  state?: { deltas: number; snapshots: number; threaded: boolean; bootTokens?: number } | null;
}

export function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function tabAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

export function statusText(s: MeterState): string {
  // §5.4: ⟳ streaming… → ✓ 2.1s
  if (s.stream?.active) return `$(sync~spin) streaming… ${(s.stream.elapsedMs / 1000).toFixed(1)}s`;
  if (s.phase === 'error') return '$(error) Bridge: error';
  if (s.phase === 'starting') return '$(sync~spin) Bridge: starting…';
  if (s.phase === 'handshaking') return '$(sync~spin) Bridge: handshaking…';
  if (s.phase === 'stopped') return '$(debug-disconnect) Bridge: stopped';

  const b = s.browser;
  if (!b || !b.attached) return '$(browser) No browser · bridge ready';

  const used = s.ram ? mb(s.ram.browser.totalBytes) : 0;
  const cap = s.ram ? mb(s.ram.capBytes) : 500;
  const ramPart = `RAM ${used}/${cap}`;
  const head = s.blocked ? `$(warning) Blocked: ${b.name}` : `$(browser) Attached: ${b.name}`;
  const age = b.tabAgeMs > 0 ? ` · tab ${tabAge(b.tabAgeMs)}` : '';
  const done =
    s.stream?.lastMs != null && Date.now() - s.stream.lastAt < 15_000
      ? ` · $(check) ${(s.stream.lastMs / 1000).toFixed(1)}s`
      : '';
  // §6 Status Bar row: token meter (the boot budget) alongside the RAM meter.
  const le = s.lowEnd?.active ? ' · $(zap) LE' : '';
  // §6 Status Bar row: Provider · Model come first, before the meters.
  const prov = s.provider
    ? s.provider.cooling
      ? `${s.provider.label} (${Math.max(1, Math.round(s.provider.cooldownMsLeft / 60000))}m)`
      : s.provider.label
    : '';
  const mdl = s.model ? `${s.model.label}${s.model.isFree ? ' (Free)' : ''}` : '';
  const lead = [prov, mdl].filter(Boolean).join(' · ');
  const comp =
    s.compress && s.compress.percent > 0
      ? ` · ⇣${s.compress.percent}%${s.compress.tier === 'T1' ? ' T1' : ''}`
      : '';
  const tok =
    s.state?.bootTokens != null
      ? ` · tok ${s.state.bootTokens > 999 ? `${(s.state.bootTokens / 1000).toFixed(1)}k` : s.state.bootTokens}/4k`
      : '';
  const headPart = lead ? `${lead} · ${head}` : head;
  return `${headPart} · ${ramPart}${comp}${tok}${age}${done}${le}`;
}

export function statusTooltip(s: MeterState): string {
  const lines: string[] = [`**AI Bridge** — \`${s.phase}\``, ''];
  const b = s.browser;
  if (b?.attached) {
    lines.push(`- browser: **${b.name}** \`${b.version}\` on 127.0.0.1:${b.port}`);
    lines.push(`- contexts: ${b.contexts} (reused) · owned tabs: ${b.tabs.length} · turns: ${b.turns}`);
    lines.push(`- active tab age: ${tabAge(b.tabAgeMs)} · recycled: ${b.recycled}`);
    if (b.lastRecycleReason) lines.push(`- last recycle: ${b.lastRecycleReason}`);
  } else {
    lines.push('- browser: not attached');
    if (b?.candidates.length) {
      lines.push(`- endpoints seen: ${b.candidates.map((c) => `${c.name}@${c.port}`).join(', ')}`);
    }
  }
  if (s.ram) {
    const r = s.ram;
    lines.push(
      `- browser RAM: **${mb(r.browser.totalBytes)}/${mb(r.capBytes)} MB** (${r.percent}%) · ${r.browser.processCount} procs · ${r.browser.source}`,
    );
    if (r.browser.rendererBytes > 0) {
      lines.push(`- of which renderers: ${mb(r.browser.rendererBytes)} MB`);
    }
    if (r.browser.source === 'procfs-rss') {
      lines.push('- ⚠︎ RSS upper bound: this kernel exposes no PSS/shared-page accounting');
    }
    lines.push(`- watchdog: ${r.level}${s.blocked ? ' — requests blocked' : ''}`);
  }
  lines.push(`- extension host RSS: ${mb(s.extRssBytes)}/${mb(s.extCapBytes)} MB`);
  if (s.compress) {
    lines.push(
      `- compression: **⇣${s.compress.percent}%** via ${s.compress.tier ?? 'T0'} (${s.compress.tokensBefore}→${s.compress.tokensAfter} tokens${s.compress.cacheHit ? ', cache hit' : ''})` +
        (s.compress.t1Reason ? `\n- T1: ${s.compress.t1Reason}` : ''),
    );
  }
  if (s.provider || s.model) {
    lines.push(
      `- provider: **${s.provider?.label ?? 'none'}**${s.provider?.cooling ? ` (cooling ${Math.round(s.provider.cooldownMsLeft / 1000)} s)` : ''}` +
        (s.model ? ` · model: **${s.model.label}**${s.model.isFree ? ' (free)' : ' (paid)'}` : ''),
    );
  }
  if (s.lowEnd) {
    lines.push(`- low-end mode: **${s.lowEnd.active ? 'on' : 'off'}** — ${s.lowEnd.reason}`);
  }
  if (s.state) {
    lines.push(
      `- state: **${s.state.deltas}** delta(s) · T1 ${s.state.threaded ? 'worker thread' : 'inline'}` +
        (s.state.bootTokens ? ` · boot ${s.state.bootTokens}/4000 tokens` : ''),
    );
  }
  if (s.stream?.active) lines.push(`- streaming for ${(s.stream.elapsedMs / 1000).toFixed(1)} s`);
  else if (s.stream?.lastMs != null) lines.push(`- last answer settled in ${s.stream.lastMs} ms`);
  if (s.lastError) lines.push('', `$(error) ${s.lastError}`);
  lines.push('', '_Click for the Output log._');
  return lines.join('\n');
}

export function bar(percent: number, width = 12): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
