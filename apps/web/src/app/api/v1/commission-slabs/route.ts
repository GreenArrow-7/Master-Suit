import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { can } from '@/lib/security/rbac';
import { orderedBands, SlabError, type Band } from '@/services/money/slabs';

const MODES = ['PROGRESSIVE', 'FLAT'] as const;
const BASES = ['PERCENT_OF_SALE', 'PERCENT_OF_AGENCY_FEE', 'FIXED'] as const;

export const GET = route({ module: 'commissionslabs', productModule: 'SALES', action: 'VIEW' }, async ({ ctx }) => {
  const data = await prisma.commissionSlab.findMany({
    where: { tenantId: ctx.tenantId },
    include: { bands: { orderBy: { position: 'asc' } }, _count: { select: { commissions: true } } },
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
    take: 200,
  });
  return { data };
});

const bandInput = z.object({
  fromAmount: z.coerce.number().nonnegative(),
  toAmount: z.coerce.number().positive().nullable().optional(),
  ratePct: z.coerce.number().min(0).max(100).nullable().optional(),
  fixedAmount: z.coerce.number().nonnegative().nullable().optional(),
});

const createBody = z
  .object({
    name: z.string().min(2).max(120),
    mode: z.enum(MODES).default('PROGRESSIVE'),
    basis: z.enum(BASES).default('PERCENT_OF_SALE'),
    projectId: z.string().cuid().optional(),
    developerId: z.string().cuid().optional(),
    listingType: z.enum(['SALE', 'RENT']).optional(),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional(),
    currency: z.string().length(3).default('AED'),
    bands: z.array(bandInput).min(1).max(20),
  })
  .strict();

/**
 * Drafting a commission slab.
 *
 * Created unapproved, always. The spec requires finance to sign the rules off
 * before they are used, so `approvedById` is not a field this endpoint accepts —
 * signing is a separate call by somebody holding `commissionslabs:APPROVE`, and
 * `accrueCommission` ignores anything unsigned.
 *
 * The bands are validated here rather than only at accrual, because a slab with
 * a hole in it is a payroll incident discovered on payday. The same function
 * that applies a slab is the one that checks it.
 */
export const POST = route(
  {
    module: 'commissionslabs',
    productModule: 'SALES',
    action: 'EDIT',
    body: createBody,
    auditEvent: 'PERMISSION_CHANGED',
  },
  async ({ ctx, body }) => {
    const bands: Band[] = body.bands.map((b) => ({
      fromAmount: new Prisma.Decimal(b.fromAmount),
      toAmount: b.toAmount == null ? null : new Prisma.Decimal(b.toAmount),
      ratePct: b.ratePct == null ? null : new Prisma.Decimal(b.ratePct),
      fixedAmount: b.fixedAmount == null ? null : new Prisma.Decimal(b.fixedAmount),
    }));

    try {
      orderedBands(bands);
    } catch (err) {
      if (err instanceof SlabError) {
        throw Invalid([{ field: 'bands', code: 'invalid_bands', message: err.message }]);
      }
      throw err;
    }

    for (const b of body.bands) {
      const hasRate = b.ratePct != null;
      const hasFixed = b.fixedAmount != null;
      if (hasRate === hasFixed) {
        throw Invalid([
          {
            field: 'bands',
            code: 'ambiguous',
            message: 'Each band pays either a percentage or a fixed amount — one of the two, never both.',
          },
        ]);
      }
    }

    return withTx(ctx.tenantId, async (tx) => {
      // A new rate is a new version, never an edit. February must stay payable
      // at February's rate after March's is agreed.
      const previous = await tx.commissionSlab.findFirst({
        where: { tenantId: ctx.tenantId, name: body.name },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      const { bands: _bands, ...slabData } = body;
      const slab = await tx.commissionSlab.create({
        data: {
          tenantId: ctx.tenantId,
          version: (previous?.version ?? 0) + 1,
          createdById: ctx.actor.id,
          ...slabData,
        },
      });

      await tx.commissionSlabBand.createMany({
        data: body.bands.map((b, i) => ({
          tenantId: ctx.tenantId,
          slabId: slab.id,
          fromAmount: b.fromAmount,
          toAmount: b.toAmount ?? null,
          ratePct: b.ratePct ?? null,
          fixedAmount: b.fixedAmount ?? null,
          position: i,
        })),
      });

      return tx.commissionSlab.findFirstOrThrow({
        where: { id: slab.id, tenantId: ctx.tenantId },
        include: { bands: { orderBy: { position: 'asc' } } },
      });
    });
  },
);

const approveBody = z
  .object({
    slabId: z.string().cuid(),
    note: z.string().max(1000).optional(),
  })
  .strict();

/**
 * Finance signing a slab off.
 *
 * The gate the whole module hangs on. Its own permission, its own call, and it
 * closes the previous version of the same slab so two approved versions never
 * both claim the same date — which would make accrual depend on sort order.
 */
export const PATCH = route(
  {
    module: 'commissionslabs',
    productModule: 'SALES',
    action: 'APPROVE',
    body: approveBody,
    auditEvent: 'PERMISSION_CHANGED',
  },
  async ({ ctx, body }) => {
    if (!can(ctx, 'commissionslabs', 'APPROVE')) throw Forbidden('Signing off a commission slab is finance’s call.');

    return withTx(ctx.tenantId, async (tx) => {
      const slab = await tx.commissionSlab.findFirst({
        where: { id: body.slabId, tenantId: ctx.tenantId },
        include: { bands: true },
      });
      if (!slab) throw NotFound('Commission slab');
      if (slab.approvedById) throw Conflict('This slab is already signed off. Draft a new version instead.');
      if (slab.bands.length === 0) throw Conflict('This slab has no bands, so it cannot pay anything.');

      // Whoever drafted it does not sign it. Two pairs of eyes on the rules that
      // decide what everybody is paid.
      if (slab.createdById === ctx.actor.id) {
        throw Forbidden('You drafted this slab. Someone else has to sign it off.');
      }

      await tx.commissionSlab.updateMany({
        where: {
          tenantId: ctx.tenantId,
          name: slab.name,
          id: { not: slab.id },
          approvedById: { not: null },
          effectiveTo: null,
        },
        data: { effectiveTo: slab.effectiveFrom },
      });

      return tx.commissionSlab.update({
        where: { id: slab.id, tenantId: ctx.tenantId },
        data: { approvedById: ctx.actor.id, approvedAt: new Date(), approvalNote: body.note },
        include: { bands: { orderBy: { position: 'asc' } } },
      });
    });
  },
);
