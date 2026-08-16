import { describe, expect, it } from 'vitest';
import {
  normalizeSocialComment,
  normalizeFacebookComment,
  normalizeInstagramComment,
} from '@/lib/integrations/meta/comments';
import { qualifyComment } from '@/services/social/qualify';

/**
 * Payload shapes from the current Meta reference, not from memory:
 *   developers.facebook.com/docs/graph-api/webhooks/reference/page      (feed)
 *   developers.facebook.com/docs/graph-api/webhooks/reference/instagram (comments)
 */

const fbComment = {
  item: 'comment',
  verb: 'add',
  comment_id: '1234_5678',
  post_id: '1234_9999',
  from: { id: '100000123456789', name: 'Ahmed Rahman' },
  message: 'Interested in 2BR. Please contact me.',
  created_time: 1786900000,
  parent_id: '1234_9999',
};

const igComment = {
  id: '17890000000000000',
  text: 'Can you send me the payment plan?',
  timestamp: 1786900000,
  from: { id: 'ig-scoped-987', username: 'priya.k' },
  media: { id: 'media-marina-1', media_product_type: 'REELS', ad_id: 'ad-77', ad_title: 'Marina Vista Launch' },
};

describe('Meta comment normalisation', () => {
  it('reads a Facebook Page comment, including the lifecycle verb', () => {
    expect(normalizeSocialComment('feed', fbComment)).toMatchObject({
      provider: 'facebook',
      providerCommentId: '1234_5678',
      providerAuthorId: '100000123456789',
      authorName: 'Ahmed Rahman',
      commentText: 'Interested in 2BR. Please contact me.',
      providerMediaId: '1234_9999',
      verb: 'add',
    });
  });

  it('reads an Instagram comment, including its ad attribution', () => {
    expect(normalizeSocialComment('comments', igComment)).toMatchObject({
      provider: 'instagram',
      providerCommentId: '17890000000000000',
      providerAuthorId: 'ig-scoped-987',
      authorName: 'priya.k',
      providerMediaId: 'media-marina-1',
      mediaType: 'REELS',
      providerAdId: 'ad-77',
      providerAdTitle: 'Marina Vista Launch',
    });
  });

  /**
   * Instagram does not report edits or deletions, so `verb` must stay undefined
   * there rather than being invented to match Facebook's shape.
   */
  it('does not invent a lifecycle Instagram never reports', () => {
    expect(normalizeSocialComment('comments', igComment)!.verb).toBeUndefined();
  });

  /** The `feed` field also carries posts, likes, shares and reactions. */
  it('ignores Page feed changes that are not comments', () => {
    expect(normalizeSocialComment('feed', { ...fbComment, item: 'like' })).toBeNull();
    expect(normalizeSocialComment('feed', { ...fbComment, item: 'post' })).toBeNull();
  });

  it('never invents an author when Meta supplied none', () => {
    const anon = normalizeSocialComment('comments', { ...igComment, from: undefined })!;
    expect(anon.providerAuthorId).toBeUndefined();
    expect(anon.authorName).toBeUndefined();
    expect(anon.commentText).toBe('Can you send me the payment plan?');
  });

  it('skips a comment with no id or no text rather than storing half a record', () => {
    expect(normalizeFacebookComment({ ...fbComment, comment_id: undefined })).toBeNull();
    expect(normalizeInstagramComment({ ...igComment, text: '' })).toBeNull();
  });

  it('never throws on malformed or hostile payloads', () => {
    for (const value of [{}, { item: 'comment' }, { from: 'not-an-object' }, { media: 42 }]) {
      expect(() => normalizeSocialComment('feed', value as never)).not.toThrow();
      expect(() => normalizeSocialComment('comments', value as never)).not.toThrow();
    }
    expect(normalizeSocialComment('leadgen', igComment)).toBeNull();
  });
});

