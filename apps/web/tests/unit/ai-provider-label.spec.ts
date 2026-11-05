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
import { afterEach, describe, it, expect, vi } from 'vitest';
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

/**
 * The card used to say Connected on the strength of a model *listing*, while
 * every ONE AI question was failing: listing sends no tools, and the request
 * the assistant actually makes was never tried. These drive the two outcomes
 * through `verifyConnection` with the network stubbed — the wire translation
 * itself is covered against a real server in `ai-provider.spec.ts`.
 */
describe('a Gemini connection proves tool calling, not just a live key', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Google's own answers: a models list, then whatever `generateContent` gives. */
  const stubGoogle = (generateContent: { status: number; body: unknown }) =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(':generateContent')) {
        return new Response(JSON.stringify(generateContent.body), { status: generateContent.status });
      }
      return new Response(
        JSON.stringify({
          models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }],
        }),
        { status: 200 },
      );
    });

  it('refuses the connection when the assistant’s declarations are rejected', async () => {
    stubGoogle({
      status: 400,
      body: {
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message:
            'Invalid JSON payload received. GenerateContentRequest.tools[0].function_declarations[13].parameters.properties: should be non-empty for OBJECT type',
        },
      },
    });

    const verdict = await verifyConnection('gemini', { apiKey: 'AIzaSyTestKeyNotReal', provider: 'google' });

    expect(verdict.ok).toBe(false);
    // The key is not the problem, and the message must not send anyone to re-issue it.
    expect(verdict.detail).toContain('The key works');
    expect(verdict.detail).toContain('tool declarations');
    expect(verdict.detail).not.toMatch(/rejected the connected key|API key not valid/i);
    // The key itself never reaches the screen, whatever the vendor echoed.
    expect(verdict.detail).not.toContain('AIzaSyTestKeyNotReal');
  });

  it('says tool calling was verified when the real payload is accepted', async () => {
    stubGoogle({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } });

    const verdict = await verifyConnection('gemini', { apiKey: 'AIzaSyTestKeyNotReal', provider: 'google' });

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain('Tool calling verified');
  });
});
