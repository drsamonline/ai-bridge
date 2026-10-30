/**
 * Adapter registry — spec §5.3 ("Lazy import()").
 *
 * Adapters are loaded on first use, not at bridge start, so an unused provider
 * costs nothing and a broken adapter cannot stop the bridge from booting.
 */

import type { Adapter } from '@ai-bridge/shared';
import type { Logger } from '../logger';

interface Entry {
  id: string;
  label: string;
  url: string;
  load: () => Promise<Adapter>;
}

export class AdapterRegistry {
  /** Providers added at runtime from user configuration (§1: "any provider"). */
  private readonly custom = new Map<string, { label: string; url: string; config: unknown }>();
  private readonly loaded = new Map<string, Adapter>();
  private readonly entries: Entry[];

  constructor(private readonly log: Logger) {
    this.entries = [
      {
        id: 'chatgpt',
        label: 'ChatGPT',
        url: process.env.AI_BRIDGE_CHATGPT_URL ?? 'https://chatgpt.com/',
        load: async () => {
          const { ChatGptAdapter } = await import('./chatgpt');
          return new ChatGptAdapter(this.log.child('chatgpt'));
        },
      },
      {
        id: 'claude',
        label: 'Claude',
        url: process.env.AI_BRIDGE_CLAUDE_URL ?? 'https://claude.ai/new',
        load: async () => {
          const { ClaudeAdapter } = await import('./claude');
          return new ClaudeAdapter(this.log.child('claude'));
        },
      },
      {
        id: 'gemini',
        label: 'Gemini',
        url: process.env.AI_BRIDGE_GEMINI_URL ?? 'https://gemini.google.com/app',
        load: async () => {
          const { GeminiAdapter } = await import('./gemini');
          return new GeminiAdapter(this.log.child('gemini'));
        },
      },
    ];
  }

  /** Register (or replace) the user-configured providers. */
  setCustom(configs: unknown[]): Array<{ id: string; label: string; url: string }> {
    this.custom.clear();
    for (const raw of configs) {
      const v = raw as { id?: string; label?: string; url?: string };
      if (typeof v?.id !== 'string' || typeof v?.url !== 'string') continue;
      this.custom.set(v.id, { label: v.label ?? v.id, url: v.url, config: raw });
      this.loaded.delete(v.id);
    }
    return this.list();
  }

  getCustom(id: string): unknown {
    return this.custom.get(id)?.config ?? null;
  }

  list(): Array<{ id: string; label: string; url: string; loaded: boolean }> {
    const custom = [...this.custom.entries()].map(([id, c]) => ({
      id,
      label: c.label,
      url: c.url,
      loaded: this.loaded.has(id),
    }));
    return [
      ...custom,
      ...this.entries.map((e) => ({
        id: e.id,
        label: e.label,
        url: e.url,
        loaded: this.loaded.has(e.id),
      })),
    ];
  }

  has(id: string): boolean {
    return this.entries.some((e) => e.id === id);
  }

  async get(id: string): Promise<Adapter> {
    const cached = this.loaded.get(id);
    if (!cached) {
      const custom = this.custom.get(id);
      if (custom) {
        const { CustomAdapter } = await import('./custom');
        const adapter = new CustomAdapter(custom.config as never, this.log.child(id));
        this.loaded.set(id, adapter);
        return adapter;
      }
    }
    if (cached) return cached;
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) {
      throw new Error(
        `ENOADAPTER: no adapter "${id}" — known: ${this.entries.map((e) => e.id).join(', ')}`,
      );
    }
    this.log.info(`lazy-loading adapter ${id}`);
    const adapter = await entry.load();
    this.loaded.set(id, adapter);
    return adapter;
  }
}
