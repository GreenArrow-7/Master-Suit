import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

/**
 * Who this campaign talks to. Attaching sets `lead.campaignId` — the same field
 * the WhatsApp send and the dialer queue already select on — so everything
 * downstream works the moment a lead is in.
 */
const body = z
  .object({
    add: z.array(z.string().cuid()).max(500).default([]),
    remove: z.array(z.string().cuid()).max(500).default([]),
  })
  .strict()
  .refine((b) => b.add.length + b.remove.length > 0, { message: 'Nothing to change.' });

export const POST = route(
  { module: 'campaigns', productModule: 'SALES', action: 'EDIT', params, body, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!campaign) throw NotFound('Campaign');

    const [added, removed] = await Promise.all([
      body.add.length
        ? prisma.lead.updateMany({
            where: { tenantId: ctx.tenantId, id: { in: body.add }, deletedAt: null },
            data: { campaignId: campaign.id },
          })
        : { count: 0 },
      body.remove.length
        ? prisma.lead.updateMany({
            // Only detach leads that are actually on THIS campaign; a stale id
            // from another campaign's list must not be yanked off it.
            where: { tenantId: ctx.tenantId, id: { in: body.remove }, campaignId: campaign.id },
            data: { campaignId: null },
          })
        : { count: 0 },
    ]);

    return { added: added.count, removed: removed.count };
  },
);
