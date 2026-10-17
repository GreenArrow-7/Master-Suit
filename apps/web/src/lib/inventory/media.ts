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

/** Where a workspace's project and listing media live in the bucket; only the upload routes write under it. */
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

/**
 * The JSON media routes link a video or tour and nothing else. A hosted file
 * gets its row from the upload route, which stores the type it recognised; a
 * key or type named by a caller would let a stored PDF be re-registered as
 * `text/html` and served as a page on our own origin.
 */
export function assertMediaSource(input: { kind: MediaKind; externalUrl?: string }) {
  if (!EMBED_KINDS.includes(input.kind)) {
    throw Invalid([{ field: 'kind', code: 'invalid', message: 'Upload the file through Add photo or Add file.' }]);
  }
  if (!input.externalUrl) {
    throw Invalid([{ field: 'externalUrl', code: 'required', message: 'A video or tour needs its URL.' }]);
  }
}

/**
 * The headers a hosted file is served with. Only a type the upload route
 * recognises renders in the browser; anything else, such as a row stored before
 * that rule, is a download.
 */
export function mediaFileHeaders(mimeType: string | null, title: string) {
  const known = SIGNATURES.some((s) => s.type === mimeType);
  return {
    'content-type': known ? mimeType! : 'application/octet-stream',
    // `inline` so a gallery image renders and a brochure previews, with a
    // filename so a download keeps a sensible name.
    'content-disposition': `${known ? 'inline' : 'attachment'}; filename="${title.replace(/["\\]/g, '')}"`,
  };
}
