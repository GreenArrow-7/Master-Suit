import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { assignSocialLead } from '@/services/social/assignSocialLead';

/**
 * Manual ownership of a social enquiry. All the rules live in the service; this
 * only shapes the request and hands over the session context.
 */
const params = z.object({ id: z.string().min(1).max(60) });

const body = z
  .object({
    toUserId: z.string().max(60).nullish(),
    toTeamId: z.string().max(60).nullish(),
    reason: z.string().trim().max(300).nullish(),
  })
  .strict()
  // A destination is a person or a team, never both: two would leave the
  // service guessing which the manager meant.
  .refine((v) => Boolean(v.toUserId) !== Boolean(v.toTeamId), {
    message: 'Choose a person or a team, not both.',
  });

export const POST = route(
  { module: 'leads', action: 'VIEW', params, body, auditEvent: 'OWNER_CHANGED' },
  async ({ ctx, params, body }) =>
    assignSocialLead(ctx, {
      socialCommentId: params.id,
      toUserId: body.toUserId ?? null,
      toTeamId: body.toTeamId ?? null,
      reason: body.reason ?? null,
    }),
);
