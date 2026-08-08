import Link from 'next/link';
export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--lf-space-6)' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div className="lf-hero-figure" style={{ color: 'var(--lf-wine-700)' }}>
          404
        </div>
        <h1 className="lf-h1" style={{ marginTop: 'var(--lf-space-3)' }}>
          We couldn&rsquo;t find that
        </h1>
        <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)', marginTop: 6 }}>
          The record may have been deleted, or it may be outside your access.
        </p>
        <Link className="lf-btn" href="/" style={{ marginTop: 'var(--lf-space-5)' }}>
          Go home
        </Link>
      </div>
    </main>
  );
}
