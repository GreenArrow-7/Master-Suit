/**
 * What counts as valid media, for projects and for listings alike.
 *
 * The rule is the same in both places and it is a rule, not a shape: video and
 * VR tours are linked because they belong to whoever hosts them, and everything
 * else is an object in our own bucket so it keeps the access control and the
 * expiry that a vendor link does not have. Two copies of a rule is how the two
 * come to disagree about which kinds may carry a URL.
 */
import { Invalid } from '@/lib/errors';

export const MEDIA_KINDS = ['IMAGE', 'FLOOR_PLAN', 'BROCHURE', 'CREATIVE', 'VIDEO', 'VR_TOUR'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Embeds we point at rather than host. */
export const EMBED_KINDS: readonly MediaKind[] = ['VIDEO', 'VR_TOUR'];

export function assertMediaSource(input: { kind: MediaKind; storageKey?: string; externalUrl?: string }) {
  const isEmbed = EMBED_KINDS.includes(input.kind);

  if (isEmbed && !input.externalUrl) {
    throw Invalid([{ field: 'externalUrl', code: 'required', message: 'A video or tour needs its URL.' }]);
  }
  if (!isEmbed && !input.storageKey) {
    throw Invalid([
      { field: 'storageKey', code: 'required', message: 'Upload the file first, then register its key.' },
    ]);
  }
  if (input.storageKey && input.externalUrl) {
    throw Invalid([
      {
        field: 'externalUrl',
        code: 'conflict',
        message: 'Media is either hosted by us or linked from elsewhere, not both.',
      },
    ]);
  }
}
