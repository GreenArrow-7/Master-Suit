import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Rendered when a permission check refuses a workspace page.
 *
 * The point of the page is that it is not an error. Nothing failed; the viewer
 * is signed in, in the right workspace, and simply does not hold this
 * permission. So it says who can change that and gives a way to ask, rather
 * than offering "Try again" for something that will refuse identically forever.
 *
 * It renders inside the workspace layout, so the person keeps their navigation
 * and can go somewhere they *can* reach without going back to the sign-in page.
 */
export default async function Forbidden() {
  const admins = await workspaceAdmins();

  return (
    <div className="lf-empty" style={{ maxWidth: 520, margin: '10vh auto', textAlign: 'center' }}>
      <div className="lf-empty__mark" aria-hidden="true">
        ⚿
      </div>
      <h1 className="lf-h2" style={{ margin: 0 }}>
        You do not have access to this page
      </h1>
      <p style={{ margin: '8px auto 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
        Your role in this workspace does not include it. Access is set per role by a workspace administrator — nothing
        is wrong with your account.
      </p>

      {admins.length > 0 && (
        <a
          className="lf-btn"
          style={{ marginTop: 'var(--lf-space-5)' }}
          href={`mailto:${admins.join(',')}?subject=${encodeURIComponent('Access request')}&body=${encodeURIComponent(
            'Please could you grant my role access to this page. I was refused when I opened it.',
          )}`}
        >
          Request access
        </a>
      )}
    </div>
  );
}

/**
 * Who to ask. Empty on any failure — a page explaining a refusal must not itself
 * fail, and an absent button is a smaller loss than a second error screen.
 */
async function workspaceAdmins(): Promise<string[]> {
  try {
    const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());
    const memberships = await prisma.workspaceMembership.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', isPrimaryAdmin: true },
      select: { platformUser: { select: { email: true } } },
      take: 5,
    });
    return memberships.map((membership) => membership.platformUser.email).filter(Boolean);
  } catch {
    return [];
  }
}
