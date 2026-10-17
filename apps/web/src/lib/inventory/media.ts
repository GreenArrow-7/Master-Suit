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

/** What the upload routes store in our own bucket. */
export const HOSTED_KINDS = ['IMAGE', 'FLOOR_PLAN', 'BROCHURE', 'CREATIVE'] as const;

/**
 * Where a workspace's project and listing media live in the bucket. Only the
 * upload routes write under it, and a key registered by hand must be under it
 * too — otherwise registering another workspace's key, or a receipt's, and
 * opening it through the media file route would read a file the caller has no
 * right to.
 */
export const mediaPrefix = (tenantId: string) => `inventory/t-${tenantId}/`;

/** The file types media may be, recognised by their first bytes rather than their name. */
const SIGNATURES: { type: string; test: (b: Buffer) => boolean }[] = [
  { type: 'application/pdf', test: (b) => b.subarray(0, 4).toString('latin1') === '%PDF' },
  { type: 'image/png', test: (b) => b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG' },
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** A photo is an image; a floor plan, brochure or creative may also be a PDF. */
export function sniffMediaType(kind: (typeof HOSTED_KINDS)[number], bytes: Buffer): string {
  const type = SIGNATURES.find((s) => s.test(bytes))?.type;
  if (!type || (kind === 'IMAGE' && type === 'application/pdf')) {
    throw Invalid([
      {
        field: 'file',
        code: 'type',
        message:
          kind === 'IMAGE' ? 'A photo must be a JPEG, PNG or WebP file.' : 'Upload a PDF, JPEG, PNG or WebP file.',
      },
    ]);
  }
  return type;
}

export function assertMediaSource(
  input: { kind: MediaKind; storageKey?: string; externalUrl?: string },
  tenantId: string,
) {
  const isEmbed = EMBED_KINDS.includes(input.kind);
  if (input.storageKey && !input.storageKey.startsWith(mediaPrefix(tenantId))) {
    throw Invalid([
      { field: 'storageKey', code: 'invalid', message: 'Upload the file through Add photo or Add file.' },
    ]);
  }

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
