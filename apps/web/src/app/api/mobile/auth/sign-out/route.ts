import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Unauthorized } from '@/lib/errors';
import { audit } from '@/lib/security/audit';

/**
 * Sign this phone out, and only this phone: the agent's browser at their desk
 * stays signed in, and this phone's push token is forgotten. A lost phone is
 * signed out from Profile → Security.
 */
export const POST = route(
  { module: 'identity_self', action: 'VIEW', selfService: true, mobile: true },
  async ({ ctx }) => {
    // Never undefined behind `mobile: true`; an undefined id would match every row.
    if (!ctx.deviceSessionId) throw Unauthorized();
    await prisma.platformSession.updateMany({
      where: { id: ctx.deviceSessionId, kind: 'MOBILE', revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT' },
    });
    await prisma.deviceToken.deleteMany({ where: { userId: ctx.actor.id, deviceSessionId: ctx.deviceSessionId } });
    await audit(ctx, { event: 'LOGOUT', metadata: { scope: 'this-device' } });
    return { ok: true };
  },
);
