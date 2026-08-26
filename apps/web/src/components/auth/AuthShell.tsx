import { PRODUCT_NAME } from '@/lib/branding';

/**
 * The shared frame for every screen outside a session: sign in, MFA enrolment,
 * password recovery, invitations. Left is the product speaking for itself —
 * miniature, truthful fragments of the real interface over the brand wine.
 * Right is the task at hand. Below 820px the story steps aside entirely;
 * someone on a phone is here to sign in.
 *
 * The three cards are one per module, deliberately.
 *
 * This pane used to show three fragments of the CRM and a lead pipeline, which
 * told every visitor the product was a lead-generation tool. It is not: Sales is
 * one module beside People and the platform control plane, and a customer
 * buying HR would have arrived at a door advertising something else. Each card
 * now shows a real fragment of a different module, and the pulse below traces a
 * journey that crosses them — a won deal becoming a client, a team, a payroll —
 * because that crossing is the reason to buy the suite rather than the parts.
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="lf-auth">
      <section className="lf-auth-story" aria-hidden="true">
        <div className="lf-auth-brand">
          <span className="lf-auth-mark">MS</span>
          <span className="lf-wordmark">{PRODUCT_NAME}</span>
        </div>

        <div>
          <h2 className="lf-auth-headline">
            One login.
            <br />
            <em>The whole business.</em>
          </h2>
          <p className="lf-auth-sub">
            {PRODUCT_NAME}
            {
              ' is a modular platform — Sales CRM, People & HR, and the platform control plane — sharing one directory, one permission model and one audit trail.'
            }
          </p>

          <div className="lf-auth-collage">
            <article className="lf-auth-minicard lf-auth-minicard--brief" data-i="1">
              <div className="lf-eyebrow">Sales CRM</div>
              <div className="lf-auth-mini-row">
                <span className="lf-auth-dot" style={{ background: 'var(--lf-brass, #ca8a04)' }} />3 follow-ups due
              </div>
              <div className="lf-auth-mini-row">
                <span className="lf-auth-dot" style={{ background: 'var(--lf-viridian, #16a34a)' }} />2 high-intent
                leads
              </div>
              <div className="lf-auth-mini-row">
                <span className="lf-auth-dot" style={{ background: 'var(--lf-vermillion, #b3261e)' }} />1 opportunity at
                risk
              </div>
              <div className="lf-auth-mini-foot">Leads, calls, pipeline &amp; commissions &rarr;</div>
            </article>

            <article className="lf-auth-minicard" data-i="2">
              <div className="lf-eyebrow">People &amp; HR</div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Attendance &middot; today</div>
              <div style={{ color: 'var(--lf-ink-3)', marginBottom: 8 }}>Face check-in, geofenced</div>
              <div className="lf-auth-mini-row" style={{ gap: 10 }}>
                <span className="lf-badge" data-tone="viridian">
                  46 present
                </span>
                <span className="lf-auth-score">
                  <span style={{ width: '94%' }} />
                </span>
                <span className="lf-num" style={{ fontSize: 11 }}>
                  94%
                </span>
              </div>
            </article>

            <article className="lf-auth-minicard" data-i="3">
              <div className="lf-eyebrow">
                Platform &middot; <span className="lf-num">9 workspaces</span>
              </div>
              <div style={{ color: 'var(--lf-ink-2)', lineHeight: 1.45 }}>
                Tenants, plans, entitlements and account recovery in one console.
              </div>
              <div className="lf-auth-mini-foot">Every action audited</div>
            </article>
          </div>
        </div>

        <div>
          <div className="lf-auth-pulse">
            <ol>
              <li style={{ ['--step' as never]: 0 }}>Lead</li>
              <li style={{ ['--step' as never]: 1 }}>Deal won</li>
              <li style={{ ['--step' as never]: 2 }}>Client onboarded</li>
              <li style={{ ['--step' as never]: 3 }}>Team assigned</li>
              <li style={{ ['--step' as never]: 4 }} data-due="">
                Commission paid
              </li>
            </ol>
          </div>
          <div className="lf-auth-trust" style={{ marginTop: 'var(--lf-space-6)' }}>
            <span>Private by design</span>
            <span>Role-based access</span>
            <span>Every action audited</span>
          </div>
        </div>
      </section>

      <section className="lf-auth-pane">
        <div className="lf-auth-card">
          <div className="lf-auth-brand">
            <span className="lf-auth-mark">MS</span>
            <span className="lf-wordmark">{PRODUCT_NAME}</span>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
