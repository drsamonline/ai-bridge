/**
 * Settings model — spec §4 `Settings`, §5.12 (six tabs, full surface exposed,
 * "invalid → inline error").
 *
 * One declarative table drives everything: the panel renders from it, validation
 * comes from it, the tests round-trip every row of it. Adding a setting means
 * adding one entry here and nothing else.
 *
 * Each field carries BOTH its §4 path (`ramCap.browser`) and its flat VS Code
 * configuration key (`aiBridge.ramCap.browser`), so the panel can speak §4 while
 * the settings file stays flat.
 */

import type { Settings } from '@ai-bridge/shared';
import { DEFAULT_SETTINGS } from '@ai-bridge/shared';

export const TABS = ['providers', 'router', 'compressor', 'state', 'repo', 'performance'] as const;
export type TabId = (typeof TABS)[number];

export const TAB_META: Record<TabId, { label: string; blurb: string }> = {
  providers: { label: 'Providers', blurb: 'Which web chats the bridge may drive, in priority order.' },
  router: { label: 'Router', blurb: 'How prompts move between providers when one is unavailable.' },
  compressor: { label: 'Compressor', blurb: 'T0 always runs; T1 is an opt-in local model with guards.' },
  state: { label: 'State', blurb: 'Where the project state lives, how it is protected, and its snapshots.' },
  repo: { label: 'Repo', blurb: 'What the bridge may read from the workspace, and what it may change.' },
  performance: { label: 'Performance', blurb: 'Memory caps, the watchdog and the GC lever.' },
};

export type FieldType = 'boolean' | 'number' | 'string' | 'enum' | 'json';

export interface FieldSpec {
  /** Flat VS Code configuration key. */
  key: string;
  /** §4 path, for display and for readSettings. */
  path: string;
  label: string;
  type: FieldType;
  default: unknown;
  tab: TabId;
  help: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  unit?: string;
  /** Fixed by contract (e.g. §4 `compressor.protectCode: true`). */
  readOnly?: boolean;
  /** True when the value is managed by an action rather than typed. */
  actionOnly?: boolean;
}

const s = DEFAULT_SETTINGS;

