/**
 * Batch 8.3 — a service request: one feature, one model, bounded.
 *
 * The consumer of `routing.ts`. Given a feature and a prompt it resolves the
 * model, sends the request down the right transport (an endpoint from batch 8.0
 * or a web chat in a tab), and clamps what comes back.
 *
 * Host-free: the bridge is injected, so a test drives it with a fake and the
 * extension supplies the real one.
 */

import {
  clampText,
  policyFor,
  resolveModel,
  type FeatureId,
  type RoutableModel,
} from './routing';

/** What a service request needs from the bridge. */
export interface ServiceBridge {
  /** An OpenAI-compatible endpoint. */
  askApi(modelId: string, prompt: string, opts: { maxTokens?: number }): Promise<string>;
  /** A web chat in the tab the user is signed in to. */
  askDom(adapterId: string, prompt: string): Promise<string>;
}

export interface ServiceResult {
  modelId: string;
  modelLabel: string;
  text: string;
  /** True when the cap shortened the answer. */
  clamped: boolean;
}

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/**
 * Runs one feature request.
 *
 * The model is resolved before the prompt is sent, so a missing or unfit model
 * is an error the user can act on rather than a request that fails opaquely
 * halfway through.
 */
export async function askFeature(
  bridge: ServiceBridge,
  models: readonly RoutableModel[],
  feature: FeatureId,
  setting: string,
  prompt: string,
): Promise<ServiceResult> {
  const resolution = resolveModel(models, feature, setting);
  if (!resolution.ok) throw new ServiceError(resolution.error.split(':')[0]!, resolution.error);

  const { model } = resolution;
  const policy = policyFor(feature);

  const raw =
    model.kind === 'api'
      ? await bridge.askApi(model.id, prompt, { maxTokens: policy.maxTokens })
      : await bridge.askDom(model.source, prompt);

  const text = clampText(raw ?? '', feature);
  return {
    modelId: model.id,
    modelLabel: model.label,
    text,
    clamped: text.length < (raw ?? '').trim().length,
  };
}