describe('comment qualification', () => {
  const intentOf = (text: string) => qualifyComment(text).intent;

  it('treats a request to be contacted as high intent', () => {
    const q = qualifyComment('Interested in 2BR. Please contact me.');
    expect(q.intent).toBe('HIGH');
    expect(q.reasons).toContain('asked to be contacted');
    expect(q.reasons).toContain('said they are interested');
  });

  it('treats a payment-plan question as high intent', () => {
    expect(intentOf('Can you send me the price and payment plan?')).toBe('HIGH');
  });

  it('treats a specific property question as medium intent', () => {
    expect(intentOf("What's the expected handover date?")).toBe('MEDIUM');
  });

  /**
   * The rule the whole two-layer design exists to serve: praise and emoji are
   * engagement, and must never look like a customer.
   */
  it('keeps praise and emoji out of enquiry territory', () => {
    expect(intentOf('Beautiful project')).toBe('LOW');
    expect(intentOf('🔥🔥🔥')).toBe('IRRELEVANT');
    expect(intentOf('Congratulations!')).toBe('LOW');
    expect(qualifyComment('🔥🔥🔥').score).toBe(0);
  });

  it('flags obvious promotion as spam', () => {
    expect(intentOf('Check my page for forex signals')).toBe('SPAM');
    expect(intentOf('aaaaaaaaaaaaaaaa')).toBe('SPAM');
  });

  /** §20: a score with no explanation is not actionable. */
  it('always explains itself', () => {
    for (const text of ['Price?', 'Beautiful', '🔥', 'Please call me', 'random words here']) {
      expect(qualifyComment(text).reasons.length).toBeGreaterThan(0);
    }
  });

  /** Substring matching is how keyword qualifiers get a bad name. */
  it('matches on words, not substrings', () => {
    expect(qualifyComment('Follow us on facebook').reasons).not.toContain('asked to book or visit');
    expect(intentOf('The view is expensive looking')).not.toBe('HIGH');
  });

  it('scores a bare question below a buying question', () => {
    expect(qualifyComment('Price?').score).toBeGreaterThan(qualifyComment('Where?').score);
  });

  it('recognises contact details left in a comment', () => {
    expect(qualifyComment('Interested, my number is +971 50 123 4567').reasons).toContain('left contact details');
  });
});

/**
 * The checkpoint that matters: an event off the wire becomes an actionable
 * enquiry, and does NOT become a CRM Lead.
 */
describe('webhook envelope → social comment event', () => {
  const igEnvelope = (text: string, id = 'c-1') => ({
    object: 'instagram',
    entry: [
      {
        id: 'ig-account-1',
        changes: [
          {
            field: 'comments',
            value: {
              id,
              text,
              timestamp: 1786900000,
              from: { id: 'ig-scoped-987', username: 'priya.k' },
              media: { id: 'media-marina-1', media_product_type: 'REELS' },
            },
          },
        ],
      },
    ],
  });

  it('emits SOCIAL_COMMENT_RECEIVED from the shared normaliser', async () => {
    const { normalizeMetaWebhook } = await import('@/lib/integrations/meta/events');
    const [event] = normalizeMetaWebhook(igEnvelope('Can you send me the price and payment plan?'));
    expect(event).toMatchObject({
      kind: 'SOCIAL_COMMENT_RECEIVED',
      externalId: 'comment:instagram:c-1',
      assetId: 'media-marina-1',
    });
    expect(event!.comment).toMatchObject({ provider: 'instagram', authorName: 'priya.k' });
  });

  /** Provider is in the key: the two id spaces are separate. */
  it('keys the event so a redelivery deduplicates and the two providers cannot collide', async () => {
    const { normalizeMetaWebhook } = await import('@/lib/integrations/meta/events');
    const once = normalizeMetaWebhook(igEnvelope('Price?'))[0]!.externalId;
    const twice = normalizeMetaWebhook(igEnvelope('Price?'))[0]!.externalId;
    expect(once).toBe(twice);
    expect(once).toContain('instagram');
  });

  it('still emits Lead Ads and WhatsApp events alongside comments', async () => {
    const { normalizeMetaWebhook } = await import('@/lib/integrations/meta/events');
    const mixed = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            { field: 'leadgen', value: { leadgen_id: '55', form_id: 'f1', created_time: 1786900000 } },
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'fb-c-1',
                post_id: 'p-1',
                from: { id: 'fb-1', name: 'Ahmed Rahman' },
                message: 'Interested in 2BR. Please contact me.',
                created_time: 1786900000,
              },
            },
            { field: 'feed', value: { item: 'like', post_id: 'p-1' } },
          ],
        },
      ],
    };
    const kinds = normalizeMetaWebhook(mixed).map((e) => e.kind);
    // The like is dropped; the lead and the comment both survive.
    expect(kinds).toEqual(['LEAD_CREATED', 'SOCIAL_COMMENT_RECEIVED']);
  });
});
