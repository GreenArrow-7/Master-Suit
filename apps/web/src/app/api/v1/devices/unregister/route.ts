import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const body = z.object({ token: z.string().min(16).max(4096) }).strict();

/**
 * Stop pushing to this handset. Called on sign-out, before the session is
 * revoked — without it a phone keeps announcing approval titles on its lock
 * screen for whoever picks it up next, until somebody signs in again and the
 * registration moves.
 *
 * POST rather than DELETE because the API kernel reads a body only for
 * POST/PATCH/PUT, and a registration token has no business in a URL where the
 * access log will keep it.
 *
 * Scoped to the caller's own row: `token` alone would pin the record, but then
 * anyone who learned a token could silence somebody else's phone.
 */
export const POST = route(
  {
    module: 'notifications',
    action: 'EDIT',
    selfService: true,
    body,
    rateLimit: { max: 20, windowSeconds: 300 },
  },
  async ({ ctx, body }) => {
    const { count } = await prisma.deviceToken.deleteMany({
      where: { token: body.token, userId: ctx.actor.id },
    });
    return { removed: count };
  },
);
