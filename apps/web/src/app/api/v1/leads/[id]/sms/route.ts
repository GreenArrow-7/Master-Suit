import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { SMS_MAX_LENGTH } from '@/lib/sms';
import { sendLeadSms } from '@/services/leads/leadSms';

const params = z.object({ id: z.string().cuid() });

const body = z.object({ body: z.string().trim().min(1).max(SMS_MAX_LENGTH) }).strict();

/**
 * Send a text to the lead, from its page (Lead Eagle audit row M4-29), as
 * Send WhatsApp is sent (`communications:CREATE`, under the lead's
 * `leads:EDIT` scope, 404 outside it): through the workspace's calling
 * provider when it sends SMS, from the SMS sender on its card, 403 with the
 * reason when that is not set up. Refused with the reason for a lead with no
 * number, one that opted out of SMS or withdrew consent, or one on the
 * do-not-call list. An SMS Communication on the lead and its timeline,
 * audited, sent or failed; the number is never in the answer.
 */
export const POST = route(
  {
    module: 'communications',
    productModule: LEAD_MODULES,
    action: 'CREATE',
    params,
    body,
    // Each text costs the workspace money and reaches a customer's phone.
    rateLimit: { max: 20, windowSeconds: 300 },
  },
  async ({ ctx, params, body }) => ({ message: await sendLeadSms(ctx, params.id, body.body) }),
);
