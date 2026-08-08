import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict } from '@/lib/errors';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { maskOwner } from '@/lib/inventory/listings';

const listQuery = z
  .object({
    q: z.string().max(120).optional(),
    phone: z.string().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const SAFE_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  whatsappNumber: true,
  nationality: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { listings: true } },
} as const;

/**
 * Property owners — the agency's book of landlords and vendors.
 *
 * Contact details are masked unless the caller holds
 * `listings:VIEW_SENSITIVE_FIELDS`. A phone-number search still works while
 * masked, deliberately: checking whether the agency already knows a number is
 * exactly what stops the same owner being entered three times, and it reveals
 * nothing the caller did not already type.
 */
export const GET = route(
  { module: 'listings', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const normalized = query.phone ? normalizePhone(query.phone) : null;

    const data = await prisma.owner.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        ...(query.q ? { fullName: { contains: query.q, mode: 'insensitive' as const } } : {}),
        ...(normalized ? { phoneNormalized: normalized } : {}),
      },
      select: SAFE_SELECT,
      orderBy: { fullName: 'asc' },
      take: query.limit,
    });

    return { data: data.map((owner) => maskOwner(ctx, owner)) };
  },
);

const createBody = z
  .object({
    fullName: z.string().min(2).max(200),
    phone: z.string().max(30).optional(),
    email: z.string().email().max(200).optional(),
    whatsappNumber: z.string().max(30).optional(),
    nationality: z.string().max(80).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

export const POST = route(
  {
    module: 'listings',
    productModule: 'SALES',
    action: 'CREATE',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    const phoneNormalized = body.phone ? normalizePhone(body.phone) : null;

    /**
     * Refused rather than merged.
     *
     * Two records for one landlord means two agents each believing they have
     * the relationship, and the owner receiving the same pitch twice. Merging
     * automatically would be worse — it silently reassigns whoever was there
     * first. So the second attempt is told where the first one is.
     */
    if (phoneNormalized) {
      const existing = await prisma.owner.findFirst({
        where: { tenantId: ctx.tenantId, phoneNormalized, deletedAt: null },
        select: { id: true, fullName: true },
      });
      if (existing) {
        throw Conflict(`That number already belongs to ${existing.fullName} (${existing.id}).`);
      }
    }

    const owner = await prisma.owner.create({
      data: {
        tenantId: ctx.tenantId,
        phoneNormalized,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
        ...body,
      },
      select: SAFE_SELECT,
    });

    return maskOwner(ctx, owner);
  },
);