export const FIELDS: FieldSpec[] = [
  /* ------------------------------------------------------------ providers */
  {
    key: 'aiBridge.providers.list',
    path: 'providers',
    label: 'Providers',
    type: 'json',
    default: s.providers,
    tab: 'providers',
    help: 'Array of { id, enabled, priority, cooldownMs }. Priority 1 runs first. Claude and Gemini become available in batch 6.1.',
  },
  {
    key: 'aiBridge.browser.ports',
    path: 'bridge.cdpPorts',
    label: 'CDP ports',
    type: 'json',
    default: [9222, 9223],
    tab: 'providers',
    help: 'Debugging ports probed in order. The bridge attaches to an existing browser and never launches one.',
  },
  {
    key: 'aiBridge.custom.providers',
    path: 'providers.custom',
    label: 'Custom providers',
    type: 'json',
    default: [],
    tab: 'providers',
    help: 'Any other web chat: [{ id, label, url, selectors: { composer: {primary, fallbacks}, send: {primary, fallbacks} } }]. Other roles fall back to generic guesses.',
  },
  {
    key: 'aiBridge.api.providers',
    path: 'api.providers',
    label: 'API endpoints',
    type: 'json',
    default: [],
    tab: 'providers',
    help: 'OpenAI-compatible endpoints: [{ id, name, baseUrl, noApiKey, models: [], toolCalling, imageInput, thinking }]. Keys are never stored here — set AI_BRIDGE_API_KEY_<ID> in the environment, or keep noApiKey true for a local server. Batch 8.0.',
  },
  {
    key: 'aiBridge.fastpath.templates',
    path: 'fastpath.templates',
    label: 'Fast-path templates',
    type: 'json',
    default: [],
    tab: 'providers',
    help: 'Per-provider request templates: [{ providerId, url, method, headers, bodyTemplate, enabled }]. Run "AI Bridge: Capture Request as Template" to make one from a copied cURL. Off unless enabled.',
  },
  {
    key: 'aiBridge.features.commit.enabled',
    path: 'features.commit.enabled',
    label: 'Commit messages',
    type: 'boolean',
    default: true,
    tab: 'providers',
    help: 'Show the sparkle button in Source Control. Batch 8.3.',
  },
  {
    key: 'aiBridge.features.commit.model',
    path: 'features.commit.model',
    label: 'Commit model',
    type: 'string',
    default: 'auto',
    tab: 'providers',
    help: 'Model id, or "auto" to prefer a free model so the strong one is left for chat.',
  },
  {
    key: 'aiBridge.features.suggestions.enabled',
    path: 'features.suggestions.enabled',
    label: 'Inline suggestions',
    type: 'boolean',
    default: false,
    tab: 'providers',
    help: 'On-demand ghost text. Never fires while typing — trigger it with the command or its keybinding.',
  },
  {
    key: 'aiBridge.features.suggestions.model',
    path: 'features.suggestions.model',
    label: 'Suggestions model',
    type: 'string',
    default: 'auto',
    tab: 'providers',
    help: 'Model id, or "auto". Bounded to 12 lines and 600 characters.',
  },
  {
    key: 'aiBridge.features.fix.enabled',
    path: 'features.fix.enabled',
    label: 'Quick fixes',
    type: 'boolean',
    default: true,
    tab: 'providers',
    help: 'Offer "AI Bridge: Fix this" in the Quick Fix menu, with a diff preview before anything is written.',
  },
  {
    key: 'aiBridge.features.fix.model',
    path: 'features.fix.model',
    label: 'Fix model',
    type: 'string',
    default: 'auto',
    tab: 'providers',
    help: 'Model id, or "auto" to pick the cheapest model that is fit for fixes.',
  },
  {
    key: 'aiBridge.adapter.id',
    path: 'providers.active',
    label: 'Active adapter',
    type: 'enum',
    default: 'chatgpt',
    options: ['chatgpt'],
    tab: 'providers',
    help: 'Adapter the chat panel drives. More arrive in batch 6.1.',
  },

  /* --------------------------------------------------------------- router */
  {
    key: 'aiBridge.router.strategy',
    path: 'router.strategy',
    label: 'Strategy',
    type: 'enum',
    default: s.router.strategy,
    options: ['priority', 'round-robin'],
    tab: 'router',
    help: 'Priority walks the provider list in order; round-robin spreads load.',
  },
  {
    key: 'aiBridge.router.retries',
    path: 'router.retries',
    label: 'Retries per provider',
    type: 'number',
    default: s.router.retries,
    min: 0,
    max: 5,
    step: 1,
    tab: 'router',
    help: 'How many times a failing provider is retried before failover.',
  },
  {
    key: 'aiBridge.router.backoff',
    path: 'router.backoff',
    label: 'Backoff',
    type: 'enum',
    default: s.router.backoff,
    options: ['exponential', 'linear'],
    tab: 'router',
    help: 'Retry spacing, with jitter. Applied once the router lands in 6.1.',
  },
  {
    key: 'aiBridge.chat.debounceMs',
    path: 'router.debounceMs',
    label: 'Settle debounce',
    type: 'number',
    default: 900,
    min: 600,
    max: 1500,
    step: 50,
    unit: 'ms',
    tab: 'router',
    help: 'Quiet period before an answer counts as settled (§5.4: 600–1500 ms). The copy-button sentinel usually ends the wait sooner.',
  },

  {
    key: 'aiBridge.router.failover',
    path: 'router.failover',
    label: 'Failover on limit',
    type: 'boolean',
    default: true,
    tab: 'router',
    help: 'When a provider is limited, move to the next one in priority order and inject the boot so the context follows (§5.9).',
  },
  {
    key: 'aiBridge.rotation.enabled',
    path: 'router.rotationEnabled',
    label: 'Rotate on limit',
    type: 'boolean',
    default: true,
    tab: 'router',
    help: 'When a provider reports a usage limit, build the boot, open a fresh chat and inject it (§5.1).',
  },
  {
    key: 'aiBridge.rotation.preview',
    path: 'router.rotationPreview',
    label: 'Boot preview on rotate',
    type: 'enum',
    default: 'on-failover',
    options: ['always', 'on-failover', 'never'],
    tab: 'router',
    help: 'When the editable boot document is shown before injecting. §6: visible on failover.',
  },

  /* ----------------------------------------------------------- compressor */
  {
    key: 'aiBridge.compressor.enabled',
    path: 'compressor.enabled',
    label: 'T0 compression',
    type: 'boolean',
    default: s.compressor.enabled,
    tab: 'compressor',
    help: 'Run T0 on every prompt: filler, pleasantry, whitespace, glossary, dedupe.',
  },
  {
    key: 'aiBridge.compressor.tier',
    path: 'compressor.tier',
    label: 'Tier',
    type: 'enum',
    default: s.compressor.tier,
    options: ['T0', 'T1', 'auto'],
    tab: 'compressor',
    help: 'T1 adds a local model pass; auto uses it only when the memory gate allows and a backend answers.',
  },
  {
    key: 'aiBridge.compressor.budgetTokens',
    path: 'compressor.budgetTokens',
    label: 'Budget',
    type: 'number',
    default: s.compressor.budgetTokens,
    min: 128,
    max: 32768,
    step: 128,
    unit: 'tokens',
    tab: 'compressor',
    help: 'Above this, one harder T0 pass runs (articles and connectives dropped).',
  },
  {
    key: 'aiBridge.compressor.glossary',
    path: 'compressor.glossary',
    label: 'Glossary aliases',
    type: 'json',
    default: {},
    tab: 'compressor',
    help: 'Long form → short alias, e.g. {"the extension host": "EH"}. Only entries whose value is shorter are applied.',
  },
  {
    key: 'aiBridge.compressor.protectCode',
    path: 'compressor.protectCode',
    label: 'Protect code',
    type: 'boolean',
    default: true,
    readOnly: true,
    tab: 'compressor',
    help: 'Fixed true by §4: fences, inline code, paths, URLs, constants and error lines are never touched.',
  },
  {
    key: 'aiBridge.t1.mode',
    path: 'compressor.t1Mode',
    label: 'T1 gate',
    type: 'enum',
    default: 'auto',
    options: ['auto', 'on', 'off'],
    tab: 'compressor',
    help: 'auto turns T1 off below 8 GB of RAM (§5.6). on is your explicit opt-in.',
  },
  {
    key: 'aiBridge.t1.backend',
    path: 'compressor.t1Backend',
    label: 'T1 backend',
    type: 'enum',
    default: 'ollama',
    options: ['ollama', 'llamacpp', 'provider'],
    tab: 'compressor',
    help: 'ollama talks to a local model over HTTP; llamacpp runs in-process (50–150 MB); provider asks the logged-in chat itself in a throwaway tab (§5.6 T2, costs quota).',
  },
  {
    key: 'aiBridge.t1.model',
    path: 'compressor.t1Model',
    label: 'T1 model',
    type: 'string',
    default: 'llama3.2',
    tab: 'compressor',
    help: 'Model name for the Ollama backend.',
  },
  {
    key: 'aiBridge.t1.minRamGb',
    path: 'compressor.t1MinRamGb',
    label: 'T1 RAM threshold',
    type: 'number',
    default: 8,
    min: 1,
    max: 128,
    step: 1,
    unit: 'GB',
    tab: 'compressor',
    help: 'Below this the gate keeps T1 off.',
  },

  /* ---------------------------------------------------------------- state */
  {
    key: 'aiBridge.state.location',
    path: 'state.location',
    label: 'Location',
    type: 'enum',
    default: s.state.location,
    options: ['workspace', 'global'],
    tab: 'state',
    help: 'workspace writes into .ai-bridge/state with a generated .gitignore; global keeps it in your home directory.',
  },
  {
    key: 'aiBridge.state.maxSnapshots',
    path: 'state.maxSnapshots',
    label: 'Snapshots kept',
    type: 'number',
    default: s.state.maxSnapshots,
    min: 1,
    max: 100,
    step: 1,
    tab: 'state',
    help: 'Oldest snapshots are pruned beyond this.',
  },
  {
    key: 'aiBridge.state.encrypt',
    path: 'state.encrypt',
    label: 'Encrypt state',
    type: 'boolean',
    default: s.state.encrypt,
    tab: 'state',
    help: 'AES-256-GCM with a key in SecretStorage. Writes state.full.json.gz.aes instead of .gz.',
  },
  {
    key: 'aiBridge.state.snapshotEvery',
    path: 'state.snapshotEvery',
    label: 'Snapshot every',
    type: 'number',
    default: 10,
    min: 0,
    max: 100,
    step: 1,
    unit: 'turns',
    tab: 'state',
    help: '0 disables the interval; init and manual snapshots still happen.',
  },

  /* ----------------------------------------------------------------- repo */
  {
    key: 'aiBridge.repo.contextMode',
    path: 'repo.contextMode',
    label: 'Context mode',
    type: 'enum',
    default: 'auto',
    options: ['auto', 'always', 'off'],
    tab: 'repo',
    help: 'auto attaches repo context only when the question names a file, a symbol or a code term — a bundle costs 500–900 tokens on every prompt.',
  },
  {
    key: 'aiBridge.repo.context',
    path: 'repo.context',
    label: 'Attach repo context',
    type: 'boolean',
    default: true,
    tab: 'repo',
    help: 'Send signatures and (within budget) file bodies with every prompt.',
  },
  {
    key: 'aiBridge.repo.edits',
    path: 'repo.edits',
    label: 'Offer edit proposals',
    type: 'boolean',
    default: true,
    tab: 'repo',
    help: 'Parse edit blocks out of answers and show them as a reviewable diff. Nothing is written until you accept.',
  },

  /* ---------------------------------------------------------- performance */
  {
    key: 'aiBridge.ramCap.browser',
    path: 'ramCap.browser',
    label: 'Browser RAM cap',
    type: 'number',
    default: s.ramCap.browser,
    min: 100,
    max: 8192,
    step: 50,
    unit: 'MB',
    tab: 'performance',
    help: '§2: ≤ 500 MB. Measured over the attached browser’s whole process tree.',
  },
  {
    key: 'aiBridge.ramCap.extension',
    path: 'ramCap.extension',
    label: 'Extension host cap',
    type: 'number',
    default: s.ramCap.extension,
    min: 128,
    max: 8192,
    step: 64,
    unit: 'MB',
    tab: 'performance',
    help: '§2: ≤ 1 GB. Shown in the status bar tooltip.',
  },
  {
    key: 'aiBridge.watchdog.pollMs',
    path: 'ui.watchdogPollMs',
    label: 'Watchdog poll',
    type: 'number',
    default: 3000,
    min: 500,
    max: 30000,
    step: 500,
    unit: 'ms',
    tab: 'performance',
    help: '§5.11: 3 s. 80% evicts idle tabs and collects garbage; 100% blocks requests.',
  },
  {
    key: 'aiBridge.ui.lowEndMode',
    path: 'ui.lowEndMode',
    label: 'Low-end mode',
    type: 'enum',
    default: s.ui.lowEndMode,
    options: ['auto', 'on', 'off'],
    tab: 'performance',
    help: 'auto detects an 8 GB machine and keeps the expensive tiers off.',
  },
  {
    key: 'aiBridge.ui.statusBar',
    path: 'ui.statusBar',
    label: 'Status bar item',
    type: 'boolean',
    default: s.ui.statusBar,
    tab: 'performance',
    help: 'Show the provider · RAM · token meter in the status bar.',
  },
  {
    key: 'aiBridge.ui.showCompressionPreview',
    path: 'ui.showCompressionPreview',
    label: 'Per-message compression preview',
    type: 'boolean',
    default: s.ui.showCompressionPreview,
    tab: 'performance',
    help: 'Show the ⇣% footer on messages with an expand toggle.',
  },

  /* --------------------------------------------------------------- bridge */
  {
    key: 'aiBridge.bridge.port',
    path: 'bridge.port',
    label: 'Bridge port',
    type: 'number',
    default: s.bridge.port,
    min: 1024,
    max: 65535,
    step: 1,
    tab: 'providers',
    help: 'Loopback only (127.0.0.1). Falls forward if the port is busy.',
  },
  {
    key: 'aiBridge.bridge.autostart',
    path: 'bridge.autostart',
    label: 'Start bridge with VS Code',
    type: 'boolean',
    default: s.bridge.autostart,
    tab: 'providers',
    help: 'Spawn the bridge when the extension activates.',
  },
];

