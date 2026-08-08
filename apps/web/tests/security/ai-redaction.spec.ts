import { describe, expect, it, vi } from 'vitest';
import { redact } from '@/lib/ai/redact';
import { getTranscriptionProvider, MockTranscriptionProvider } from '@/lib/integrations/transcription';

describe('transcript redaction before it reaches Gemini', () => {
  it('strips card numbers, secrets, emails and phone numbers', () => {
    const { text, counts } = redact(
      [
        'Client: my card is 4111 1111 1111 1111 and it expires soon.',
        'Agent: I will email the invoice to priya.sharma@acme.co.in today.',
        'Client: call me back on +91 98765 43210 tomorrow.',
        'Agent: the sandbox key is sk_live_9aZq82hdKlPo01ncTr4x for your team.',
        'Client: my account number is 100200300400.',
      ].join('\n'),
    );

    expect(text).not.toContain('4111');
    expect(text).not.toContain('priya.sharma@acme.co.in');
    expect(text).not.toContain('98765');
    expect(text).not.toContain('sk_live_9aZq82hdKlPo01ncTr4x');
    expect(text).not.toContain('100200300400');

    expect(counts.CARD).toBe(1);
    expect(counts.EMAIL).toBe(1);
    expect(counts.SECRET).toBe(1);
  });

  it('keeps the conversation readable so the summary is still useful', () => {
    const { text } = redact('Client: budget is 50000 rupees, we need it by March.');
    expect(text).toContain('budget is 50000 rupees');
    expect(text).toContain('by March');
  });

  it('does not call a 16-digit reference a card when it fails Luhn', () => {
    const { text, counts } = redact('Agent: your order reference is 1234567812345678.');
    // Still redacted — a long digit run is an identifier either way — but Luhn
    // keeps it out of the CARD bucket that drives PCI reporting.
    expect(text).not.toContain('1234567812345678');
    expect(counts.CARD).toBeUndefined();
  });

  it('redacts a long account number whole, never just its tail', () => {
    const { text } = redact('Client: the account is 100200300400500600.');
    expect(text).toMatch(/account is \[REDACTED_\w+\]\./);
  });
});

describe('transcription provider selection', () => {
  it('gives each tenant the provider their integration names', () => {
    expect(getTranscriptionProvider('google', { apiKey: 'k' }).name).toBe('google');
    expect(getTranscriptionProvider('deepgram', { apiKey: 'k' }).name).toBe('deepgram');
    expect(getTranscriptionProvider('whisper', { endpoint: 'https://stt.internal' }).name).toBe('whisper');
  });

  it('refuses a provider with no credentials rather than silently mocking', () => {
    expect(() => getTranscriptionProvider('google')).toThrow(/API key/);
    expect(() => getTranscriptionProvider('deepgram')).toThrow(/API key/);
    expect(() => getTranscriptionProvider('whisper')).toThrow(/endpoint/);
    expect(() => getTranscriptionProvider('nonesuch')).toThrow(/Unknown transcription provider/);
  });

  it('forbids the mock in production, where a fake transcript would reach the CRM as fact', () => {
    expect(getTranscriptionProvider('mock')).toBeInstanceOf(MockTranscriptionProvider);

    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(() => getTranscriptionProvider('mock')).toThrow(/forbidden in production/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
