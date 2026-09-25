/**
 * What a portal will and will not take, and the XML it fetches.
 *
 * The portals here collect listings from a feed the brokerage hosts rather
 * than accepting a push, so "published" means "in the next build of the feed"
 * — and the portal decides when that is, usually every few hours.
 *
 * The part that earns its keep is the refusal list. A portal that receives a
 * listing with no permit number does not tell anybody: it drops it, or worse
 * accepts it and the brokerage receives a compliance letter. So each listing
 * is checked before it goes in, the reason is written back onto the pairing,
 * and the screen shows an agent what to fix in words they can act on.
 *
 * Rules differ per portal deliberately. The brokerage's own website is lenient
 * — it is theirs, and a listing with one photograph is still worth showing
 * there — while Property Finder will not take it.
 */

export type PortalKey = 'PROPERTY_FINDER' | 'BAYUT' | 'DUBIZZLE' | 'WEBSITE';

/** Only what the checks and the XML need. Keeps the query honest and small. */
export interface FeedListing {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  listingType: string;
  status: string;
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  price: unknown;
  currency: string;
  rentFrequency: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  amenityKeys: string[];
  permitNumber: string | null;
  permitExpiry: Date | null;
  mandateExpires: Date | null;
  updatedAt: Date;
  micromarket: { name: string } | null;
  owner: { fullName: string; email: string | null; phone: string | null } | null;
  media: { id: string; storageKey: string | null; externalUrl: string | null }[];
}

/** Everything wrong with a listing, in the order an agent would fix it. */
export function problemsWith(listing: FeedListing, portal: PortalKey, now = new Date()): string[] {
  const problems: string[] = [];

  if (listing.status !== 'ACTIVE') {
    problems.push(`the listing is ${listing.status.toLowerCase().replace(/_/g, ' ')}, not active`);
  }
  if (!listing.price || Number(listing.price) <= 0) problems.push('no price');
  if (usableMedia(listing).length === 0) problems.push('no photographs');

  if (portal === 'WEBSITE') return problems;

  if (!listing.permitNumber) {
    problems.push('no permit number — advertising without one is a compliance problem, not a portal rule');
  } else if (listing.permitExpiry && listing.permitExpiry < now) {
    // Worth separating from a missing one: the fix is a renewal, not an entry.
    problems.push('the advertising permit has expired');
  }

  // A lapsed mandate means the agency no longer has the right to advertise it.
  // The portals do not know that; the landlord does.
  if (listing.mandateExpires && listing.mandateExpires < now) {
    problems.push('the mandate has lapsed, so this may no longer be ours to advertise');
  }

  if (usableMedia(listing).length < 2) problems.push('portals want at least two photographs');
  if (!listing.micromarket) problems.push('no community, so it cannot be placed on their map');
  if (!listing.description || listing.description.trim().length < 40) {
    problems.push('the description is too short');
  }
  if (listing.listingType === 'RENT' && !listing.rentFrequency) {
    problems.push('a rent with no period — a yearly figure read as monthly is twelve times wrong');
  }

  return problems;
}

/** A media row is only useful to a portal if it can actually be fetched. */
export function usableMedia(listing: FeedListing) {
  return listing.media.filter((item) => item.storageKey || item.externalUrl);
}

export interface RenderedFeed {
  xml: string;
  included: number;
  /** Listing id → why it was left out, to write back onto the pairing. */
  rejected: Map<string, string>;
}

export interface FeedAgency {
  name: string;
  licenceNumber: string | null;
  phone: string | null;
}

/**
 * Render the feed.
 *
 * Takes listings and their already-resolved image URLs rather than fetching
 * anything, so the decision and the document are testable without a database
 * or an object store.
 */
export function renderFeed(
  listings: FeedListing[],
  portal: PortalKey,
  agency: FeedAgency,
  imageUrls: Map<string, string[]>,
  now = new Date(),
): RenderedFeed {
  const rejected = new Map<string, string>();
  const parts: string[] = [];

  for (const listing of listings) {
    const problems = problemsWith(listing, portal, now);
    if (problems.length > 0) {
      rejected.set(listing.id, problems.join('; '));
      continue;
    }
    parts.push(renderListing(listing, imageUrls.get(listing.id) ?? [], agency));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<list>
  <agent_details>
    <name>${escapeXml(agency.name)}</name>
${agency.licenceNumber ? `    <licence>${escapeXml(agency.licenceNumber)}</licence>\n` : ''}${
    agency.phone ? `    <phone>${escapeXml(agency.phone)}</phone>\n` : ''
  }  </agent_details>
  <last_update>${now.toISOString()}</last_update>
${parts.join('\n')}
</list>
`;

  return { xml, included: parts.length, rejected };
}

function renderListing(listing: FeedListing, images: string[], agency: FeedAgency): string {
  return `  <property>
    <reference_number>${escapeXml(listing.reference)}</reference_number>
    <permit_number>${escapeXml(listing.permitNumber ?? '')}</permit_number>
    <offering_type>${listing.listingType === 'RENT' ? 'RR' : 'RS'}</offering_type>
    <property_type>${escapeXml(listing.propertyType)}</property_type>
    <title_en>${escapeXml(listing.title)}</title_en>
    <description_en>${escapeXml(listing.description ?? '')}</description_en>
    <price>${Number(listing.price)}</price>
    <currency>${escapeXml(listing.currency)}</currency>
${listing.rentFrequency ? `    <rent_frequency>${escapeXml(listing.rentFrequency)}</rent_frequency>\n` : ''}    <bedroom>${listing.bedrooms ?? ''}</bedroom>
    <bathroom>${listing.bathrooms ?? ''}</bathroom>
    <size>${listing.areaSqft ?? ''}</size>
    <community>${escapeXml(listing.micromarket?.name ?? '')}</community>
${
  listing.latitude !== null && listing.longitude !== null
    ? `    <geopoints>${listing.latitude},${listing.longitude}</geopoints>\n`
    : ''
}    <last_update>${listing.updatedAt.toISOString()}</last_update>
    <agent>
      <name>${escapeXml(listing.owner?.fullName ?? agency.name)}</name>
      <email>${escapeXml(listing.owner?.email ?? '')}</email>
      <phone>${escapeXml(listing.owner?.phone ?? '')}</phone>
    </agent>
    <photo>
${images.map((url) => `      <url last_update="${listing.updatedAt.toISOString()}">${escapeXml(url)}</url>`).join('\n')}
    </photo>
${listing.amenityKeys.length > 0 ? `    <amenities>${escapeXml(listing.amenityKeys.join(','))}</amenities>\n` : ''}  </property>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    switch (character) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}
