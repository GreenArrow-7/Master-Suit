/**
 * The Provider box on Settings → Intelligence is free text, and a human types
 * the vendor's own spelling of its name.
 *
 * A workspace saved "Open Router". Nothing normalised it, so every reader
 * compared it to the literal `'openrouter'`, failed, and fell through to
 * google: the OpenRouter key was checked against Google AI Studio, which calls
 * a perfectly good key invalid, and the connection sat in ERROR with a Model id
 * Google has never heard of. These assert the spelling no longer decides which
 * API the key is sent to.
 *
 * No network: both cases return before any request is made.
 */
import { describe, it, expect } from 'vitest';
import { aiProviderKey } from '@/lib/ai/provider';
import { verifyConnection } from '@/lib/integrations/verify';

describe('aiProviderKey', () => {
  it('reads the spellings a person actually types', () => {
    for (const typed of ['openrouter', 'OpenRouter', 'Open Router', ' open-router ', 'OPEN_ROUTER']) {
      expect(aiProviderKey(typed)).toBe('openrouter');
    }
    for (const typed of ['google', 'Google', ' GOOGLE ']) expect(aiProviderKey(typed)).toBe('google');
  });

  /**
   * Undefined rather than 'google'. A caller that silently resolved a typo to
   * google is how this defect reached production in the first place; the save
   * route refuses it and the runtime defaults deliberately.
   */
  it('does not guess at anything else', () => {
    for (const typed of ['openai', 'gemini', '', null, undefined, 42]) {
      expect(aiProviderKey(typed)).toBeUndefined();
    }
  });
});

describe('verifying a Gemini connection', () => {
  it('honours the vendor spelling instead of testing an OpenRouter key against Google', async () => {
    const verdict = await verifyConnection('gemini', { apiKey: 'sk-or-v1-notarealkey', provider: 'Open Router' });

    // The OpenRouter branch was reached: it is the only one that asks for a
    // model. Before the fix this said the key was an OpenRouter key while
    // Provider was google — about a connection whose Provider said otherwise.
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('no model is set');
  });

  it('still names a key that belongs to a different service', async () => {
    const verdict = await verifyConnection('gemini', { apiKey: 'sk-ant-notarealkey', provider: 'Google' });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('Anthropic');
  });

  it('reports an empty credential as empty', async () => {
    const verdict = await verifyConnection('gemini', { apiKey: '', provider: 'google' });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('No API key is saved');
  });
});
