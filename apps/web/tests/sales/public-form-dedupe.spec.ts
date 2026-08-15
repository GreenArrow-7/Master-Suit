import { describe, expect, it } from 'vitest';
import { utmFrom } from '@/services/leads/utm';

/**
 * The public form endpoint used to call `lead.create` unconditionally, so a
 * customer who enquired twice became two leads, and `FormSubmission.utm` was a
 * column nothing ever wrote. These pin the attribution half; the dedupe half is
 * now `findDuplicates`, which tests/sales already cover through createLead.
 */
describe('website enquiry attribution', () => {
  it('keeps the standard utm keys from the referring page', () => {
    expect(
      utmFrom('https://manathhomes.ae/villas?utm_source=instagram&utm_medium=social&utm_campaign=marina'),
    ).toEqual({ utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'marina' });
  });

  it('drops non-utm parameters rather than sweeping up click ids and addresses', () => {
    expect(utmFrom('https://manathhomes.ae/?utm_source=fb&fbclid=abc123&email=someone%40example.com')).toEqual({
      utm_source: 'fb',
    });
  });

  it('survives a missing or malformed referrer without failing the enquiry', () => {
    expect(utmFrom(null)).toEqual({});
    expect(utmFrom(undefined)).toEqual({});
    expect(utmFrom('not a url')).toEqual({});
  });

  it('truncates an oversized value rather than storing it whole', () => {
    const long = 'x'.repeat(500);
    expect(utmFrom(`https://manathhomes.ae/?utm_campaign=${long}`).utm_campaign).toHaveLength(200);
  });
});
