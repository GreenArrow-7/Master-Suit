import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { sendLeadMessage } from '@/services/leads/leadMessages';

const params = z.object({ id: z.string().cuid() });

const body = z
  .object({
    channel: z.enum(['WHATSAPP', 'EMAIL']),
    templateKey: z.string().trim().min(1).max(120),
    /** WhatsApp only: "main", or the id of another of the lead's numbers. Never a number itself. */
    to: z.union([z.literal('main'), z.string().cuid()]).optional(),
    /** Values for `{{1}}`, `{{2}}`…, in order; empty ones take the lead's first name and the sender's. */
    variables: z.array(z.string().max(500)).max(20).optional(),
  })
  .strict();

/**
 * Send a WhatsApp template or an email template to the lead, from its page
 * (Lead Eagle audit row M4-28). The inbox's own send (`communications:CREATE`),
 * under the lead's scope (`leads:EDIT`, 404 outside it): a Communication on
 * the lead and its timeline, audited. Refused with the reason when the lead
 * opted out of the channel or has no number marked as on WhatsApp, or no email.
 * The address is the lead's, never the request's, and is never in the answer.
 */
export const POST = route(
  {
    module: 'communications',
    productModule: LEAD_MODULES,
    action: 'CREATE',
    params,
    body,
    // Writing to customers: a stuck dialog must not fan out.
    rateLimit: { max: 30, windowSeconds: 300 },
  },
  async ({ ctx, params, body }) => ({ message: await sendLeadMessage(ctx, params.id, body) }),
);
