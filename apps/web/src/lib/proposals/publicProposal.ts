/**
 * What a proposal token resolves to, and what a client holding it may see.
 *
 * Shared by the public page and the public reaction route, so the two cannot
 * drift into disagreeing about what is safe to disclose — a page that rendered
 * one field more than the route returns is a leak nobody would find by reading
 * the route.
 *
 * Everything here is deliberately a subset. The client sees the properties, the
 * agency and the agent. They do not see the mandate, the landlord, the lead
 * record or anything an agent typed about them, because a link forwarded to a
 * colleague — or to the landlord — is the normal case, not the attack.
 */
import { withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { listingImageLink } from '@/lib/inventory/listingImageLink';
import { proposalLink } from './proposalLink';

export interface PublicListing {
  itemId: string;
  title: string;
  description: string | null;
  community: string | null;
  propertyType: string;
  listingType: string;
  /// ACTIVE or UNDER_OFFER — shown, because "under offer" is information the
  /// client needs before they spend a Saturday viewing it.
  status: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  price: string;
  currency: string;
  rentFrequency: string | null;
  /// Trakheesi or the local equivalent. On an advert by law, so it is on this one.
  permitNumber: string | null;
  images: string[];
  note: string | null;
  reaction: string | null;
  comment: string | null;
}

export interface PublicProposal {
  proposalId: string;
  tenantId: string;
  title: string;
  message: string | null;
  sentAt: Date | null;
  agency: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    accentColor: string;
    reraOrn: string | null;
  };
  agent: { name: string; email: string | null; phone: string | null } | null;
  listings: PublicListing[];
}

/** Photographs per property. Enough to decide, few enough to load on a phone. */
const IMAGE_LIMIT = 6;

/** What may still be shown to a client. Everything else has gone. */
const SHOWABLE: string[] = ['ACTIVE', 'UNDER_OFFER'];

/**
 * Throws NotFound for a bad signature, an unknown id, a draft, a withdrawn
 * proposal and an expired one alike. Distinguishing them would let the holder
 * of one valid link confirm which other proposal ids exist, and would tell a
 * forwarded-to stranger that there is something here worth waiting for.
 */