export function fieldsFor(tab: TabId): FieldSpec[] {
  return FIELDS.filter((f) => f.tab === tab);
}

export function fieldByKey(key: string): FieldSpec | undefined {
  return FIELDS.find((f) => f.key === key);
}

/* ------------------------------------------------------------- validation */

export type Validation = { ok: true; value: unknown } | { ok: false; error: string };

const isInt = (n: number) => Number.isInteger(n);

/** The single place a value is judged. Returns the coerced value or an error. */
export function validateField(spec: FieldSpec, raw: unknown): Validation {
  switch (spec.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' };
      return { ok: false, error: 'Must be true or false.' };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { ok: false, error: 'Must be a number.' };
      if (spec.step && spec.step >= 1 && !isInt(n)) {
        return { ok: false, error: `Must be a whole number${spec.unit ? ` (${spec.unit})` : ''}.` };
      }
      if (spec.min !== undefined && n < spec.min) return { ok: false, error: `Must be at least ${spec.min}${spec.unit ? ` ${spec.unit}` : ''}.` };
      if (spec.max !== undefined && n > spec.max) return { ok: false, error: `Must be at most ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}.` };
      return { ok: true, value: n };
    }
    case 'enum': {
      const v = String(raw);
      if (!spec.options?.includes(v)) {
        return { ok: false, error: `Must be one of: ${spec.options?.join(', ')}.` };
      }
      return { ok: true, value: v };
    }
    case 'string': {
      const v = String(raw ?? '').trim();
      if (v.length === 0) return { ok: false, error: 'Cannot be empty.' };
      if (v.length > 200) return { ok: false, error: 'Too long (max 200 characters).' };
      return { ok: true, value: v };
    }
    case 'json': {
      let parsed: unknown = raw;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          return { ok: false, error: `Not valid JSON: ${(err as Error).message}` };
        }
      }
      // Field-specific shape checks.
      if (spec.path === 'providers') {
        if (!Array.isArray(parsed)) return { ok: false, error: 'Must be an array of providers.' };
        for (const [i, p] of parsed.entries()) {
          const o = p as Record<string, unknown>;
          if (typeof o?.id !== 'string' || o.id.length === 0) return { ok: false, error: `Provider ${i + 1}: id must be a non-empty string.` };
          if (typeof o.enabled !== 'boolean') return { ok: false, error: `Provider ${i + 1}: enabled must be true or false.` };
          if (!isInt(Number(o.priority)) || Number(o.priority) < 1) return { ok: false, error: `Provider ${i + 1}: priority must be a whole number ≥ 1.` };
          if (!isInt(Number(o.cooldownMs)) || Number(o.cooldownMs) < 0) return { ok: false, error: `Provider ${i + 1}: cooldownMs must be a whole number ≥ 0.` };
        }
        return { ok: true, value: parsed };
      }
      if (spec.path === 'compressor.glossary') {
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return { ok: false, error: 'Must be an object of long form → short alias.' };
        }
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v !== 'string') return { ok: false, error: `"${k}": the alias must be a string.` };
          if (k.trim().length === 0) return { ok: false, error: 'Keys cannot be empty.' };
        }
        return { ok: true, value: parsed };
      }
      if (spec.path === 'providers.custom') {
        if (!Array.isArray(parsed)) return { ok: false, error: 'Must be an array of providers.' };
        for (const [i, p] of parsed.entries()) {
          const o = p as Record<string, unknown>;
          const n = i + 1;
          if (typeof o?.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(o.id)) {
            return { ok: false, error: `Provider ${n}: id must be 2–32 chars of a-z, 0-9, - or _` };
          }
          if (typeof o.label !== 'string' || !o.label.trim()) return { ok: false, error: `Provider ${n}: label is required` };
          if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) {
            return { ok: false, error: `Provider ${n}: url must start with http:// or https://` };
          }
          const sel = o.selectors as { composer?: { primary?: string }; send?: { primary?: string } } | undefined;
          if (!sel?.composer?.primary) return { ok: false, error: `Provider ${n}: selectors.composer.primary is required` };
          if (!sel?.send?.primary) return { ok: false, error: `Provider ${n}: selectors.send.primary is required` };
        }
        return { ok: true, value: parsed };
      }
      if (spec.path === 'bridge.cdpPorts') {
        if (!Array.isArray(parsed) || parsed.length === 0) return { ok: false, error: 'Must be a non-empty array of ports.' };
        for (const p of parsed) {
          const n = Number(p);
          if (!isInt(n) || n < 1024 || n > 65535) return { ok: false, error: `${String(p)} is not a valid port (1024–65535).` };
        }
        return { ok: true, value: parsed.map(Number) };
      }
      return { ok: true, value: parsed };
    }
    default:
      return { ok: false, error: 'Unknown field type.' };
  }
}

