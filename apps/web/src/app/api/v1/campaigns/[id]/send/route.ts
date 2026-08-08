import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { NotFound, Invalid } from '@/lib/errors';
import { getWhatsAppProvider } from '@/lib/integrations/whatsapp';
import { connectionCredentials } from '@/lib/integrations/connection';

const params = z.object({ id: z.string().cuid() });

const body = z
  .object({
    /** An approved Meta message template. Business-initiated WhatsApp cannot send free text. */
    template: z.string().min(1).max(120),
    language: z.string().min(2).max(10).default('en'),
    /** Send again to leads this campaign has already messaged on WhatsApp. */
    resend: z.boolean().default(false),
  })
  .strict();

/** ponytail: sequential send, capped per request. Move to the BullMQ queue in
 *  src/lib/queue.ts once a campaign audience outgrows a single request. */
const BATCH_LIMIT = 100;

export const POST = route(
  { module: 'campaigns', productModule: 'SALES', action: 'EDIT', params, body, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!campaign) throw NotFound('Campaign');
    if (campaign.status === 'CANCELLED' || campaign.status === 'COMPLETED') {
      throw Invalid([
        { field: 'status', code: 'not_sendable', message: `A ${campaign.status.toLowerCase()} campaign cannot send.` },
      ]);
    }

    const credentials = await connectionCredentials(ctx.tenantId, 'meta');
    if (!credentials?.accessToken || !credentials?.phoneNumberId) {
      throw Invalid([
        {
          field: 'integration',
          code: 'not_connected',
          message: 'Connect WhatsApp Business before sending a campaign.',
        },
      ]);
    }

    // Promotional contact is consent-gated: an UNKNOWN or WITHDRAWN lead, or one
    // flagged do-not-call, is never messaged regardless of campaign membership.
    const alreadySent = body.resend
      ? []
      : await prisma.communication.findMany({
          where: { tenantId: ctx.tenantId, campaignId: campaign.id, channel: 'WHATSAPP', status: { not: 'FAILED' } },
          select: { leadId: true },
        });

    const leads = await prisma.lead.findMany({
      where: {
        tenantId: ctx.tenantId,
        campaignId: campaign.id,
        deletedAt: null,
        doNotCall: false,
        consentStatus: { in: ['GRANTED', 'IMPLIED'] },
        phone: { not: null },
        id: { notIn: alreadySent.map((c) => c.leadId!).filter(Boolean) },
      },
      select: { id: true, fullName: true, phone: true },
      take: BATCH_LIMIT,
    });
    if (leads.length === 0) return { sent: 0, failed: 0, remaining: 0 };

    const provider = getWhatsAppProvider('meta', credentials);
    let sent = 0;
    let failed = 0;

    for (const lead of leads) {
      const result = await provider.sendTemplate({
        to: lead.phone!,
        template: {
          name: body.template,
          language: body.language,
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: lead.fullName },
                { type: 'text', text: campaign.name },
              ],
            },
          ],
        },
      });

      const ok = result.status !== 'failed';
      if (ok) sent += 1;
      else failed += 1;
      if (!ok)
        logger.warn({ campaignId: campaign.id, leadId: lead.id, code: result.errorCode }, 'campaign send failed');

      await prisma.communication.create({
        data: {
          tenantId: ctx.tenantId,
          channel: 'WHATSAPP',
          direction: 'OUTBOUND',
          status: ok ? 'SENT' : 'FAILED',
          leadId: lead.id,
          campaignId: campaign.id,
          toAddress: lead.phone!,
          body: `template:${body.template}`,
          providerKey: 'meta',
          providerMessageId: result.externalMessageId || null,
          errorCode: result.errorCode ?? null,
          errorMessage: result.errorMessage ?? null,
          sentAt: ok ? new Date() : null,
          ownerId: campaign.ownerId,
          createdById: ctx.actor.id,
        },
      });
    }

    if (sent > 0 && campaign.status === 'DRAFT') {
      await prisma.campaign.update({
        where: { id: campaign.id, tenantId: ctx.tenantId },
        data: { status: 'RUNNING', updatedById: ctx.actor.id },
      });
    }

    const remaining = await prisma.lead.count({
      where: {
        tenantId: ctx.tenantId,
        campaignId: campaign.id,
        deletedAt: null,
        doNotCall: false,
        consentStatus: { in: ['GRANTED', 'IMPLIED'] },
        phone: { not: null },
        communications: { none: { campaignId: campaign.id, channel: 'WHATSAPP', status: { not: 'FAILED' } } },
      },
    });

    return { sent, failed, remaining };
  },
);
