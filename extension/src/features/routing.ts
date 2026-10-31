/**
 * Batch 8.3 — per-feature model routing.
 *
 * Adapted in shape from the feature/model split in `src/vscode/ModelPicker.ts`
 * and the service requests in `CommitMessageGenerator.ts` of
 * AppsGanin/ai-free-vscode (MIT, commit 6f53bad).
 * See docs/batch8/attribution.md.
 *
 * The economics this encodes: on a free tier the strong model's daily allowance
 * is the scarce thing. A commit subject and a one-line fix do not need it, and
 * spending it there is how a day runs out before the work that needed it.
 *
 * Host-free and pure — every rule here is testable without an editor, which is
 * the point of separating it from the command that calls it.
 */

/** The four things a model can be asked to do. */
export type FeatureId = 'chat' | 'commit' | 'suggestions' | 'fix';

export const FEATURES: readonly FeatureId[] = ['chat', 'commit', 'suggestions', 'fix'] as const;

/**
 * A model as the router sees it.
 *
 * Deliberately not `ModelInfo` from `shared/src/types.ts`: that contract is
 * frozen, and this needs `kind`, `source` and fit flags that the picker does not.
 */
export interface RoutableModel {
  id: string;
  label: string;
  /** Free-tier models are preferred for service requests. */
  isFree: boolean;
  /** `api` is an endpoint from batch 8.0; `dom` is a web chat in a tab. */
  kind: 'api' | 'dom';
  /** The endpoint id, or the adapter id. */
  source: string;
  /** Fit flags. Absent means fit for everything. */
  capabilities?: Partial<Record<FeatureId | 'thinking', boolean>>;
}

export interface FeaturePolicy {
  /** Cap on generated characters; 0 means unbounded. */
  maxChars: number;
  /** Cap passed to the transport, where it takes one. */
  maxTokens: number;
  /** Reasoning, on or off. */
  thinking: boolean;
}

/**
 * Per-feature limits.
 *
 * `chat` is the only feature that wants reasoning: a commit subject and a ghost
 * line are neither improved by it nor worth the latency on a slow free backend.
 * The caps are what keep a slow tier usable — an unbounded request is a hung
 * editor, and on a metered tier it is also a hung editor that costs quota.
 */
export const FEATURE_POLICIES: Record<FeatureId, FeaturePolicy> = {
  chat: { maxChars: 0, maxTokens: 8_192, thinking: true },
  commit: { maxChars: 400, maxTokens: 200, thinking: false },
  suggestions: { maxChars: 600, maxTokens: 160, thinking: false },
  fix: { maxChars: 4_000, maxTokens: 900, thinking: false },
};

export function policyFor(feature: FeatureId): FeaturePolicy {
  return FEATURE_POLICIES[feature];
}

/** Is this model allowed to serve this feature? */
export function isFit(model: RoutableModel, feature: FeatureId): boolean {
  const flag = model.capabilities?.[feature];
  // Absent means "no opinion", which means fit — a model is not excluded by
  // silence, only by an explicit false.
  return flag !== false;
}

export type Resolution =
  | { ok: true; model: RoutableModel; reason: 'pinned' | 'free' | 'first-fit' }
  | { ok: false; error: string };

/**
 * Picks the model for a feature.
 *
 * `setting` is either an explicit model id or `auto`. Under `auto` a free model
 * wins, then declaration order — so the cheap tier absorbs the chores and the
 * strong model is left for chat.
 */
export function resolveModel(
  models: readonly RoutableModel[],
  feature: FeatureId,
  setting: string,
): Resolution {
  const wanted = (setting ?? 'auto').trim();
  const usable = models.filter((model) => isFit(model, feature));

  if (wanted && wanted !== 'auto') {
    const pinned = models.find((model) => model.id === wanted);
    if (!pinned) {
      return {
        ok: false,
        error: `ENOMODEL: "${wanted}" is not available — pick another, or set the model to "auto"`,
      };
    }
    if (!isFit(pinned, feature)) {
      return {
        ok: false,
        error: `ENOTFIT: "${wanted}" is not offered for ${feature} — pick another, or set it to "auto"`,
      };
    }
    return { ok: true, model: pinned, reason: 'pinned' };
  }

  if (usable.length === 0) {
    return {
      ok: false,
      error: `ENOMODEL: no model is available for ${feature} — sign in to a provider or add an endpoint`,
    };
  }

  const free = usable.find((model) => model.isFree);
  if (free) return { ok: true, model: free, reason: 'free' };
  return { ok: true, model: usable[0]!, reason: 'first-fit' };
}

/**
 * Trims generated text to the feature's cap, on a word boundary where one is
 * near the cut.
 *
 * A truncated commit subject that ends mid-word looks like a bug in the model;
 * cutting at the last space looks like a short subject.
 */
export function clampText(text: string, feature: FeatureId): string {
  const limit = policyFor(feature).maxChars;
  const trimmed = text.trim();
  if (!limit || trimmed.length <= limit) return trimmed;

  const window = trimmed.slice(0, limit);
  const boundary = window.lastIndexOf(' ');
  // Only fall back to a hard cut when the boundary is unreasonably early.
  const cut = boundary > limit * 0.6 ? window.slice(0, boundary) : window;
  return cut.trimEnd();
}

/** Whether a service request should ask for reasoning. */
export function thinkingFor(feature: FeatureId): boolean {
  return policyFor(feature).thinking;
}

/** The settings key a feature's model selection lives under. */
export function settingKey(feature: FeatureId): string {
  return `features.${feature}.model`;
}
