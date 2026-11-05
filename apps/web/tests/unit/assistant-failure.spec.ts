import { describe, expect, it } from 'vitest';

import { assistantFailure } from '@/lib/ai/assistant/service';
import { Forbidden } from '@/lib/errors';

/**
 * The assistant reported every failure as "temporarily unavailable": a budget
 * ceiling, a rejected key and a retired model were indistinguishable from an
 * outage, so the feature could not be diagnosed from the UI at all.
 */
describe('assistantFailure', () => {
  it('shows a budget refusal as written rather than as an outage', () => {
    const err = Forbidden('This workspace has used its monthly AI allowance (10,000 tokens).');
    expect(assistantFailure(err, 403, err.message)).toBe(
      'This workspace has used its monthly AI allowance (10,000 tokens).',
    );
  });

  it('names a rejected key, and points at where it is set', () => {
    const msg = assistantFailure(new Error('AI provider error 401 — x'), 401, 'AI provider error 401 — x');
    expect(msg).toMatch(/rejected the connected key/);
    expect(msg).toMatch(/Integrations/);
  });

  it('names an unknown model separately from a bad key', () => {
    expect(assistantFailure(new Error('x'), 404, 'x')).toMatch(/does not know the configured model/);
  });

  it('distinguishes a provider outage from a client-side mistake', () => {
    expect(assistantFailure(new Error('x'), 503, 'x')).toMatch(/having an outage/);
    const malformed = assistantFailure(new Error('x'), 400, 'x');
    expect(malformed).toMatch(/rejected the request as malformed/);
    // A 400 is Google's answer to a bad payload *and* to an invalid key, so it
    // must not accuse either one; the log line behind the ref decides.
    expect(malformed).not.toMatch(/key/i);
    expect(malformed).toMatch(/server log/);
  });

  it('reports a timeout as a timeout', () => {
    expect(
      assistantFailure(
        new Error('The operation was aborted due to timeout'),
        undefined,
        'The operation was aborted due to timeout',
      ),
    ).toMatch(/did not answer in time/);
  });

  it('never leaks the provider body into the message', () => {
    const body = 'AI provider error 400 — {"error":{"message":"API key AIzaSyFAKE not valid"}}';
    expect(assistantFailure(new Error(body), 400, body)).not.toMatch(/AIzaSy/);
  });

  it('falls back to the generic message when nothing identifies the cause', () => {
    expect(assistantFailure(new Error('boom'), undefined, 'boom')).toMatch(/temporarily unavailable/);
  });
});
