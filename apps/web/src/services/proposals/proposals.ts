import { withTx } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { assertRecordVisible } from '@/lib/security/visibility';
import type { Ctx } from '@/lib/security/rbac';
import { proposalLink } from '@/lib/proposals/proposalLink';

/**
 * Proposals, from the agency's side.
 *
 * The public half — what a client sees and what they may change — is in
 * lib/proposals/publicProposal.ts. This is creating one, sending it, and
 * reading back what came of it.
 */

/** Properties on one proposal. More than this is not a shortlist. */
const MAX_ITEMS = 20;

/**
 * Gated on `requirements`, not a module of its own.
 *
 * A proposal is a shortlist answering a client's requirement, and whoever may
 * work that requirement is exactly who should be able to send it. A new module
 * key would also have meant a permission row every existing role lacks — so the
 * feature would ship switched off for every live workspace until somebody
 * edited every role by hand.
 */
const PERMISSION_MODULE = 'requirements';

export interface CreateProposalInput {
  leadId?: string | null;
  contactId?: string | null;
  requirementId?: string | null;
  title: string;
  message?: string | null;
  listingIds: string[];
  expiresAt?: Date | null;
}

export async function createProposal(ctx: Ctx, input: CreateProposalInput) {
  if (!input.leadId && !input.contactId) throw Conflict('A proposal needs a client.');
  if (input.listingIds.length === 0) throw Conflict('A proposal needs at least one property.');

  return withTx(ctx.tenantId, async (tx) => {
    /**
     * The listings are re-read here rather than trusted from the request. An id
     * from another workspace, a deleted listing or one that was withdrawn this
     * morning would otherwise be written onto a client-facing page.
     */
    const listings = await tx.listing.findMany({
      where: {
        tenantId: ctx.tenantId,
        id: { in: input.listingIds.slice(0, MAX_ITEMS) },
        deletedAt: null,
        status: { in: ['ACTIVE', 'UNDER_OFFER'] },
      },
      select: { id: true },
    });
    if (listings.length === 0) throw Conflict('None of those properties can be shown to a client.');

    // The requested order is the agent's order — best first — so it is kept
    // rather than replaced by whatever the database returned.
    const ordered = input.listingIds.filter((id) => listings.some((listing) => listing.id === id));

    const proposal = await tx.proposal.create({
      data: {
        tenantId: ctx.tenantId,
        leadId: input.leadId ?? null,
        contactId: input.contactId ?? null,
        requirementId: input.requirementId ?? null,
        title: input.title,
        message: input.message ?? null,
        ownerId: ctx.actor.id,
        expiresAt: input.expiresAt ?? null,
        createdById: ctx.actor.id,
        items: {
          create: ordered.map((listingId, position) => ({ tenantId: ctx.tenantId, listingId, position })),
        },
      },
      select: { id: true, title: true, status: true },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'proposal',
        recordId: proposal.id,
        newValue: { title: proposal.title, properties: ordered.length },
      },
      tx,
    );

    return { ...proposal, itemCount: ordered.length, skipped: input.listingIds.length - ordered.length };
  });
}

/**
 * Sending is what mints the link. Until then the record exists and resolves to
 * nothing, so an agent can build a shortlist over an afternoon without a
 * half-finished page being reachable.
 */
export async function sendProposal(ctx: Ctx, id: string, now = new Date()) {
  const url = await withTx(ctx.tenantId, async (tx) => {
    const proposal = await tx.proposal.findFirst({
      where: { id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, tenantId: true, ownerId: true, status: true, _count: { select: { items: true } } },
    });
    if (!proposal) throw NotFound('Proposal');
    await assertRecordVisible(ctx, PERMISSION_MODULE, proposal, tx, 'EDIT');
    if (proposal._count.items === 0) throw Conflict('This proposal has no properties on it.');
    if (proposal.status === 'CLOSED') throw Conflict('This proposal has been withdrawn.');

    await tx.proposal.updateMany({
      where: { id, tenantId: ctx.tenantId },
      data: {
        status: 'SENT',
        // Set once: re-sending must not restart the clock on a link the client
        // already has, and "sent 9 March" is the answer to the only question
        // anyone asks about it.
        ...(proposal.status === 'SENT' ? {} : { sentAt: now }),
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      { event: 'RECORD_UPDATED', objectType: 'proposal', recordId: id, newValue: { status: 'SENT' } },
      tx,
    );

    return proposalLink.url(ctx.tenantId, id);
  });

  return { url };
}

/**
 * Withdrawn. The link stops resolving; the record and the client's answers stay,
 * because "they liked the third one" is worth more after the proposal is dead
 * than during it.
 */
export async function closeProposal(ctx: Ctx, id: string) {
  await withTx(ctx.tenantId, async (tx) => {
    const proposal = await tx.proposal.findFirst({
      where: { id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, tenantId: true, ownerId: true },
    });
    if (!proposal) throw NotFound('Proposal');
    await assertRecordVisible(ctx, PERMISSION_MODULE, proposal, tx, 'EDIT');

    await tx.proposal.updateMany({
      where: { id, tenantId: ctx.tenantId },
      data: { status: 'CLOSED', updatedById: ctx.actor.id },
    });
    await audit(
      ctx,
      { event: 'RECORD_UPDATED', objectType: 'proposal', recordId: id, newValue: { status: 'CLOSED' } },
      tx,
    );
  });
}

/** The agency's view of one proposal: the link, who opened it, and what they said. */
export async function proposalDetail(ctx: Ctx, id: string) {
  return withTx(ctx.tenantId, async (tx) => {
    const proposal = await tx.proposal.findFirst({
      where: { id, tenantId: ctx.tenantId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        title: true,
        message: true,
        status: true,
        ownerId: true,
        leadId: true,
        contactId: true,
        sentAt: true,
        expiresAt: true,
        firstViewedAt: true,
        lastViewedAt: true,
        viewCount: true,
        createdAt: true,
        owner: { select: { fullName: true } },
        items: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            note: true,
            reaction: true,
            comment: true,
            reactedAt: true,
            listing: {
              select: {
                id: true,
                reference: true,
                title: true,
                status: true,
                price: true,
                currency: true,
                bedrooms: true,
                micromarket: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!proposal) throw NotFound('Proposal');
    await assertRecordVisible(ctx, PERMISSION_MODULE, proposal, tx, 'VIEW');

    return {
      ...proposal,
      // Only for a live proposal. A link beside a withdrawn one is a link
      // somebody sends anyway.
      url: proposal.status === 'SENT' ? proposalLink.url(ctx.tenantId, proposal.id) : null,
    };
  });
}
