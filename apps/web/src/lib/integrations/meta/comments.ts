/**
 * Facebook and Instagram comments, normalised into one internal event.
 *
 * They arrive through the same webhook envelope as Lead Ads and WhatsApp, so
 * this extends `events.ts` rather than adding a second receiver — but the two
 * payloads are genuinely different and the differences are not cosmetic.
 * Verified against the current Meta reference, not from memory:
 *
 *                     Facebook                      Instagram
 *   field             `feed`                        `comments`
 *   discriminator     value.item === 'comment'      (the field itself)
 *   comment id        value.comment_id              value.id
 *   text              value.message                 value.text
 *   author            from.{id, name}               from.{id, username}
 *   author id scope   page-scoped                   Instagram-scoped
 *   content           value.post_id                 value.media.{id, media_product_type}
 *   ad context        —                             value.media.{ad_id, ad_title}
 *   lifecycle         value.verb: add/edit/delete   not delivered
 *
 * Facebook tells us when a comment is edited or removed; Instagram does not. So
 * `verb` is carried through for Facebook and left undefined for Instagram —
 * inventing a lifecycle Instagram does not report would be worse than absent.
 */

export interface NormalizedSocialComment {
  provider: 'facebook' | 'instagram';
  providerCommentId: string;
  providerAuthorId?: string;
  /** A display name (Facebook) or a handle (Instagram). Never an email or phone. */
  authorName?: string;
  commentText: string;
  commentCreatedAt: Date;
  providerMediaId?: string;
  mediaType?: string;
  parentCommentId?: string;
  providerAdId?: string;
  providerAdTitle?: string;
  /** Facebook only: `add`, `edit`, `edited`, `remove`, `delete`. */
  verb?: string;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : undefined;

/** Meta stamps seconds on some fields and ISO strings on others. */
const at = (v: unknown): Date => {
  if (typeof v === 'number') return new Date(v * 1000);
  if (typeof v === 'string') {
    const asNumber = Number(v);
    if (Number.isFinite(asNumber) && v.trim() !== '' && !v.includes('-')) return new Date(asNumber * 1000);
    const parsed = new Date(v);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
};

/**
 * A Page feed change. Returns null for anything that is not a comment — the
 * `feed` field also carries posts, likes, shares and reactions.
 */
export function normalizeFacebookComment(value: Record<string, unknown>): NormalizedSocialComment | null {
  if (str(value.item) !== 'comment') return null;
  const providerCommentId = str(value.comment_id);
  const commentText = str(value.message);
  // A comment with no id cannot be deduplicated; one with no text (a sticker or
  // a photo-only reply) carries no intent to classify. Neither is an error.
  if (!providerCommentId || !commentText) return null;

  const from = (value.from ?? {}) as Record<string, unknown>;
  return {
    provider: 'facebook',
    providerCommentId,
    providerAuthorId: str(from.id),
    authorName: str(from.name),
    commentText,
    commentCreatedAt: at(value.created_time),
    providerMediaId: str(value.post_id),
    mediaType: 'post',
    parentCommentId: str(value.parent_id),
    verb: str(value.verb),
  };
}

/** An Instagram `comments` change. Every one of these is a comment. */
export function normalizeInstagramComment(value: Record<string, unknown>): NormalizedSocialComment | null {
  const providerCommentId = str(value.id);
  const commentText = str(value.text);
  if (!providerCommentId || !commentText) return null;

  const from = (value.from ?? {}) as Record<string, unknown>;
  const media = (value.media ?? {}) as Record<string, unknown>;
  return {
    provider: 'instagram',
    providerCommentId,
    providerAuthorId: str(from.id),
    // Instagram gives a handle, Facebook a display name. Both are just a label.
    authorName: str(from.username),
    commentText,
    commentCreatedAt: at(value.timestamp ?? value.created_time),
    providerMediaId: str(media.id),
    mediaType: str(media.media_product_type) ?? 'media',
    parentCommentId: str(value.parent_id),
    // Only Instagram reports which ad a comment came from.
    providerAdId: str(media.ad_id),
    providerAdTitle: str(media.ad_title),
  };
}

/**
 * Picks the right adapter for a change entry. Never throws: Meta retries any
 * non-2xx, so one malformed delivery must not become an indefinite retry loop.
 */
export function normalizeSocialComment(field: string, value: Record<string, unknown>): NormalizedSocialComment | null {
  try {
    if (field === 'feed') return normalizeFacebookComment(value);
    if (field === 'comments') return normalizeInstagramComment(value);
    return null;
  } catch {
    return null;
  }
}
