/**
 * The right to market a property, and the date it ends.
 *
 * This is the module's one real rule: a listing may only be ACTIVE while an
 * ACTIVE mandate covers it. Everything here exists to keep those two facts from
 * disagreeing, because the failure mode is not a wrong number on a screen — it
 * is the agency advertising a property it no longer has permission to sell.
 */
import { Conflict, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx, type TxClient } from '@/lib/db';

export const MANDATE_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

/**
 * Legal moves.
 *
 * Nothing returns from EXPIRED or TERMINATED. A lapsed agreement is not
 * re-opened, it is replaced — the owner signs again and that is a new mandate,
 * which is the history this table exists to keep. Reviving the old row would
 * erase the gap in which the agency had no right to market the property.
 */
const ALLOWED: Record<MandateStatus, readonly MandateStatus[]> = {
  DRAFT: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['EXPIRED', 'TERMINATED'],
  EXPIRED: [],
  TERMINATED: [],
};

export const canTransition = (from: MandateStatus, to: MandateStatus) => ALLOWED[from].includes(to);

/**
 * Mirrors the live mandate onto the listing.
 *
 * The listing carries `mandateType` and `mandateExpires` so the book can be
 * filtered and sorted on exclusivity without a join, and so "expires in 9 days"
 * is on the row rather than one click away. Written only from here, in the same
 * transaction as the mandate that changed.
 */
async function syncListing(tx: TxClient, tenantId: string, listingId: string) {
  const live = await tx.mandate.findFirst({
    where: { tenantId, listingId, status: 'ACTIVE' },
    select: { type: true, expiresAt: true },
  });

  await tx.listing.update({
    where: { id: listingId, tenantId },
    data: {
      mandateType: live?.type ?? null,
      mandateExpires: live?.expiresAt ?? null,
    },
  });
  return live;
}

export interface CreateMandateInput {
  tenantId: string;
  actorId: string;
  listingId: string;
  ownerId: string;
  type: 'EXCLUSIVE' | 'NON_EXCLUSIVE' | 'OPEN';
  startsAt: Date;
  expiresAt: Date;
  commissionPct?: number;
  documentKey?: string;
  /** Sign and activate in one step, which is what a countersigned PDF means. */
  activate?: boolean;
}

