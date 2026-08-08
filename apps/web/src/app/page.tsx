import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { prisma } from '@/lib/db';
import { resolvePlatformCtx } from '@/lib/auth/session';

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
    } else if (ctx.platformRole !== 'USER') {
      destination = '/platform';
    }
  } catch {
    // No session, or one that no longer resolves: the login page is correct.
  }

  redirect(destination);
}