export async function loadProposal(token: string, now = new Date()): Promise<PublicProposal> {
  const claim = proposalLink.verify(token);
  if (!claim) throw NotFound('Proposal');

  // Fully tenant-scoped, because the token carries the tenant. The public path
  // therefore needs no exception in the tenant guard and none in RLS.
  return withTx(claim.tenantId, async (tx) => {
    const proposal = await tx.proposal.findFirst({
      where: { id: claim.recordId, tenantId: claim.tenantId, status: 'SENT', deletedAt: null },
      select: {
        id: true,
        title: true,
        message: true,
        sentAt: true,
        expiresAt: true,
        owner: { select: { fullName: true, displayName: true, email: true, phone: true } },
        items: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            note: true,
            reaction: true,
            comment: true,
            listing: {
              select: {
                id: true,
                title: true,
                description: true,
                propertyType: true,
                listingType: true,
                status: true,
                bedrooms: true,
                bathrooms: true,
                areaSqft: true,
                price: true,
                currency: true,
                rentFrequency: true,
                permitNumber: true,
                deletedAt: true,
                micromarket: { select: { name: true, city: true } },
                media: {
                  where: { kind: 'IMAGE' },
                  orderBy: { position: 'asc' },
                  take: IMAGE_LIMIT,
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });

    if (!proposal) throw NotFound('Proposal');
    if (proposal.expiresAt && proposal.expiresAt <= now) throw NotFound('Proposal');

    const setting = await tx.organizationSetting.findUnique({
      where: { tenantId: claim.tenantId },
      select: { productName: true, logoUrl: true, primaryColor: true, accentColor: true, reraOrn: true },
    });
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: claim.tenantId },
      select: { displayName: true, logoUrl: true },
    });

    return {
      proposalId: proposal.id,
      tenantId: claim.tenantId,
      title: proposal.title,
      message: proposal.message,
      sentAt: proposal.sentAt,
      agency: {
        // The workspace's own name, not the product's. A client should see
        // their broker on this page and nothing of ours.
        name: tenant.displayName || setting?.productName || 'Property shortlist',
        logoUrl: tenant.logoUrl ?? setting?.logoUrl ?? null,
        primaryColor: setting?.primaryColor ?? '#2447C7',
        accentColor: setting?.accentColor ?? '#0E7C66',
        reraOrn: setting?.reraOrn ?? null,
      },
      agent: proposal.owner
        ? {
            name: proposal.owner.displayName || proposal.owner.fullName,
            email: proposal.owner.email,
            phone: proposal.owner.phone,
          }
        : null,
      listings: proposal.items
        /**
         * A property the agency can no longer sell drops off the page, even on
         * a link already sent — sold, rented, withdrawn, or a lapsed mandate.
         * Showing fewer is better than showing stock that is gone, and it is
         * the shape of complaint a regulator takes an interest in.
         *
         * UNDER_OFFER stays, and says so. An agent showing one is creating
         * urgency, not misleading anybody, provided the page is honest about it.
         */
        .filter((item) => !item.listing.deletedAt && SHOWABLE.includes(item.listing.status))
        .map((item) => ({
          itemId: item.id,
          title: item.listing.title,
          description: item.listing.description,
          community: item.listing.micromarket
            ? `${item.listing.micromarket.name}, ${item.listing.micromarket.city}`
            : null,
          propertyType: String(item.listing.propertyType),
          status: String(item.listing.status),
          listingType: String(item.listing.listingType),
          bedrooms: item.listing.bedrooms,
          bathrooms: item.listing.bathrooms,
          areaSqft: item.listing.areaSqft,
          price: item.listing.price.toString(),
          currency: item.listing.currency,
          rentFrequency: item.listing.rentFrequency ? String(item.listing.rentFrequency) : null,
          permitNumber: item.listing.permitNumber,
          images: item.listing.media.map((media) => `/li/${listingImageLink.token(claim.tenantId, media.id)}`),
          note: item.note,
          reaction: item.reaction ? String(item.reaction) : null,
          comment: item.comment,
        })),
    };
  });
}

/**
 * That somebody opened it, and when.
 *
 * Deliberately not deduplicated by person — there is nobody to identify. The
 * count is "how many times this link was opened", which is the honest reading
 * and the one an agent actually uses: a shortlist opened nine times is a
 * shortlist being shown to a spouse.
 */
export async function recordView(proposal: Pick<PublicProposal, 'proposalId' | 'tenantId'>, now = new Date()) {
  await withTx(proposal.tenantId, async (tx) => {
    const where = { id: proposal.proposalId, tenantId: proposal.tenantId };
    await tx.proposal.updateMany({ where, data: { viewCount: { increment: 1 }, lastViewedAt: now } });
    // Separate, because `firstViewedAt: null` in the filter is what makes it
    // set-once — there is no "only if null" to express in a data clause.
    await tx.proposal.updateMany({ where: { ...where, firstViewedAt: null }, data: { firstViewedAt: now } });
  });
}

export type Reaction = 'INTERESTED' | 'NOT_INTERESTED';

/**
 * What the client thought of one property.
 *
 * Changeable: people look again, and a second opinion is more useful than a
 * first one preserved for its own sake. The comment is kept alongside because
 * "too far from the metro" is the single most useful sentence in the record —
 * it is the next search, written by the person who will buy.
 */
export async function react(
  token: string,
  itemId: string,
  reaction: Reaction | null,
  comment: string | null,
  now = new Date(),
): Promise<void> {
  // Reloaded rather than trusted: this proves the link is still live, still
  // SENT and not expired before anything is written.
  const proposal = await loadProposal(token, now);
  if (!proposal.listings.some((listing) => listing.itemId === itemId)) throw NotFound('Property');

  await withTx(proposal.tenantId, (tx) =>
    tx.proposalItem.updateMany({
      where: { id: itemId, tenantId: proposal.tenantId, proposalId: proposal.proposalId },
      data: {
        reaction,
        comment: comment?.trim() ? comment.trim().slice(0, 1000) : null,
        reactedAt: reaction ? now : null,
      },
    }),
  );
}
