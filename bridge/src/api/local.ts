/**
 * Batch 10.1 — find a model already running on this machine.
 *
 * The cheapest path this project can offer: no browser, no API key, no cloud, no
 * prompt leaving the machine. It matters most where there is no Copilot at all —
 * VSCodium ships none — but it is worth having everywhere, because a local model
 * costs 0 MB of browser RAM and 0 rupees.
 *
 * Discovery is a probe, not a guess: each known server is asked for its own model
 * list, and a server that does not answer is simply absent. Nothing is registered
 * without the user seeing it first.
 */

export interface LocalCandidate {
  /** Stable id, also used as the endpoint id. */
  id: string;
  /** What to show the user. */
  name: string;
  /** OpenAI-compatible base URL, ready for an endpoint entry. */
  baseUrl: string;
  /** Model ids the server reported. */
  models: string[];
  /** Always true for a local server. */
  noApiKey: true;
}

export interface DetectOptions {
  /** Ports to probe; defaults to the ones the common servers use. */
  ports?: number[];
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  host?: string;
}

/** The servers worth asking, in the order they are probed. */
const KNOWN = [
  { id: 'ollama', name: 'Ollama (local)', port: 11434, kind: 'ollama' as const },
  { id: 'lmstudio', name: 'LM Studio (local)', port: 1234, kind: 'openai' as const },
  { id: 'llamacpp', name: 'llama.cpp server (local)', port: 8080, kind: 'openai' as const },
  { id: 'vllm', name: 'vLLM (local)', port: 8000, kind: 'openai' as const },
];

async function getJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    // Not running, or not this kind of server. Both mean "skip it".
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Model ids out of an OpenAI-style `{ data: [{ id }] }` body. */
function openAiModels(body: unknown): string[] {
  const data = (body as { data?: Array<{ id?: unknown }> } | undefined)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
    .filter((id) => id.length > 0);
}

/** Model ids out of Ollama's `{ models: [{ name }] }` body. */
function ollamaModels(body: unknown): string[] {
  const models = (body as { models?: Array<{ name?: unknown }> } | undefined)?.models;
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) => (typeof entry?.name === 'string' ? entry.name : ''))
    .filter((id) => id.length > 0);
}

/**
 * Probes the known local servers and returns the ones that answered with at least
 * one model.
 *
 * `ports` means "probe exactly these" rather than "filter the known list" — the
 * first version filtered, so a server on a custom port was silently skipped while
 * the caller believed it had been checked.
 *
 * A server that answers but reports no models is deliberately *not* returned: an
 * empty endpoint is worse than none, because it looks configured and then fails at
 * the first prompt.
 */
export async function detectLocalModels(options: DetectOptions = {}): Promise<LocalCandidate[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1500;
  const host = options.host ?? '127.0.0.1';

  const targets: Array<{ port: number; known?: (typeof KNOWN)[number] }> = options.ports
    ? options.ports.map((port) => ({ port, known: KNOWN.find((entry) => entry.port === port) }))
    : KNOWN.map((entry) => ({ port: entry.port, known: entry }));

  const results = await Promise.all(
    targets.map(async ({ port, known }): Promise<LocalCandidate | undefined> => {
      const base = `http://${host}:${port}`;
      const kind = known?.kind ?? 'unknown';

      let models: string[] = [];
      let answeredNative = false;

      if (kind === 'ollama' || kind === 'unknown') {
        // Ollama's native API first — the one it has always had. Which endpoint
        // answers is what identifies the server, so a custom port still gets the
        // right name instead of a generic one.
        models = ollamaModels(await getJson(`${base}/api/tags`, fetchImpl, timeoutMs));
        answeredNative = models.length > 0;
      }
      if (models.length === 0) {
        // Every one of these serves the OpenAI-compatible path.
        models = openAiModels(await getJson(`${base}/v1/models`, fetchImpl, timeoutMs));
      }

      if (models.length === 0) return undefined;

      return {
        id: answeredNative ? 'ollama' : (known?.id ?? `local-${port}`),
        name: answeredNative ? 'Ollama (local)' : (known?.name ?? `Local model (port ${port})`),
        baseUrl: `${base}/v1`,
        models: models.sort(),
        noApiKey: true,
      };
    }),
  );

  return results.filter((entry): entry is LocalCandidate => entry !== undefined);
}

/** The endpoint entry to write into settings for a discovered server. */
export function toEndpoint(candidate: LocalCandidate): Record<string, unknown> {
  return {
    id: candidate.id,
    name: candidate.name,
    baseUrl: candidate.baseUrl,
    noApiKey: true,
    models: candidate.models,
    toolCalling: true,
    imageInput: false,
  };
}
