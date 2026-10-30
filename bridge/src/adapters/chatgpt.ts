/**
 * ChatGPT adapter (chatgpt.com) — spec §5.3, §5.4, §5.9.
 *
 * A selector map over the shared `DomAdapter`, the same way Claude and Gemini are
 * built. This file used to carry its own copy of the resolution chain, the
 * observer wiring and the limit parsing; migrating it removed ~200 duplicated
 * lines without changing behaviour, which the 21 contract checks confirm.
 *
 * IMPORTANT: these selectors are written from ChatGPT's public DOM contract and
 * verified against `test/fixtures/chatgpt.html`. They are NOT verified against the
 * live site — run `AI Bridge: Adapter Health` on a logged-in tab before trusting
 * them.
 */

import type { Logger } from '../logger';
import { DomAdapter, type SelectorMap } from './domAdapter';

export const CHATGPT_SELECTORS: SelectorMap = {
  composer: {
    primary: '#prompt-textarea',
    fallbacks: [
      'textarea[data-id="root"]',
      'div[contenteditable="true"][data-virtualkeyboard="true"]',
      'div.ProseMirror[contenteditable="true"]',
    ],
    accessibility: 'textbox[name="Message ChatGPT"]',
  },
  send: {
    primary: '[data-testid="send-button"]',
    fallbacks: ['button[aria-label="Send prompt"]', 'button[data-testid="composer-send-button"]'],
    accessibility: 'button[name="Send prompt"]',
  },
  stop: {
    primary: '[data-testid="stop-button"]',
    fallbacks: ['button[aria-label="Stop streaming"]', 'button[aria-label="Stop generating"]'],
    accessibility: 'button[name="Stop streaming"]',
  },
  assistantTurn: {
    primary: '[data-message-author-role="assistant"]',
    fallbacks: ['article[data-testid^="conversation-turn"] .agent-turn', '.agent-turn'],
    accessibility: null,
  },
  markdown: {
    primary: '.markdown',
    fallbacks: ['.prose', '[class*="markdown"]'],
    accessibility: null,
  },
  copySentinel: {
    primary: 'button[data-testid="copy-turn-action-button"]',
    fallbacks: ['button[aria-label="Copy"]', 'button[data-testid="copy-button"]'],
    accessibility: 'button[name="Copy"]',
  },
  streamingFlag: {
    primary: '.result-streaming',
    fallbacks: ['.animate-pulse', '[aria-busy="true"]'],
    accessibility: null,
  },
  limitBanner: {
    primary: '[data-testid="modal-no-auth-rate-limit"]',
    fallbacks: ['[role="alert"]', '.text-token-text-error'],
    accessibility: null,
  },
};

export class ChatGptAdapter extends DomAdapter {
  constructor(log: Logger) {
    super(
      {
        id: 'chatgpt',
        label: 'ChatGPT',
        /** Overridable so contract tests can point at a fixture (and mirrors work). */
        url: process.env.AI_BRIDGE_CHATGPT_URL ?? 'https://chatgpt.com/',
        selectors: CHATGPT_SELECTORS,
        limitPattern: /limit|reached|too many|try again|usage cap|upgrade/i,
      },
      log,
    );
  }
}
