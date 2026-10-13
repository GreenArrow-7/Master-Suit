import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { BATCH_CAP, queueLeadMessages } from '@/services/leads/leadMessages';

const body = z
  .object({
    leadIds: z.array(z.string().cuid()).min(1).max(BATCH_CAP),
    channel: z.enum(['WHATSAPP', 'EMAIL']),
    templateKey: z.string().trim().min(1).max(120),
    /** `{{3}}` onwards, the same for every lead; `{{1}}` and `{{2}}` are each lead's first name and the sender's. */
    variables: z.array(z.string().max(500)).max(20).optional(),
  })
  .strict();

/**
 * Send template on the lead grid (Lead Eagle audit row M4-38, the owner's
 * default: built for roles with the communications permission). Queues one
 * send per selected lead the sender may message, a workspace's sends spaced
 * one a second, each logged and audited on its lead when it goes; answers what
 * was queued and what was skipped, and why. At most `BATCH_CAP` leads.
 */
export const POST = route(
  {
    module: 'communications',
    productModule: LEAD_MODULES,
    action: 'CREATE',
    body,
    rateLimit: { max: 30, windowSeconds: 300 },
  },
  async ({ ctx, body }) => queueLeadMessages(ctx, body),
);
