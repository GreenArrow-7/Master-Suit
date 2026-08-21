import { prisma, withPlatformTx } from '@/lib/db';
import { logger } from '@/lib/logger';
import { sendCampaignBatch } from './send';

/**
 * The campaign lifecycle sweep, run once a minute by the campaign worker.
 *
 * A polling sweep rather than one delayed job per campaign, on purpose: it
 * needs no bookkeeping when a start date is edited, survives a Redis flush,
 * and picks up rows however they became due — including campaigns scheduled
 * before this worker existed.
 *
 *   SCHEDULED, startDate reached  → send (WhatsApp, template from the
 *                                   campaign) and mark RUNNING
 *   SCHEDULED, cannot send        → PAUSED, with the reason logged — an
 *                                   honest "did not start", visible in the
 *                                   UI, instead of silently staying due
 *   RUNNING, endDate passed       → COMPLETED
 *
 * Finding the due rows is the one legitimately cross-tenant step, so it runs
 * as a raw query inside withPlatformTx — the same platform-admin assertion the
 * control plane uses — and closes the transaction before any network I/O.
 * Everything that acts on a campaign then names its tenant like every other
 * query in the codebase, so the guard and RLS stay fully engaged.
 */

/** ponytail: 50 batches × BATCH_LIMIT = 5 000 sends per campaign per sweep;
 *  split into per-batch queue jobs if audiences outgrow that. */
const MAX_BATCHES = 50;

interface DueRow {
  id: string;
  tenantId: string;
  name: string;
  channel: string | null;
  customData: { whatsappTemplate?: string; whatsappLanguage?: string } | null;
}

export async function sweepDueCampaigns(now = new Date()) {
  const summary = { started: 0, sent: 0, paused: 0, completed: 0 };

  const { due, finished } = await withPlatformTx(async (tx) => {
    const due = await tx.$queryRaw<DueRow[]>`
      SELECT "id", "tenantId", "name", "channel", "customData"
      FROM "Campaign"
      WHERE "status" = 'SCHEDULED' AND "startDate" <= ${now} AND "deletedAt" IS NULL`;
    const finished = await tx.$queryRaw<DueRow[]>`
      SELECT "id", "tenantId", "name", "channel", "customData"
      FROM "Campaign"
      WHERE "status" = 'RUNNING' AND "endDate" < ${now} AND "deletedAt" IS NULL`;
    return { due, finished };
  });

  for (const campaign of due) {
    const config = campaign.customData ?? {};

    if (campaign.channel === 'WHATSAPP') {
      if (!config.whatsappTemplate) {
        await pause(campaign, 'no WhatsApp template configured');
        summary.paused += 1;
        continue;
      }

      let batches = 0;
      let sentTotal = 0;
      let outcome = await send(campaign, config);
      while (outcome.ok && outcome.remaining > 0 && ++batches < MAX_BATCHES) {
        sentTotal += outcome.sent;
        outcome = await send(campaign, config);
      }

      if (!outcome.ok) {
        // not_connected is the realistic case: WhatsApp was disconnected
        // between scheduling and the start date.
        await pause(campaign, `send refused: ${outcome.reason}`);
        summary.paused += 1;
        continue;
      }
      sentTotal += outcome.sent;
      summary.sent += sentTotal;
    }

    // Started — even a WhatsApp campaign with nothing eligible to send.
    //
    // A VOICE campaign is started for the dialer, which works its
    // `CampaignContact` rows whenever an agent opens it; the route selects the
    // campaign's status and does not read it, so RUNNING is a label here rather
    // than a gate. Whether a COMPLETED campaign should still be diallable is an
    // open question and not one this sweep should answer quietly.
    //
    // An EMAIL or SMS campaign is started too, and nothing works it: there is no
    // sender and no worker for either, and `EmailCampaign` is a table with no
    // code behind it. This comment used to say all three were "worked by other
    // flows", which was true of one of them. The composer and the send route now
    // say the same thing to the operator rather than leaving it here.
    await prisma.campaign.update({
      where: { id: campaign.id, tenantId: campaign.tenantId },
      data: { status: 'RUNNING' },
    });
    summary.started += 1;
    logger.info({ campaignId: campaign.id, name: campaign.name }, 'campaign started on schedule');
  }

  for (const campaign of finished) {
    await prisma.campaign.update({
      where: { id: campaign.id, tenantId: campaign.tenantId },
      data: { status: 'COMPLETED' },
    });
    summary.completed += 1;
    logger.info({ campaignId: campaign.id, name: campaign.name }, 'campaign completed on schedule');
  }

  return summary;
}

const send = (campaign: DueRow, config: { whatsappTemplate?: string; whatsappLanguage?: string }) =>
  sendCampaignBatch({
    tenantId: campaign.tenantId,
    campaignId: campaign.id,
    template: config.whatsappTemplate!,
    language: config.whatsappLanguage,
  });

async function pause(campaign: DueRow, reason: string) {
  logger.warn({ campaignId: campaign.id, name: campaign.name, reason }, 'scheduled campaign could not start');
  await prisma.campaign.update({
    where: { id: campaign.id, tenantId: campaign.tenantId },
    data: { status: 'PAUSED' },
  });
}
