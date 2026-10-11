import { SALES_OR_REALTY } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { can } from '@/lib/security/rbac';
import { assertEventInScope } from '@/lib/security/record-scope';
import { visibilityWhere } from '@/lib/security/visibility';

const params = z.object({ id: z.string().cuid() });

const addBody = z
  .object({
    invitees: z
      .array(
        z.object({
          leadId: z.string().cuid().optional(),
          contactId: z.string().cuid().optional(),
          email: z.string().email().optional(),
          phone: z.string().max(32).optional(),
          name: z.string().max(160).optional(),
          inviteChannel: z.enum(['EMAIL', 'WHATSAPP', 'SMS', 'IN_APP']).default('EMAIL'),
        }),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const POST = route(
  { module: 'events', productModule: SALES_OR_REALTY, action: 'EDIT', params, body: addBody },
  async ({ ctx, params, body }) => {
    await assertEventInScope(ctx, params.id, 'EDIT');
    // The event's callers see each invitee's lead by name and number on the
    // calls page, so every lead named must be one the caller can read already.
    // One lookup for the batch; a lead out of reach answers as a missing one.
    const leadIds = [...new Set(body.invitees.flatMap((inv) => inv.leadId ?? []))];
    if (leadIds.length > 0) {
      if (!can(ctx, 'leads', 'VIEW')) throw NotFound('Lead');
      const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
      const found = await prisma.lead.count({ where: { ...scope, id: { in: leadIds }, deletedAt: null } });
      if (found !== leadIds.length) throw NotFound('Lead');
    }
    const created = await prisma.eventInvitee.createMany({
      data: body.invitees.map((inv) => ({
        tenantId: ctx.tenantId,
        eventId: params.id,
        ...inv,
      })),
      skipDuplicates: true,
    });

    await prisma.event.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { registeredCount: { increment: created.count } },
    });

    return { added: created.count };
  },
);
