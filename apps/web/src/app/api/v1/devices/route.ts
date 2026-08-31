import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const body = z
  .object({
    /**
     * The APNs or FCM registration token, straight from the plugin. Length is
     * bounded rather than pinned: Apple's is 64 hex characters today, Google's
     * is around 163 and has changed shape before now.
     */
    token: z.string().min(16).max(4096),
    platform: z.enum(['ios', 'android']),
  })
  .strict();

/**
 * Claim this handset for the signed-in account.
 *
 * `upsert` on the token rather than `create`, because the app registers on every
 * launch — and because the same device returns the same token to whoever signs
 * in on it next. Moving the row is the point: a phone can only ever be owned by
 * the account currently on it, which is what stops the previous occupant's
 * notification titles appearing on the new one's lock screen. See the model
 * comment in prisma/schema.prisma.
 *
 * `selfService`: registering your own phone is not a privilege, and gating it on
 * a permission would mean the employees who most need attendance reminders —
 * HR-created accounts with a narrow role — are the ones who cannot be reached.
 */
export const POST = route(
  {
    module: 'notifications',
    action: 'EDIT',
    selfService: true,
    body,
    // An app launch, not a user action. Twenty in five minutes is a crash loop,
    // not a person.
    rateLimit: { max: 20, windowSeconds: 300 },
  },
  async ({ ctx, body }) => {
    /**
     * The actor must be a real row in this workspace's `User` table, because
     * that is what the foreign key points at. Platform staff inside a workspace
     * under support mode are not: their actor is synthesised, and letting one
     * through would fail on the constraint with a 500 that reads like a bug in
     * the phone.
     *
     * They also should not be registering devices — support access is
     * deliberately temporary, and a push registration outlives it.
     */
    const user = await prisma.user.findFirst({
      where: { tenantId: ctx.tenantId, id: ctx.actor.id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!user) return { registered: false };

    await prisma.deviceToken.upsert({
      where: { token: body.token },
      create: { token: body.token, platform: body.platform, userId: user.id },
      update: { platform: body.platform, userId: user.id, lastSeenAt: new Date() },
    });

    return { registered: true };
  },
);
