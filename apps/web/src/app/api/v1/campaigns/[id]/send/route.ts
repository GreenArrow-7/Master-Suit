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
 * What a campaign on each other channel is worked by, said in the refusal.
 *
 * Calls are real and have their own screen. Email and SMS have neither a sender
 * nor a worker — `EmailCampaign` is a table with no code behind it — so the
 * honest answer is that nothing sends them, rather than a hint at a queue that
 * would never pick them up.
 */
const HOW_IT_IS_WORKED: Record<string, string> = {
  VOICE: 'This is a calling campaign. Work it from the dialer — “Open dialer” on the campaign — not from here.',
  EMAIL: 'This is an email campaign, and nothing sends those yet. Only WhatsApp campaigns can be sent.',
  SMS: 'This is an SMS campaign, and nothing sends those yet. Only WhatsApp campaigns can be sent.',
};

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
      if (outcome.reason === 'wrong_channel') {
        // This route sent WhatsApp templates to the audience of any campaign,
        // whatever channel it stated. The refusal is in the service; this names
        // the channel and what actually works on it, because "cannot send" with
        // no reason is what makes somebody press the button again.
        throw Invalid([
          {
            field: 'channel',
            code: 'wrong_channel',
            message: HOW_IT_IS_WORKED[outcome.channel] ?? `This is a ${outcome.channel} campaign; only WhatsApp sends.`,
          },
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
