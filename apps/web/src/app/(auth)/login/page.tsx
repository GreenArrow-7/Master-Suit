import LoginForm from './LoginForm';
import { PRODUCT_NAME } from '@/lib/branding';

export const metadata = { title: 'Sign in' };

/**
 * Split screen. The left panel is the only full-bleed burgundy surface in the
 * product other than the rail — it establishes the brand once, at the door, so
 * every screen afterwards can stay neutral and let data do the talking.
 */
export default function LoginPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <section
        style={{
          background: 'linear-gradient(155deg, var(--lf-wine-900) 0%, var(--lf-wine-700) 62%, #8E2B47 100%)',
          color: '#F3E9EC',
          padding: 'var(--lf-space-10)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 'auto -18% -32% auto',
            width: 520,
            height: 520,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgb(255 255 255 / 0.09), transparent 62%)',
          }}
        />
        <div className="lf-wordmark" style={{ color: '#fff', fontSize: '1.75rem' }}>
          {PRODUCT_NAME}
        </div>

        <div style={{ position: 'relative', maxWidth: 420 }}>
          <p
            style={{
              fontFamily: 'var(--lf-font-display)',
              fontSize: '2.1rem',
              lineHeight: 1.22,
              letterSpacing: 'var(--lf-track-tight)',
              margin: 0,
              color: '#fff',
            }}
          >
            Your people and your pipeline, run from one place.
          </p>
          <p
            style={{ marginTop: 'var(--lf-space-4)', color: 'rgb(243 233 236 / 0.72)', fontSize: 'var(--lf-text-sm)' }}
          >
            HR and Sales as modules of a single workspace — one directory, one set of permissions.
          </p>
        </div>

        <div
          style={{
            position: 'relative',
            display: 'flex',
            gap: 'var(--lf-space-6)',
            fontSize: 'var(--lf-text-xs)',
            color: 'rgb(243 233 236 / 0.55)',
          }}
        >
          <span>Multi-tenant</span>
          <span>Role-based access</span>
          <span>Audited</span>
        </div>
      </section>

      <section
        style={{ display: 'grid', placeItems: 'center', padding: 'var(--lf-space-8)', background: 'var(--lf-canvas)' }}
      >
        <div style={{ width: '100%', maxWidth: 372 }}>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
            Sign in
          </h1>
          <p style={{ margin: '4px 0 var(--lf-space-6)', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
            Use your workspace credentials.
          </p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
