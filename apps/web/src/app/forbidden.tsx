import Link from 'next/link';

/**
 * Root fallback for `forbidden()` outside a workspace — the platform area.
 *
 * The workspace-scoped one at (workspace)/[workspaceSlug]/forbidden.tsx keeps
 * the shell and offers a way to ask for access. Here there is nobody above a
 * platform owner to ask, so it only says so plainly.
 */
export default function Forbidden() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--lf-space-6)' }}>
      <div className="lf-card" style={{ maxWidth: 460, padding: 'var(--lf-space-8)', textAlign: 'center' }}>
        <div className="lf-eyebrow">Not permitted</div>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-xl)', marginTop: 6 }}>
          You do not have access to this page
        </h1>
        <p style={{ color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
          Your account is signed in, but it does not hold the permission this page requires.
        </p>
        <Link className="lf-btn" href="/" style={{ marginTop: 'var(--lf-space-5)' }}>
          Go to your workspace
        </Link>
      </div>
    </main>
  );
}
