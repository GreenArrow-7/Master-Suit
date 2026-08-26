import { describe, expect, it } from 'vitest';
import { normalizeMetaWebhook } from '@/lib/integrations/meta/events';

/**
 * Payload shapes taken from the current Meta documentation, not from memory:
 *   developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
 *   developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */

const leadgen = {
  object: 'page',
  entry: [
    {
      id: 153125381133,
      time: 1438292065,
      changes: [
        {
          field: 'leadgen',
          value: {
            leadgen_id: 123123123123,
            page_id: 123123123,
            form_id: 12312312312,
            adgroup_id: 12312312312,
            ad_id: 999,
            created_time: 1440120384,
          },
        },
      ],
    },
  ],
};

const inbound = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '9876' },
            contacts: [{ profile: { name: 'Sheena Nelson' }, wa_id: '16505551234' }],
            messages: [
              {
                from: '16505551234',
                id: 'wamid.ABC',
                timestamp: '1749416383',
                type: 'text',
                text: { body: 'Does it come in another color?' },
              },
            ],
          },
        },
      ],
    },
  ],
};

const statuses = (status: string) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '9876' },
            statuses: [{ id: 'wamid.ABC', status, timestamp: '1750263773', recipient_id: '16505551234' }],
          },
        },
      ],
    },
  ],
});

describe('Meta webhook normalisation', () => {
  it('turns a Lead Ads notification into LEAD_CREATED with its attribution', () => {
    const [event] = normalizeMetaWebhook(leadgen);
    expect(event).toMatchObject({
      kind: 'LEAD_CREATED',
      externalId: 'leadgen:123123123123',
      lead: { leadgenId: '123123123123', formId: '12312312312', adId: '999', adgroupId: '12312312312' },
    });
    expect(event!.occurredAt).toEqual(new Date(1440120384 * 1000));
  });

  /**
   * The webhook carries ad and ad-set ids but no campaign id. §8 asks for
   * campaign attribution, so this pins the gap: it must come from a follow-up
   * Graph call, and nobody should go looking for it in the payload.
   */
  it('does not invent a campaign id the payload does not carry', () => {
    const [event] = normalizeMetaWebhook(leadgen);
    expect(event!.lead).not.toHaveProperty('campaignId');
  });

  it('reads an inbound text message, its sender and the profile name', () => {
    const [event] = normalizeMetaWebhook(inbound);
    expect(event).toMatchObject({
      kind: 'MESSAGE_RECEIVED',
      externalId: 'wamid.ABC',
      threadId: '16505551234',
      displayName: 'Sheena Nelson',
      text: 'Does it come in another color?',
      assetId: '9876',
    });
  });

  it('reports sent as sent, not as delivered', () => {
    expect(normalizeMetaWebhook(statuses('sent'))[0]).toMatchObject({
      kind: 'MESSAGE_SENT',
      status: 'SENT',
    });
    expect(normalizeMetaWebhook(statuses('delivered'))[0]).toMatchObject({ kind: 'MESSAGE_DELIVERED' });
    expect(normalizeMetaWebhook(statuses('read'))[0]).toMatchObject({ kind: 'MESSAGE_READ' });
  });

  /**
   * One message legitimately produces sent, delivered and read against the same
   * wamid. Keying idempotency on the message id alone would drop two of the
   * three and freeze the UI on whichever arrived first.
   */
  it('keys each status of one message distinctly so none are swallowed as duplicates', () => {
    const ids = ['sent', 'delivered', 'read'].map((s) => normalizeMetaWebhook(statuses(s))[0]!.externalId);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(['wamid.ABC:SENT', 'wamid.ABC:DELIVERED', 'wamid.ABC:READ']);
  });

  /**
   * Meta retries anything that is not a 2xx, so a throw here would turn one bad
   * delivery into an indefinite retry loop.
   */
  it('never throws on malformed, empty or hostile payloads', () => {
    for (const payload of [null, undefined, {}, { entry: 'not-an-array' }, { entry: [{}] }, 42, '']) {
      expect(() => normalizeMetaWebhook(payload)).not.toThrow();
      expect(normalizeMetaWebhook(payload)).toEqual([]);
    }
  });

  it('skips messages missing an id or a sender rather than storing half an event', () => {
    const broken = structuredClone(inbound) as typeof inbound;
    // @ts-expect-error deliberately removing a required field
    delete broken.entry[0].changes[0].value.messages[0].from;
    expect(normalizeMetaWebhook(broken)).toEqual([]);
  });

  it('ignores fields it does not handle instead of guessing at them', () => {
    const comments = structuredClone(leadgen) as typeof leadgen;
    comments.entry[0]!.changes[0]!.field = 'feed';
    expect(normalizeMetaWebhook(comments)).toEqual([]);
  });
});
