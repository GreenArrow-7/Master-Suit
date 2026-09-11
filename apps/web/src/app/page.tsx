import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { prisma } from '@/lib/db';
import { resolvePlatformCtx } from '@/lib/auth/session';
import { isPlatformOwner } from '@/lib/auth/platform-policy';
import { isSupportRole } from '@/lib/auth/support-actor';

export const dynamic = 'force-dynamic';

/**
 * The front door. It sends each caller to the surface they actually own —
 * platform staff to the control plane, a company user to their workspace —
 * rather than to the legacy Sales-only shell at /home.
 */
export default async function Root() {
  let destination = '/login';

  try {
    const ctx = await resolvePlatformCtx(new Request('http://internal/', { headers: await headers() }), ulid());
    if (ctx.activeTenantId) {
      const workspace = await prisma.tenant.findUnique({
        where: { id: ctx.activeTenantId },
        select: { slug: true },
      });
      if (workspace) destination = `/${workspace.slug}/dashboard`;
    } else if (isPlatformOwner(ctx.platformRole)) {
      destination = '/platform';
    } else if (isSupportRole(ctx.platformRole)) {
      /**
       * SUPPORT and SECURITY_AUDITOR land on the workspace list they are
       * authorised for, not on the control plane.
       *
       * `platformRole !== 'USER'` used to send all three here, which was the
       * right instinct pointed at the wrong door: `/platform` is gated on
       * OWNER, so a support identity signing in was redirected straight into a
       * refusal. It read as "my account is broken" and was one of the reasons
       * the SUPPORT role, though fully modelled and tested, had never been used.
       *
       * AI_SERVICE is deliberately not here. It reaches a workspace through
       * api/v1/auth/service-login, which names the workspace itself, and it has
       * no console to land on.
       */
      destination = '/monitoring';
    }
  } catch {
    // No session, or one that no longer resolves: the login page is correct.
  }

  redirect(destination);
}
