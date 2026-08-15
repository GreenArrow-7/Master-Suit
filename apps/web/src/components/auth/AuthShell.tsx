import { PRODUCT_NAME } from '@/lib/branding';

/**
 * The shared frame for every screen outside a session: sign in, MFA enrolment,
 * password recovery, invitations. Left is the product speaking for itself —
 * miniature, truthful fragments of the real interface over the brand wine,
 * closed by the pipeline pulse. Right is the task at hand. Below 820px the
 * story steps aside entirely; someone on a phone is here to sign in.
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
            Know what needs attention.
            <br />
            <em>Before it&rsquo;s urgent.</em>
          </h2>
          <p className="lf-auth-sub">
            Leads, conversations and follow-ups in one workspace — from first call to close.
          </p>

          <div className="lf-auth-collage">
            <article className="lf-auth-minicard lf-auth-minicard--brief" data-i="1">
              <div className="lf-eyebrow">Today&rsquo;s brief</div>
              <div className="lf-auth-mini-row">
                <span className="lf-auth-dot" style={{ background: 'var(--lf-brass, #ca8a04)' }} />
                3 follow-ups due
              </div>
              <div className="lf-auth-mini-row">
                <span className="lf-auth-dot" style={{ background: 'var(--lf-viridian, #16a34a)' }} />
                2 high-intent leads
              </div>
              <div className="lf-auth-mini-row">
                <span className="lf-auth-dot" style={{ background: 'var(--lf-vermillion, #b3261e)' }} />
                1 opportunity at risk
              </div>
              <div className="lf-auth-mini-foot">Prepare me for my next call &rarr;</div>
            </article>

            <article className="lf-auth-minicard" data-i="2">
              <div className="lf-eyebrow">Lead &middot; LD-000035</div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Priya Karim</div>
              <div style={{ color: 'var(--lf-ink-3)', marginBottom: 8 }}>Northbay Logistics</div>
              <div className="lf-auth-mini-row" style={{ gap: 10 }}>
                <span className="lf-badge" data-tone="wine">
                  Qualified
                </span>
                <span className="lf-auth-score">
                  <span style={{ width: '82%' }} />
                </span>
                <span className="lf-num" style={{ fontSize: 11 }}>
                  82
                </span>
              </div>
            </article>

            <article className="lf-auth-minicard" data-i="3">
              <div className="lf-eyebrow">
                Call &middot; <span className="lf-num">12m 40s</span>
              </div>
              <div style={{ color: 'var(--lf-ink-2)', lineHeight: 1.45 }}>
                Pricing discussed — asked for revised payment terms.
              </div>
              <div className="lf-auth-mini-foot">Follow up today</div>
            </article>
          </div>
        </div>

        <div>
          <div className="lf-auth-pulse">
            <ol>
              <li style={{ ['--step' as never]: 0 }}>Enquiry</li>
              <li style={{ ['--step' as never]: 1 }}>Lead created</li>
              <li style={{ ['--step' as never]: 2 }}>Call connected</li>
              <li style={{ ['--step' as never]: 3 }}>Proposal sent</li>
              <li style={{ ['--step' as never]: 4 }} data-due="">
                Follow-up due
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
