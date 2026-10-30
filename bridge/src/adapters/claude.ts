/**
 * Claude adapter (claude.ai) — spec §5.3, §6.1.
 *
 * Selectors are written from claude.ai's DOM contract and verified against
 * `test/fixtures/assistant.html?flavor=claude`. Like the ChatGPT adapter they are
 * UNVERIFIED against the live site (it cannot be logged into from CI); run
 * `AI Bridge: Adapter Health` on a logged-in tab before trusting them.
 */

import type { Logger } from '../logger';
import { DomAdapter, type SelectorMap } from './domAdapter';

export const CLAUDE_SELECTORS: SelectorMap = {
  composer: {
    primary: 'div.ProseMirror[contenteditable="true"]',
    fallbacks: ['div[aria-label="Write your prompt to Claude"]', 'fieldset div[contenteditable="true"]'],
    accessibility: 'textbox[name="Write your prompt to Claude"]',
  },
  send: {
    primary: 'button[aria-label="Send Message"]',
    fallbacks: ['button[aria-label="Send message"]', 'button[type="submit"]'],
    accessibility: 'button[name="Send Message"]',
  },
  stop: {
    primary: 'button[aria-label="Stop Response"]',
    fallbacks: ['button[aria-label="Stop response"]'],
    accessibility: 'button[name="Stop Response"]',
  },
  assistantTurn: {
    primary: '[data-testid="assistant-message"]',
    fallbacks: ['.font-claude-message'],
    accessibility: null,
  },
  markdown: {
    primary: '.font-claude-message',
    fallbacks: ['.prose', '.markdown'],
    accessibility: null,
  },
  copySentinel: {
    primary: 'button[data-testid="action-bar-copy"]',
    fallbacks: ['button[aria-label="Copy"]'],
    accessibility: 'button[name="Copy"]',
  },
  streamingFlag: {
    primary: '[data-is-streaming="true"]',
    fallbacks: ['.animate-pulse'],
    accessibility: null,
  },
  limitBanner: {
    primary: '[data-testid="limit-reached"]',
    fallbacks: ['[role="alert"]'],
    accessibility: null,
  },
};

export class ClaudeAdapter extends DomAdapter {
  constructor(log: Logger) {
    super(
      {
        id: 'claude',
        label: 'Claude',
        url: process.env.AI_BRIDGE_CLAUDE_URL ?? 'https://claude.ai/new',
        selectors: CLAUDE_SELECTORS,
        limitPattern: /limit|reached|too many|try again|usage|upgrade/i,
      },
      log,
    );
  }
}
