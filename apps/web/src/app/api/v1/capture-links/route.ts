import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';

/**
 * QR capture links (Lead Eagle plan, gap 4). Agents make their own — the one at
 * the stand is the one who should get the lead — so this is leads:CREATE, the
 * same power as typing the lead in. And as there, only leads:ASSIGN sends the
 * leads to someone else or to distribution: anyone else's link is their own.
 */
const body = z
  .object({
    label: z.string().trim().min(2).max(80),
    headline: z.string().trim().max(120).optional(),
    ownerId: z.string().cuid().nullable().optional(),
    campaign: z.string().trim().max(80).optional(),
  })
  .strict();

export const POST = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'CREATE',
    body,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    const ownerId = can(ctx, 'leads', 'ASSIGN') ? (body.ownerId ?? null) : ctx.actor.id;
    if (ownerId && ownerId !== ctx.actor.id) {
      const agent = await prisma.user.findFirst({
        where: { tenantId: ctx.tenantId, id: ownerId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!agent) throw NotFound('User');
    }
    // Readable, and unguessable enough: the page behind it is a blank form.
    const slug = body.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    return prisma.captureLink.create({
      data: {
        tenantId: ctx.tenantId,
        key: `${slug || 'link'}-${randomBytes(3).toString('hex')}`,
        label: body.label,
        headline: body.headline || null,
        ownerId,
        campaign: body.campaign || null,
        createdById: ctx.actor.id,
      },
      select: { id: true, key: true },
    });
  },
);
