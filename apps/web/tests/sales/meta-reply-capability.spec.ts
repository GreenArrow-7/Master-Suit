import { describe, it, expect } from 'vitest';
import { replyCapability, PRIVATE_REPLY_WINDOW_MS } from '@/lib/integrations/meta/replyCapability';

/**
 * The documented Meta contract, pinned.
 *
 * This function exists so the UI never offers a button Meta will refuse. If
 * Meta changes a rule, these tests are where the change should first be felt —
 * a failure here means the encoded contract and the real one have parted ways.
 */
const commentedAt = new Date('2026-08-10T09:00:00Z');
const dayAfter = new Date('2026-08-11T09:00:00Z');
const eightDaysLater = new Date('2026-08-18T09:00:00Z');

describe('meta reply capability', () => {
  it('allows both replies on a fresh Facebook comment', () => {
    const cap = replyCapability({ provider: 'facebook', commentCreatedAt: commentedAt }, dayAfter);
    expect(cap).toMatchObject({ canPublicReply: true, canPrivateReply: true });
    expect(cap.replyExpiresAt!.getTime()).toBe(commentedAt.getTime() + PRIVATE_REPLY_WINDOW_MS);
  });

  it('closes the private window after seven days but leaves public reply open', () => {
    const cap = replyCapability({ provider: 'instagram', commentCreatedAt: commentedAt }, eightDaysLater);
    expect(cap.canPrivateReply).toBe(false);
    expect(cap.reasonUnavailable.private).toMatch(/seven-day/i);
    // Meta documents no time limit on public replies, so one is still offered.
    expect(cap.canPublicReply).toBe(true);
  });

  it('refuses both on an Instagram live comment', () => {
    const cap = replyCapability({ provider: 'instagram', commentCreatedAt: commentedAt, mediaType: 'LIVE' }, dayAfter);
    expect(cap.canPublicReply).toBe(false);
    expect(cap.canPrivateReply).toBe(false);
    // No seven-day promise on a broadcast that may already have ended.
    expect(cap.replyExpiresAt).toBeNull();
  });

  it('spends the single private reply only on a private reply', () => {
    const afterPrivate = replyCapability(
      { provider: 'facebook', commentCreatedAt: commentedAt, privateReplySent: true },
      dayAfter,
    );
    expect(afterPrivate.canPrivateReply).toBe(false);
    expect(afterPrivate.reasonUnavailable.private).toMatch(/only one private reply/i);

    /**
     * A public reply under the post does not consume Meta's private-message
     * allowance. Treating any answer as spending it told salespeople the direct
     * route was closed while it was still open.
     */
    const afterPublic = replyCapability(
      { provider: 'facebook', commentCreatedAt: commentedAt, providerReplyId: 'x' },
      dayAfter,
    );
    expect(afterPublic.canPrivateReply).toBe(true);
    expect(afterPublic.canPublicReply).toBe(false);
  });

  it('does not offer a second public reply', () => {
    const cap = replyCapability(
      { provider: 'facebook', commentCreatedAt: commentedAt, providerReplyId: 'x' },
      dayAfter,
    );
    expect(cap.canPublicReply).toBe(false);
  });

  it('respects the scopes a connection actually holds', () => {
    const readOnly = replyCapability(
      { provider: 'facebook', commentCreatedAt: commentedAt, grantedScopes: ['pages_read_engagement'] },
      dayAfter,
    );
    expect(readOnly.canPublicReply).toBe(false);
    expect(readOnly.canPrivateReply).toBe(false);

    const moderator = replyCapability(
      { provider: 'facebook', commentCreatedAt: commentedAt, grantedScopes: ['pages_manage_engagement'] },
      dayAfter,
    );
    expect(moderator.canPublicReply).toBe(true);
    // Public moderation says nothing about messaging.
    expect(moderator.canPrivateReply).toBe(false);
  });

  it('accepts either Instagram permission family', () => {
    const facebookLogin = replyCapability(
      {
        provider: 'instagram',
        commentCreatedAt: commentedAt,
        grantedScopes: ['instagram_manage_comments', 'pages_messaging'],
      },
      dayAfter,
    );
    const instagramLogin = replyCapability(
      {
        provider: 'instagram',
        commentCreatedAt: commentedAt,
        grantedScopes: ['instagram_business_manage_comments', 'instagram_business_manage_messages'],
      },
      dayAfter,
    );
    expect(facebookLogin).toMatchObject({ canPublicReply: true, canPrivateReply: true });
    expect(instagramLogin).toMatchObject({ canPublicReply: true, canPrivateReply: true });
  });

  it('says nothing is wrong when the connection does not report its scopes', () => {
    // An unknown is not evidence of absence; the API call is the real check.
    const cap = replyCapability({ provider: 'instagram', commentCreatedAt: commentedAt }, dayAfter);
    expect(cap.reasonUnavailable).toEqual({});
  });
});