/* ------------------------------------------------------------- read/write */

export type ConfigGetter = (key: string, dflt: unknown) => unknown;

/** Flat key → current value, defaulting per the table. */
export function flatValues(get: ConfigGetter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) out[f.key] = get(f.key, f.default);
  return out;
}

/** The nested §4 `Settings` object as currently configured. */
export function readSettings(get: ConfigGetter): Settings {
  const flat = flatValues(get);
  const v = (key: string) => flat[key];
  const base = DEFAULT_SETTINGS;

  const providers = Array.isArray(v('aiBridge.providers.list'))
    ? (v('aiBridge.providers.list') as Settings['providers'])
    : base.providers;

  return {
    ramCap: {
      browser: Number(v('aiBridge.ramCap.browser')),
      extension: Number(v('aiBridge.ramCap.extension')),
    },
    providers,
    router: {
      strategy: v('aiBridge.router.strategy') as Settings['router']['strategy'],
      retries: Number(v('aiBridge.router.retries')),
      backoff: v('aiBridge.router.backoff') as Settings['router']['backoff'],
    },
    compressor: {
      enabled: Boolean(v('aiBridge.compressor.enabled')),
      tier: v('aiBridge.compressor.tier') as Settings['compressor']['tier'],
      budgetTokens: Number(v('aiBridge.compressor.budgetTokens')),
      protectCode: true,
    },
    state: {
      location: v('aiBridge.state.location') as Settings['state']['location'],
      maxSnapshots: Number(v('aiBridge.state.maxSnapshots')),
      encrypt: Boolean(v('aiBridge.state.encrypt')),
    },
    ui: {
      statusBar: Boolean(v('aiBridge.ui.statusBar')),
      showCompressionPreview: Boolean(v('aiBridge.ui.showCompressionPreview')),
      lowEndMode: v('aiBridge.ui.lowEndMode') as Settings['ui']['lowEndMode'],
    },
    bridge: {
      port: Number(v('aiBridge.bridge.port')),
      autostart: Boolean(v('aiBridge.bridge.autostart')),
    },
  };
}

