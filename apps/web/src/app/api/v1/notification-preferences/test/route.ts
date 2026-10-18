import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { pushConfigured, sendPush } from '@/lib/push/send';

/**
 * "Send a test notification" on Profile -> Notifications (M17-02, M20-08).
 *
 * Push needs keys only the owner can create (Firebase, APNs). Once they are on
 * the server, this is how anyone confirms the whole chain — server keys, the
 * app's registration, the phone's permission — with one tap, instead of waiting
 * for a real follow-up to fall due. It reports each link that is missing rather
 * than failing silently.
 *
 * Your own devices only (`selfService`), and rate limited: it rings a phone.
 */
export const POST = route(
  {
    module: 'notifications',
    action: 'VIEW',
    selfService: true,
    rateLimit: { max: 5, windowSeconds: 600 },
  },
  async ({ ctx }) => {
    const [devices, tenant] = await Promise.all([
      prisma.deviceToken.findMany({ where: { userId: ctx.actor.id }, select: { token: true, platform: true } }),
      prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { slug: true } }),
    ]);
    if (!pushConfigured()) return { configured: false, devices: devices.length, sent: 0 };
    if (devices.length === 0) return { configured: true, devices: 0, sent: 0 };

    const { sent, stale } = await sendPush(devices, {
      title: 'YOUHAN ONE test notification',
      body: 'Phone notifications are working on this device.',
      url: `/${tenant?.slug ?? ''}/profile/notifications`,
    });
    // Same pruning as the delivery worker: a rejected token belongs to a deleted app.
    if (stale.length) await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } });
    return { configured: true, devices: devices.length - stale.length, sent };
  },
);
