/**
 * Provider-side compressor — spec §5.6's "T2 (opt-in provider-side)".
 *
 * Instead of a local model, this asks the provider you are already logged into to
 * rewrite the prompt. It is the cheapest tier to run (no RAM, no download) and the
 * most expensive in quota, which is exactly why it is opt-in.
 *
 * It is a `T1Backend`, so it inherits the same guards as every other T1 backend:
 * identifiers must survive, protected spans must survive, and the result must be
 * shorter — otherwise the T0 output is used.
 *
 * `send` is injected so the transport stays in the extension: the caller opens a
 * throwaway tab, sends, and closes it, so the user's real conversation is never
 * polluted by compression chatter.
 */

import type { T1Backend } from './t1';

export const T2_INSTRUCTION = [
  'Rewrite the request below to be as short as possible.',
  'Rules:',
  '- Keep every identifier, function name, constant, file path, URL and code block byte-identical.',
  '- Keep every "must", "never", "do not" and numeric value.',
  '- Do not answer the request. Output only the rewritten request, nothing else.',
  '',
  '--- REQUEST ---',
].join('\n');

export class ProviderCompressor implements T1Backend {
  readonly name = 'provider';
  readonly footprint = 'external' as const;

  constructor(
    private readonly send: (prompt: string) => Promise<string>,
    private readonly log?: (level: 'info' | 'warn' | 'error', msg: string) => void,
  ) {}

  /** Available whenever the caller can send — i.e. when the bridge is attached. */
  async available(): Promise<boolean> {
    return true;
  }

  async compress(text: string, opts: { budgetTokens: number; timeoutMs?: number }): Promise<string> {
    const out = (await this.send(`${T2_INSTRUCTION}\n${text}\n--- END ---`)).trim();
    if (!out) throw new Error('ET2EMPTY: the provider returned nothing');
    // Providers like to add a preamble; keep only the rewritten request.
    const fenced = /```[a-z]*\n([\s\S]*?)```/i.exec(out);
    const body = (fenced ? fenced[1]! : out).trim();
    this.log?.('info', `T2 (provider): ${text.length} → ${body.length} chars`);
    return body;
  }
}
