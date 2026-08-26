import { z } from 'zod';
import { mergeWhere } from '@/lib/api/where';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import {
  deactivateCode,
  issueCode,
  progressReferral,
  redeemCode,
  referrerScoreboard,
  REFERRAL_STATUSES,
} from '@/services/clients/referrals';

const listQuery = z
  .object({
    view: z.enum(['referrals', 'codes', 'scoreboard']).default('referrals'),
    status: z.enum(REFERRAL_STATUSES).optional(),
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const GET = route(
  { module: 'referrals', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    if (query.view === 'scoreboard') {
      return { data: await referrerScoreboard(ctx.tenantId, query.limit) };
    }

    const scope = await visibilityWhere(ctx, 'referrals', 'VIEW');

    if (query.view === 'codes') {
      const data = await prisma.referralCode.findMany({
        where: mergeWhere(
          scope,
          { deletedAt: null },
          query.leadId ? { leadId: query.leadId } : null,
          query.contactId ? { contactId: query.contactId } : null,
        ),
        include: { _count: { select: { referrals: true } } },
        orderBy: { issuedAt: 'desc' },
        take: query.limit,
      });
      return { data };
    }

    // Referrals carry no ownerId of their own — they belong to whoever owns the
    // code — so they are scoped through it rather than with a field that would
    // always be null.
    const data = await prisma.referral.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        code: { is: scope },
        ...(query.status ? { status: query.status } : {}),
        ...(query.leadId ? { referrerLeadId: query.leadId } : {}),
        ...(query.contactId ? { referrerContactId: query.contactId } : {}),
      },
      include: { code: { select: { code: true, leadId: true, contactId: true, ownerId: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { data };
  },
);

const issueBody = z
  .object({
    action: z.literal('ISSUE'),
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    expiresAt: z.coerce.date().optional(),
    maxUses: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .strict();

const redeemBody = z
  .object({
    action: z.literal('REDEEM'),
    code: z.string().min(4).max(32),
    referredLeadId: z.string().cuid(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

/**
 * Issuing a code, or crediting a lead to one.
 *
 * Both are POSTs because both create rows. Issuing is the referral request —
 * a code that exists is an ask that happened.
 */
export const POST = route(
  {
    module: 'referrals',
    productModule: 'SALES',
    action: 'CREATE',
    body: z.discriminatedUnion('action', [issueBody, redeemBody]),
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    if (body.action === 'ISSUE') {
      return issueCode({
        ctx,
        leadId: body.leadId,
        contactId: body.contactId,
        expiresAt: body.expiresAt,
        maxUses: body.maxUses,
      });
    }
    return redeemCode({ ctx, code: body.code, referredLeadId: body.referredLeadId, notes: body.notes });
  },
);

const progressBody = z
  .object({
    action: z.literal('PROGRESS'),
    referralId: z.string().cuid(),
    to: z.enum(REFERRAL_STATUSES),
    reason: z.string().max(1000).optional(),
  })
  .strict();

const deactivateBody = z.object({ action: z.literal('DEACTIVATE'), codeId: z.string().cuid() }).strict();

export const PATCH = route(
  {
    module: 'referrals',
    productModule: 'SALES',
    action: 'EDIT',
    body: z.discriminatedUnion('action', [progressBody, deactivateBody]),
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, body }) => {
    if (body.action === 'PROGRESS') {
      return progressReferral({ ctx, referralId: body.referralId, to: body.to, reason: body.reason });
    }
    return deactivateCode({ ctx, codeId: body.codeId });
  },
);