export async function createMandate(input: CreateMandateInput) {
  if (input.expiresAt <= input.startsAt) {
    throw Invalid([{ field: 'expiresAt', code: 'range', message: 'A mandate must end after it starts.' }]);
  }

  return withTx(input.tenantId, async (tx) => {
    const listing = await tx.listing.findFirst({
      where: { id: input.listingId, tenantId: input.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!listing) throw NotFound('Listing');

    if (input.activate) {
      // The partial unique index would refuse this anyway; catching it here
      // turns a constraint violation into a sentence somebody can act on.
      const live = await tx.mandate.findFirst({
        where: { tenantId: input.tenantId, listingId: input.listingId, status: 'ACTIVE' },
        select: { id: true, expiresAt: true },
      });
      if (live) {
        throw Conflict(
          `This listing already has a live mandate until ${live.expiresAt.toISOString().slice(0, 10)}. Terminate it first.`,
        );
      }
    }

    const mandate = await tx.mandate.create({
      data: {
        tenantId: input.tenantId,
        listingId: input.listingId,
        ownerId: input.ownerId,
        type: input.type,
        status: input.activate ? 'ACTIVE' : 'DRAFT',
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        commissionPct: input.commissionPct,
        documentKey: input.documentKey,
        signedAt: input.activate ? new Date() : null,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });

    if (input.activate) await syncListing(tx, input.tenantId, input.listingId);
    return mandate;
  });
}

export interface DecideMandateInput {
  tenantId: string;
  actorId: string;
  listingId: string;
  mandateId: string;
  to: MandateStatus;
  note?: string;
}

export async function decideMandate(input: DecideMandateInput) {
  return withTx(input.tenantId, async (tx) => {
    /**
     * Locked, for the same reason the unit board is.
     *
     * Two people activating two draft mandates on one listing in the same second
     * both pass the "is there a live one" read, and the partial unique index
     * then fails the second insert with a constraint name rather than a
     * sentence. The lock makes the check mean what it says.
     */
    const [current] = await tx.$queryRaw<{ id: string; status: MandateStatus; expiresAt: Date }[]>`
      SELECT "id", "status"::text AS status, "expiresAt"
      FROM "Mandate"
      WHERE "id" = ${input.mandateId} AND "tenantId" = ${input.tenantId} AND "listingId" = ${input.listingId}
      FOR UPDATE
    `;
    if (!current) throw NotFound('Mandate');

    if (!canTransition(current.status, input.to)) {
      throw Invalid([
        {
          field: 'status',
          code: 'illegal_transition',
          message: `A ${current.status.toLowerCase()} mandate cannot become ${input.to.toLowerCase()}.`,
        },
      ]);
    }

    if (input.to === 'ACTIVE') {
      if (current.expiresAt <= new Date()) {
        throw Invalid([
          { field: 'expiresAt', code: 'expired', message: 'This mandate has already lapsed. Raise a new one.' },
        ]);
      }
      const live = await tx.mandate.findFirst({
        where: { tenantId: input.tenantId, listingId: input.listingId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (live) throw Conflict('This listing already has a live mandate. Terminate it first.');
    }

    const mandate = await tx.mandate.update({
      where: { id: input.mandateId, tenantId: input.tenantId },
      data: {
        status: input.to,
        signedAt: input.to === 'ACTIVE' ? new Date() : undefined,
        terminatedAt: input.to === 'TERMINATED' ? new Date() : undefined,
        terminationNote: input.to === 'TERMINATED' ? input.note : undefined,
        updatedById: input.actorId,
      },
    });

    const live = await syncListing(tx, input.tenantId, input.listingId);

    /**
     * Losing the mandate takes the listing off the market.
     *
     * Not a suggestion and not a warning banner: without a live agreement there
     * is no permission to advertise, so the listing stops being ACTIVE in the
     * same transaction that ends the mandate. A listing already sold or
     * withdrawn is left alone — those are conclusions, not availability.
     */
    if (!live) {
      await tx.listing.updateMany({
        where: { id: input.listingId, tenantId: input.tenantId, status: { in: ['ACTIVE', 'UNDER_OFFER'] } },
        data: { status: input.to === 'EXPIRED' ? 'EXPIRED' : 'WITHDRAWN', updatedById: input.actorId },
      });
    }

    return { mandate, from: current.status };
  });
}

/**
 * Lapsed mandates, and the listings they were holding up.
 *
 * Called when somebody reads the book rather than by a cron, the same way
 * expired unit holds are released. The difference is that this one also changes
 * a listing's status, so it is worth saying plainly why that is still safe: a
 * mandate expiring is a fact about a date that has passed, and computing it
 * lazily gives the same answer whenever it is asked.
 *
 * ponytail: a repeatable `maintenance` job becomes worth it the day somebody
 * needs to be *told* their exclusive lapsed rather than discovering it when they
 * next open the list — that is a notification, and notifications need a clock.
 */
export async function expireLapsedMandates(tenantId: string): Promise<number> {
  const lapsed = await prisma.mandate.findMany({
    where: { tenantId, status: 'ACTIVE', expiresAt: { lt: new Date() } },
    select: { id: true, listingId: true },
    take: 500,
  });
  if (lapsed.length === 0) return 0;

  return withTx(tenantId, async (tx) => {
    await tx.mandate.updateMany({
      where: { tenantId, id: { in: lapsed.map((m) => m.id) } },
      data: { status: 'EXPIRED' },
    });

    const listingIds = [...new Set(lapsed.map((m) => m.listingId))];
    await tx.listing.updateMany({
      where: { tenantId, id: { in: listingIds }, status: { in: ['ACTIVE', 'UNDER_OFFER'] } },
      data: { status: 'EXPIRED' },
    });
    await tx.listing.updateMany({
      where: { tenantId, id: { in: listingIds } },
      data: { mandateType: null, mandateExpires: null },
    });

    return lapsed.length;
  });
}

/**
 * A listing may not go live without a mandate that is live too.
 *
 * Called from the listing PATCH rather than enforced by a constraint, because
 * the rule spans two tables and a database check cannot see across them.
 */
export async function assertMarketable(tenantId: string, listingId: string) {
  const live = await prisma.mandate.findFirst({
    where: { tenantId, listingId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!live) {
    throw Invalid([
      {
        field: 'status',
        code: 'no_mandate',
        message: 'This listing has no live mandate, so it cannot be published.',
      },
    ]);
  }
}
