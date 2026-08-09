import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getWhatsAppProvider } from '@/lib/integrations/whatsapp';
import { connectionCredentials } from '@/lib/integrations/connection';

/**
 * One batch of a campaign's WhatsApp send. Extracted from the send route so the
 * scheduler worker and the "send now" button run the identical pipeline —
 * consent gating, dedup against prior sends, per-lead Communication evidence,
 * and the DRAFT/SCHEDULED → RUNNING transition.
 *
 * ponytail: sequential send, capped per call. Move the loop onto per-lead
 * queue jobs once a campaign audience outgrows sequential delivery.
 */
export const BATCH_LIMIT = 100;

export type SendOutcome =
  | { ok: false; reason: 'not_found' | 'not_sendable' | 'not_connected' }
  | { ok: true; sent: number; failed: number; remaining: number };

export async function sendCampaignBatch(input: {
  tenantId: string;
  campaignId: string;
  /** An approved Meta message template. Business-initiated WhatsApp cannot send free text. */
  template: string;
  language?: string;
  /** Send again to leads this campaign has already messaged on WhatsApp. */
  resend?: boolean;
  /** Who pressed the button; null when the scheduler did. */
  actorId?: string | null;
}): Promise<SendOutcome> {
  const { tenantId, campaignId } = input;
  const language = input.language ?? 'en';

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId, deletedAt: null },
  });
  if (!campaign) return { ok: false, reason: 'not_found' };
  if (campaign.status === 'CANCELLED' || campaign.status === 'COMPLETED') {
    return { ok: false, reason: 'not_sendable' };
  }

  const credentials = await connectionCredentials(tenantId, 'meta');
  if (!credentials?.accessToken || !credentials?.phoneNumberId) {
    return { ok: false, reason: 'not_connected' };
  }

  // Promotional contact is consent-gated: an UNKNOWN or WITHDRAWN lead, or one
  // flagged do-not-call, is never messaged regardless of campaign membership.
  const alreadySent = input.resend
    ? []
    : await prisma.communication.findMany({
        where: { tenantId, campaignId: campaign.id, channel: 'WHATSAPP', status: { not: 'FAILED' } },
        select: { leadId: true },
      });

  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
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

  const provider = getWhatsAppProvider('meta', credentials);
  let sent = 0;
  let failed = 0;

  for (const lead of leads) {
    const result = await provider.sendTemplate({
      to: lead.phone!,
      template: {
        name: input.template,
        language,
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
    if (!ok) logger.warn({ campaignId: campaign.id, leadId: lead.id, code: result.errorCode }, 'campaign send failed');

    await prisma.communication.create({
      data: {
        tenantId,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        status: ok ? 'SENT' : 'FAILED',
        leadId: lead.id,
        campaignId: campaign.id,
        toAddress: lead.phone!,
        body: `template:${input.template}`,
        providerKey: 'meta',
        providerMessageId: result.externalMessageId || null,
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
        sentAt: ok ? new Date() : null,
        ownerId: campaign.ownerId,
        createdById: input.actorId ?? null,
      },
    });
  }

  if (sent > 0 && (campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED')) {
    await prisma.campaign.update({
      where: { id: campaign.id, tenantId },
      data: { status: 'RUNNING', updatedById: input.actorId ?? null },
    });
  }

  const remaining = await prisma.lead.count({
    where: {
      tenantId,
      campaignId: campaign.id,
      deletedAt: null,
      doNotCall: false,
      consentStatus: { in: ['GRANTED', 'IMPLIED'] },
      phone: { not: null },
      communications: { none: { campaignId: campaign.id, channel: 'WHATSAPP', status: { not: 'FAILED' } } },
    },
  });

  return { ok: true, sent, failed, remaining };
}
