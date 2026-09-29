import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { react } from '@/lib/proposals/publicProposal';

/**
 * A client saying what they think of one property. Unauthenticated by design —
 * the token in their link is the credential.
 *
 * A bad token is a 404, never a 403, for the reason the RSVP and testimonial
 * paths give: a 403 confirms the record exists, which is enough to work out who
 * a workspace has been talking to. `react` reloads the proposal through the
 * same loader the page uses, so a withdrawn or expired link cannot be written
 * through after the client's tab has been open all week.
 *
 * Rate limited per IP, because there is no actor. What is being slowed is
 * somebody working through guesses, not a couple deciding on a Sunday.
 */
const body = z
  .object({
    token: z.string().min(20).max(300),
    itemId: z.string().min(1).max(64),
    /** Null clears an answer — people change their minds, and so may they. */
    reaction: z.enum(['INTERESTED', 'NOT_INTERESTED']).nullable(),
    comment: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const POST = route(
  { module: 'requirements', action: 'EDIT', anonymous: true, body, rateLimit: { max: 30, windowSeconds: 60 } },
  async ({ body: b }) => {
    await react(b.token, b.itemId, b.reaction, b.comment ?? null);
    return { ok: true };
  },
);
