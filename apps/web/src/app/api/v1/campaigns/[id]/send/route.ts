import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { NotFound, Invalid } from '@/lib/errors';
import { sendCampaignBatch } from '@/services/campaigns/send';

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

/**
 * "Send now". The pipeline itself lives in services/campaigns/send — the
 * scheduler worker runs the identical code when a SCHEDULED campaign's start
 * date arrives; this route only translates refusals into HTTP.
 */
export const POST = route(
  { module: 'campaigns', productModule: 'SALES', action: 'EDIT', params, body, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const outcome = await sendCampaignBatch({
      tenantId: ctx.tenantId,
      campaignId: params.id,
      template: body.template,
      language: body.language,
      resend: body.resend,
      actorId: ctx.actor.id,
    });

    if (!outcome.ok) {
      if (outcome.reason === 'not_found') throw NotFound('Campaign');
      if (outcome.reason === 'not_sendable') {
        throw Invalid([
          { field: 'status', code: 'not_sendable', message: 'A completed or cancelled campaign cannot send.' },
        ]);
      }
      throw Invalid([
        {
          field: 'integration',
          code: 'not_connected',
          message: 'Connect WhatsApp Business before sending a campaign.',
        },
      ]);
    }

    const { sent, failed, remaining } = outcome;
    return { sent, failed, remaining };
  },
);
