import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseEnquiry, verifyDelivery } from '@/lib/integrations/leadSources';

const hmac = (secret: string, body: string) => createHmac('sha256', secret).update(body, 'utf8').digest('hex');

describe('verifyDelivery', () => {
  const body = '{"lead_id":"1"}';

  it('accepts the portal signature with or without the sha256= prefix, in either case', () => {
    const sig = hmac('s3cret', body);
    expect(verifyDelivery('bayut', 's3cret', body, {}, sig)).toBe(true);
    expect(verifyDelivery('bayut', 's3cret', body, {}, `sha256=${sig.toUpperCase()}`)).toBe(true);
  });

  it('refuses a missing, short or wrong signature, and any delivery when no secret is stored', () => {
    expect(verifyDelivery('bayut', 's3cret', body, {}, null)).toBe(false);
    expect(verifyDelivery('bayut', 's3cret', body, {}, 'abcd')).toBe(false);
    expect(verifyDelivery('bayut', 's3cret', body, {}, hmac('other', body))).toBe(false);
    expect(verifyDelivery('bayut', undefined, body, {}, hmac('s3cret', body))).toBe(false);
  });

  it('checks Google’s key in the body, not a signature', () => {
    expect(verifyDelivery('google_ads', 'k', body, { google_key: 'k' }, null)).toBe(true);
    expect(verifyDelivery('google_ads', 'k', body, { google_key: 'kk' }, null)).toBe(false);
    expect(verifyDelivery('google_ads', 'k', body, {}, null)).toBe(false);
  });
});

describe('parseEnquiry', () => {
  it('never takes the listing agent for the enquirer, whichever comes first', () => {
    const enquiry = parseEnquiry({
      agent: { name: 'Agent', phone: '0559999999', email: 'agent@x.test' },
      listing: { reference: 'L-1', agent: { name: 'Nested agent' } },
      client: { name: 'Client', mobile: '0501112233', email: 'C@X.test' },
    });
    expect(enquiry).toMatchObject({ fullName: 'Client', email: 'c@x.test', phones: ['0501112233'], reference: 'L-1' });
  });

  it('reads a flat camelCase body, and an id only from a key that names the lead', () => {
    const enquiry = parseEnquiry({ leadId: 'B-9', name: 'Sara', phoneNumber: '0502223344', referenceNumber: 'R-7' });
    expect(enquiry).toMatchObject({ externalId: 'B-9', fullName: 'Sara', reference: 'R-7' });
    expect(parseEnquiry({ id: 'evt-1', reference: 'R-7', name: 'Sara' }).externalId).toBeNull();
  });

  it('reads Google’s columns, joins first and last names, and flags a test lead', () => {
    const enquiry = parseEnquiry({
      lead_id: 'g-1',
      form_id: '42',
      is_test: true,
      user_column_data: [
        { column_id: 'FIRST_NAME', string_value: 'Omar' },
        { column_id: 'LAST_NAME', string_value: 'Saleh' },
        { column_id: 'PHONE_NUMBER', string_value: '+971507778899' },
        { column_id: 'PRICE_RANGE', string_value: '1–2M' },
      ],
    });
    expect(enquiry).toMatchObject({
      externalId: 'g-1',
      fullName: 'Omar Saleh',
      phones: ['+971507778899'],
      reference: '42',
      details: ['Budget: 1–2M'],
      isTest: true,
    });
  });
});