/**
 * The full nested view the panel works with: §4's `Settings` PLUS the extension
 * keys we have added (CDP ports, T1 knobs, watchdog poll…). `readSettings` stays
 * a strict §4 object; this one is explicitly a superset, built from the field
 * table so a new field appears here automatically.
 */
export function readAll(get: ConfigGetter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const deepSet = (obj: Record<string, unknown>, dotted: string, value: unknown) => {
    const parts = dotted.split('.');
    let node = obj;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]!] = value;
  };
  for (const f of FIELDS) deepSet(out, f.path, get(f.key, f.default));
  return out;
}

/** A valid value for a field that differs from its default — used by the tests. */
export function sampleValue(spec: FieldSpec): unknown {
  switch (spec.type) {
    case 'boolean':
      return !spec.default;
    case 'number': {
      const d = Number(spec.default);
      const candidate = spec.max !== undefined && d + (spec.step ?? 1) <= spec.max ? d + (spec.step ?? 1) : d - (spec.step ?? 1);
      return candidate;
    }
    case 'enum':
      return (spec.options ?? []).find((o) => o !== spec.default) ?? spec.default;
    case 'string':
      return `${String(spec.default)}-alt`;
    case 'json': {
      if (spec.path === 'providers') {
        return [{ id: 'chatgpt', enabled: true, priority: 1, cooldownMs: 60_000 }];
      }
      if (spec.path === 'bridge.cdpPorts') return [9333];
      if (spec.path === 'compressor.glossary') return { 'the extension host': 'EH' };
      if (spec.path === 'providers.custom') {
        return [
          {
            id: 'mychat',
            label: 'My Chat',
            url: 'https://mychat.example/',
            selectors: { composer: { primary: '#ask' }, send: { primary: '#go' } },
          },
        ];
      }
      return spec.default;
    }
    default:
      return spec.default;
  }
}
