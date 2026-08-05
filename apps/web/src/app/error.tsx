'use client';

import { useEffect } from 'react';

/** Setup problems are the most likely cause of a 500 in development, so surface
 *  the fix rather than a bare "Something went wrong". */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  const setupIssue = /prisma client has not been generated|\.prisma[\\/]client/i.test(error.message);
  const dbIssue = /P1001|ECONNREFUSED|Can't reach database/i.test(error.message);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--lf-space-6)' }}>
      <div className="lf-card" style={{ maxWidth: 560, padding: 'var(--lf-space-8)' }}>
        <div className="lf-eyebrow" style={{ color: 'var(--lf-vermillion)' }}>Error</div>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-xl)', marginTop: 6 }}>
          {setupIssue ? 'The Prisma client has not been generated'
            : dbIssue ? 'The database is not reachable'
            : 'Something went wrong on our side'}
        </h1>

        {setupIssue && (
          <>
            <p style={{ color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
              npm 12 blocks package install scripts by default, so Prisma&rsquo;s postinstall never ran.
            </p>
            <pre style={PRE}>npm approve-scripts --allow-scripts-pending{'\n'}npx prisma generate</pre>
          </>
        )}

        {dbIssue && (
          <>
            <p style={{ color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
              Start Docker Desktop, then bring the containers up.
            </p>
            <pre style={PRE}>npm run docker:up</pre>
          </>
        )}

        {!setupIssue && !dbIssue && (
          <p style={{ color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
            Run <code>npm run preflight</code> to check your setup, or see the server console for detail.
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-5)' }}>
          <button className="lf-btn" onClick={reset}>Try again</button>
          <a className="lf-btn lf-btn--secondary" href="/">Go home</a>
        </div>

        {error.digest && (
          <div className="lf-num" style={{ marginTop: 'var(--lf-space-4)', fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
            {error.digest}
          </div>
        )}
      </div>
    </main>
  );
}

const PRE: React.CSSProperties = {
  marginTop: 'var(--lf-space-3)', padding: 'var(--lf-space-3)',
  background: 'var(--lf-wine-900)', color: '#F3E9EC',
  borderRadius: 'var(--lf-radius)', fontFamily: 'var(--lf-font-mono)',
  fontSize: 'var(--lf-text-xs)', overflowX: 'auto',
};
