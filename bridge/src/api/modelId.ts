/**
 * Batch 8.0 — model-id namespacing.
 *
 * The scheme is upstream's (`src/providers/openai/customConfig.ts`, MIT): a model
 * of a configured endpoint is `custom:<providerId>/<upstreamId>`, so `gpt-4o-mini`
 * on two endpoints stays two distinct models in one picker.
 *
 * Kept in its own module because both the client and the registry need it, and a
 * shared constant in either of those would make them import each other.
 */

export const MODEL_PREFIX = 'custom:' as const;

export function toApiModelId(providerId: string, upstreamId: string): string {
  return `${MODEL_PREFIX}${providerId}/${upstreamId}`;
}

/**
 * Splits a namespaced id back apart. Upstream ids may contain `/` themselves
 * (`meta-llama/Llama-3.3-70B`), so only the FIRST slash separates.
 */
export function fromApiModelId(
  modelId: string,
): { providerId: string; upstreamId: string } | undefined {
  if (!modelId.startsWith(MODEL_PREFIX)) return undefined;
  const rest = modelId.slice(MODEL_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return undefined;
  return { providerId: rest.slice(0, slash), upstreamId: rest.slice(slash + 1) };
}
