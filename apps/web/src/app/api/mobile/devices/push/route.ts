import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, Invalid, Unauthorized } from '@/lib/errors';
import { LEAD_EAGLE_BUNDLE_ID } from '@/lib/push/send';
import type { Ctx } from '@/lib/security/rbac';

const body = z
  .object({
    /**
     * The phone's native token: FCM's registration token on Android, the APNs
     * device token on iOS. Null forgets this phone's token (the app's sign-out).
     */
    pushToken: z.string().trim().min(16).max(4096).nullable(),
    platform: z.enum(['ios', 'android']).optional(),
    /**
     * The app's bundle id: Lead Eagle's (`ae.leadeagle.app`) or YOUHAN ONE's
     * (APNS_BUNDLE_ID), nothing else. APNs addresses an iOS push to it, and the
     * team's key would sign a push for any app the team owns.
     */
    bundleId: z
      .string()
      .trim()
      .refine((id) => id === LEAD_EAGLE_BUNDLE_ID || id === env.APNS_BUNDLE_ID, 'Unknown app.')
      .optional(),
  })
  .strict();

const EXPO_TOKEN = /^Expo(nent)?PushToken\[/;

// Registered on every launch, as /api/v1/devices: twenty in five minutes is a crash loop.
const spec = {
  module: 'notifications',
  action: 'EDIT',
  selfService: true,
  mobile: true,
  rateLimit: { max: 20, windowSeconds: 300 },
} as const;

/** This phone's tokens: the caller's own, registered by this device session. */
function forgetThisPhone(ctx: Ctx) {
  // Never undefined behind `mobile: true`; an undefined id would match every row of the person's.
  if (!ctx.deviceSessionId) throw Unauthorized();
  return prisma.deviceToken.deleteMany({ where: { userId: ctx.actor.id, deviceSessionId: ctx.deviceSessionId } });
}

/**
 * Where to push this phone's notifications: YOUHAN ONE's `DeviceToken`, which
 * the notification worker sends to directly through FCM and APNs (no Expo
 * relay), for the signed-in person, tied to this device session so signing the
 * phone out (here, the app's sign-out, or Profile → Security) forgets it.
 */
export const POST = route({ ...spec, body }, async ({ ctx, body }) => {
  if (body.pushToken === null) return { ok: true, removed: (await forgetThisPhone(ctx)).count };
  if (EXPO_TOKEN.test(body.pushToken)) {
    throw new AppError(
      422,
      'native-push-token-required',
      "This is an Expo push token. YOUHAN ONE sends through Apple and Google directly: register the phone's native token (FCM on Android, APNs on iOS).",
    );
  }
  if (!body.platform) {
    throw Invalid([
      { field: 'platform', code: 'required', message: 'Say which platform the token is for: ios or android.' },
    ]);
  }
  const fields = {
    userId: ctx.actor.id,
    platform: body.platform,
    // Null is APNS_BUNDLE_ID's app, so only Lead Eagle's id is kept.
    bundleId: body.bundleId === LEAD_EAGLE_BUNDLE_ID ? LEAD_EAGLE_BUNDLE_ID : null,
    deviceSessionId: ctx.deviceSessionId ?? null,
  };
  // On the token, as /api/v1/devices: a handset belongs to whoever is signed in on it now.
  await prisma.deviceToken.upsert({
    where: { token: body.pushToken },
    create: { token: body.pushToken, ...fields },
    update: { ...fields, lastSeenAt: new Date() },
  });
  return { ok: true, registered: true };
});

/** Stop pushing to this phone. */
export const DELETE = route(spec, async ({ ctx }) => ({ ok: true, removed: (await forgetThisPhone(ctx)).count }));
