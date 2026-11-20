/**
 * The Model box is checked against the provider's own catalogue.
 *
 * Production incident: a workspace stored the display name "Google Gemini" as
 * its OpenRouter model id and every ONE AI question answered 400 "not a valid
 * model ID" behind a Connected badge. Real fetch against a local server that
 * serves each vendor's catalogue shape; an outage must read as an outage.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkModel, describeCheck } from '@/lib/ai/catalogue';

let server: Server;
let down = false;
const seenAuth: (string | undefined)[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seenAuth.push(req.headers.authorization);
    if (down) return void res.writeHead(503).end('{"error":"maintenance"}');
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/api/v1/models')) {
      return void res.end(
        JSON.stringify({
          data: [
            { id: 'google/gemini-3.8-flash', name: 'Google: Gemini 3.8 Flash', supported_parameters: ['tools'] },
            { id: 'google/gemini-3.1-flash-image', name: 'Google: Gemini 3.1 Flash Image', supported_parameters: [] },
          ],
        }),
      );
    }
    if (req.url?.startsWith('/v1beta/models')) {
      return void res.end(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-flash-latest',
              displayName: 'Gemini Flash Latest',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/text-embedding-004',
              displayName: 'Embedding',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }),
      );
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv('AI_OPENROUTER_URL', `${base}/api/v1/chat/completions`);
  vi.stubEnv('AI_GOOGLE_BASE_URL', `${base}/v1beta/models`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((r) => server.close(r));
});

describe('checkModel', () => {
  it('refuses the display name that took ONE AI down, and offers the ids it names', async () => {
    const check = await checkModel('openrouter', 'Google Gemini', 'sk-or-v1-x');
    expect(check).toMatchObject({ ok: false, reason: 'unknown' });
    expect(check.ok === false && 'suggestions' in check && check.suggestions).toContain('google/gemini-3.8-flash');
    expect(describeCheck('openrouter', 'Google Gemini', check as never)).toContain('not a valid OpenRouter model id');
  });

  it('refuses an id that is not on the list', async () => {
    expect(await checkModel('openrouter', 'google/gemini-2.0-flash-001', 'k')).toMatchObject({
      ok: false,
      reason: 'unknown',
    });
  });

  it('refuses a listed model that cannot call tools', async () => {
    expect(await checkModel('openrouter', 'google/gemini-3.1-flash-image', 'k')).toMatchObject({
      ok: false,
      reason: 'no-tools',
    });
  });

  it('accepts a listed tool-capable id and returns its label separately', async () => {
    expect(await checkModel('openrouter', ' google/gemini-3.8-flash ', 'k')).toEqual({
      ok: true,
      model: { id: 'google/gemini-3.8-flash', label: 'Google: Gemini 3.8 Flash', tools: true },
    });
    expect(await checkModel('google', 'gemini-flash-latest', 'AIza-x')).toMatchObject({ ok: true });
    expect(await checkModel('google', 'Google Gemini', 'AIza-x')).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('reports a catalogue outage as an outage, not as a bad id', async () => {
    down = true;
    try {
      const check = await checkModel('openrouter', 'google/gemini-3.8-flash', 'k');
      expect(check).toMatchObject({ ok: false, reason: 'unavailable' });
      // Status only: the vendor body is not repeated.
      expect(JSON.stringify(check)).not.toContain('maintenance');
      expect(describeCheck('openrouter', 'x', check as never)).toContain('Nothing was changed');
    } finally {
      down = false;
    }
  });
});
