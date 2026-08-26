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
    expect(getTranscriptionProvider('gemini', { apiKey: 'k' }).name).toBe('gemini');
  });

  it('matches the provider name the admin actually typed, whatever the casing', () => {
    expect(getTranscriptionProvider('Google', { apiKey: 'k' }).name).toBe('google');
    expect(getTranscriptionProvider(' Gemini ', { apiKey: 'k' }).name).toBe('gemini');
  });

  it('routes "Google" with a Gemini model to the generative API, not Cloud STT', () => {
    // A Gemini key posted to speech.googleapis.com fails with a 403 that reads
    // like a bad key — the connection the admin saved must select by intent.
    expect(getTranscriptionProvider('google', { apiKey: 'k', model: 'Gemini' }).name).toBe('gemini');
    expect(getTranscriptionProvider('google', { apiKey: 'k', model: 'gemini-2.0-flash' }).name).toBe('gemini');
    expect(getTranscriptionProvider('google', { apiKey: 'k', model: 'latest_long' }).name).toBe('google');
    expect(() => getTranscriptionProvider('gemini', {})).toThrow(/API key/);
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

/**
 * Numbers spoken as words.
 *
 * Every rule above matches digits, and a transcript is what somebody *said*.
 * Speech-to-text writes a card number read aloud the way it was read — "four two
 * four two, four two four two, …" — which contains not one digit and is a full
 * card number on its way to a third-party model.
 *
 * The file used to carry a note saying so and inviting somebody to fix it later.
 * A known hole in a redactor is not a note.
 */
describe('numbers read aloud', () => {
  it('redacts a card number spoken digit by digit', () => {
    const spoken =
      'so the card is four two four two four two four two four two four two four two four two, expiry oh three';
    const { text, counts } = redact(spoken);
    expect(text).not.toMatch(/four two four two/);
    expect(text).toContain('[REDACTED_CARD]');
    expect(counts.CARD).toBe(1);
  });

  it('redacts a phone number spoken digit by digit', () => {
    const { text, counts } = redact('call me on oh five oh one two three four five six');
    expect(text).toContain('[REDACTED_PHONE]');
    expect(counts.PHONE).toBe(1);
    expect(text).not.toMatch(/one two three four/);
  });

  it('understands "double" and "triple" the way people read numbers', () => {
    // "double seven" is 77 — how a UAE or UK number is read aloud. Without this
    // the run is two digits short and slips under the threshold.
    const { text } = redact('the number is oh five double two triple four one nine');
    expect(text).toContain('[REDACTED_');
    expect(text).not.toMatch(/double two/);
  });

  it('leaves the words in a sentence that merely counts', () => {
    // The threshold is what keeps ordinary speech out of it: nobody reads eight
    // consecutive digit-words aloud by accident.
    const prose = 'we tried one, two, three times and he said no on all three';
    expect(redact(prose).text).toBe(prose);
  });

  it('does not turn a price into a number to be redacted', () => {
    // "hundred", "fifty" and "thousand" are deliberately not digit-words:
    // converting them to digits would be inventing a number nobody said, and
    // testing that invention against Luhn is worse than useless.
    const prose = 'the unit is one hundred and fifty thousand dirhams, plus four percent';
    expect(redact(prose).text).toBe(prose);
  });

  it('stops a run at the first word that is not part of the number', () => {
    // Two short groups either side of ordinary speech must not join up into one
    // long "number" that trips the threshold.
    const prose = 'four two four two is what he said and then nine one nine one was the other one';
    const { text } = redact(prose);
    expect(text).toBe(prose);
  });

  it('leaves the transcript’s own words in place rather than rewriting them as digits', () => {
    // Redaction must not edit the record it is protecting: the surrounding
    // sentence has to survive verbatim, with only the number replaced.
    const { text } = redact(
      'he read out four two four two four two four two four two four two four two four two and hung up',
    );
    expect(text).toMatch(/^he read out \[REDACTED_CARD\] and hung up$/);
  });

  it('still catches a spoken number after a digit rule has already fired', () => {
    // A placeholder holds no digit-words, so an earlier substitution cannot be
    // swallowed by a later run — and the offsets of a second run must survive
    // the first replacement.
    const { text, counts } = redact(
      'email me at a@b.com or call oh five oh one two three four five six, card four two four two four two four two four two four two four two four two',
    );
    expect(counts.EMAIL).toBe(1);
    expect(text).toContain('[REDACTED_EMAIL]');
    expect(text).toContain('[REDACTED_PHONE]');
    expect(text).toContain('[REDACTED_CARD]');
  });
});
