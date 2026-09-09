import Link from 'next/link';

/**
 * Where a signed-in account that is not a platform owner lands when it reaches
 * `/platform`.
 *
 * It is a route of its own rather than a message rendered by the platform
 * layout, and that is load-bearing. A layout cannot stop the page beneath it
 * from rendering: `/platform/page.tsx` queries every workspace on the platform,
 * and returning markup from the layout still shipped that page's output —
 * workspace names, the owner's address, platform-wide counts — inside the
 * flight payload, to the very account being refused. Invisible, and sent all
 * the same. `redirect()` answers 307 with no body at all, so nothing renders and
 * nothing is serialised. `forbidden()` does not have that property here.
 *
 * Deliberately reads nothing. It is reachable by anyone who is signed in, so it
 * must have nothing to leak.
 */
export const metadata = { title: 'Platform access' };

export default function NoPlatformAccess() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--lf-space-6)' }}>
      <div className="lf-card" style={{ maxWidth: 460, padding: 'var(--lf-space-8)', textAlign: 'center' }}>
        <div className="lf-eyebrow">Not permitted</div>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-xl)', marginTop: 6 }}>
          The platform console is not part of your account
        </h1>
        <p style={{ color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
          You are signed in, and this is not a session problem. Creating and administering workspaces belongs to the
          platform owner — not to an administrator inside a workspace, including this one. Ask your platform owner if
          you need a workspace provisioned.
        </p>
        <Link className="lf-btn" href="/" style={{ marginTop: 'var(--lf-space-5)' }}>
          Back to your workspace
        </Link>
      </div>
    </main>
  );
}
