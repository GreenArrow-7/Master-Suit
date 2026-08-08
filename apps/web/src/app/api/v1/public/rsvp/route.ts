import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { loadInvitation, publicView, recordAnswer, recordView } from '@/lib/events/rsvp';

/**
 * The invitee's own RSVP. Unauthenticated by design — the token is the credential.
 *
 * A bad token is a 404, never a 403: a 403 would confirm that a given invitee
 * exists, which is enough to enumerate an event's guest list.
 *
 * Rate limited per IP rather than per actor, because there is no actor. The
 * thing being slowed down is someone working through guesses, not one invitee
 * refreshing their page.
 */
const query = z.object({ token: z.string().min(20).max(300) });

const body = z
  .object({
    token: z.string().min(20).max(300),
    rsvpStatus: z.enum(['CONFIRMED', 'DECLINED', 'TENTATIVE']),
  })
  .strict();

export const GET = route(
  { module: 'events', action: 'VIEW', anonymous: true, query, rateLimit: { max: 30, windowSeconds: 60 } },
  async ({ query }) => {
    const invitation = await loadInvitation(query.token);
    await recordView(invitation);
    return publicView(invitation);
  },
);

export const POST = route(
  { module: 'events', action: 'EDIT', anonymous: true, body, rateLimit: { max: 20, windowSeconds: 60 } },
  async ({ body }) => publicView(await recordAnswer(await loadInvitation(body.token), body.rsvpStatus)),
);
