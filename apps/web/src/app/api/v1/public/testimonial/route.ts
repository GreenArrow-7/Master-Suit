import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { NotFound } from '@/lib/errors';
import { requestForToken, submitTestimonial } from '@/services/clients/testimonials';

/**
 * The client writing their own testimonial. Unauthenticated by design — the
 * token is the credential.
 *
 * A bad token is a 404, never a 403, for the same reason the RSVP path does it:
 * a 403 would confirm that a given request exists, which is enough to work out
 * who a workspace has been asking.
 *
 * Rate limited per IP rather than per actor, because there is no actor. The
 * thing being slowed down is somebody working through guesses, not one client
 * rereading what they wrote.
 */
const query = z.object({ token: z.string().min(20).max(300) });

const body = z
  .object({
    token: z.string().min(20).max(300),
    rating: z.coerce.number().int().min(1).max(5),
    body: z.string().min(1).max(4000),
    consentToPublish: z.boolean(),
    displayName: z.string().max(120).optional(),
  })
  .strict();

export const GET = route(
  { module: 'testimonials', action: 'VIEW', anonymous: true, query, rateLimit: { max: 30, windowSeconds: 60 } },
  async ({ query: q }) => {
    const request = await requestForToken(q.token);
    if (!request) throw NotFound('Testimonial request');
    return request;
  },
);

export const POST = route(
  { module: 'testimonials', action: 'EDIT', anonymous: true, body, rateLimit: { max: 10, windowSeconds: 60 } },
  async ({ body: b }) => {
    const testimonial = await submitTestimonial({
      token: b.token,
      rating: b.rating,
      body: b.body,
      consentToPublish: b.consentToPublish,
      displayName: b.displayName,
    });
    // Deliberately not the row: the client does not need to be told who owns
    // their record or what status it moved to internally.
    return { status: testimonial.status, submittedAt: testimonial.submittedAt };
  },
);
