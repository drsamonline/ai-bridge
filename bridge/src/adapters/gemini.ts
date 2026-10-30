/**
 * Gemini adapter (gemini.google.com) — spec §5.3, §6.1.
 *
 * Same caveat as Claude and ChatGPT: written from the DOM contract, verified
 * against `test/fixtures/assistant.html?flavor=gemini`, NOT against the live site.
 */

import type { Logger } from '../logger';
import { DomAdapter, type SelectorMap } from './domAdapter';

export const GEMINI_SELECTORS: SelectorMap = {
  composer: {
    primary: 'rich-textarea .ql-editor[contenteditable="true"]',
    fallbacks: ['div[contenteditable="true"][aria-label="Enter a prompt here"]', 'rich-textarea [contenteditable="true"]'],
    accessibility: 'textbox[name="Enter a prompt here"]',
  },
  send: {
    primary: 'button.send-button',
    fallbacks: ['button[aria-label="Send message"]', 'button[mattooltip="Send message"]'],
    accessibility: 'button[name="Send message"]',
  },
  stop: {
    primary: 'button[aria-label="Stop response"]',
    fallbacks: ['.stop-icon', 'button[mattooltip="Stop response"]'],
    accessibility: 'button[name="Stop response"]',
  },
  assistantTurn: {
    primary: 'model-response',
    fallbacks: ['.model-response-text', 'message-content'],
    accessibility: null,
  },
  markdown: {
    primary: '.model-response-text .markdown',
    fallbacks: ['.model-response-text', '.markdown'],
    accessibility: null,
  },
  copySentinel: {
    primary: 'copy-button button',
    fallbacks: ['button[aria-label="Copy"]'],
    accessibility: 'button[name="Copy"]',
  },
  streamingFlag: {
    primary: '.streaming',
    fallbacks: ['[aria-busy="true"]'],
    accessibility: null,
  },
  limitBanner: {
    primary: '.limit-reached',
    fallbacks: ['[role="alert"]'],
    accessibility: null,
  },
};

export class GeminiAdapter extends DomAdapter {
  constructor(log: Logger) {
    super(
      {
        id: 'gemini',
        label: 'Gemini',
        url: process.env.AI_BRIDGE_GEMINI_URL ?? 'https://gemini.google.com/app',
        selectors: GEMINI_SELECTORS,
        limitPattern: /limit|reached|too many|try again|quota|upgrade/i,
      },
      log,
    );
  }
}
