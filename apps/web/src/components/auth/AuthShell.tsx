import { COMPANY_NAME, PRODUCT_NAME, PRODUCT_SHORT_NAME } from '@/lib/branding';
import YouhanMark from '@/components/brand/YouhanMark';

/**
 * The shared frame for every screen outside a session: sign in, MFA enrolment,
 * password recovery, invitations.
 *
 * A quiet page: the lockup fixed top-left, the task centred in a 360px column,
 * the product name fixed bottom-left. Nothing else is painted. The story panel
 * that used to fill the left 45% showed "3 follow-ups due", "46 present",
 * "9 workspaces" — numbers nobody had counted, on the one screen where a
 * visitor has no way to know that — and ran a pipeline animation that never
 * stopped. Nothing here moves, and nothing here is a statistic.
 *
 * Below 760px the lockup flows inline above the form (CSS, not JSX) — a
 * centred form is eaten by the keyboard.
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="lf-auth">
      <div className="lf-auth-brand">
        <YouhanMark size={20} className="lf-auth-mark" />
        <span className="lf-wordmark">
          {COMPANY_NAME} <em>{PRODUCT_SHORT_NAME}</em>
        </span>
      </div>

      <section className="lf-auth-pane">
        <div className="lf-auth-card">{children}</div>
      </section>

      <p className="lf-auth-foot">{PRODUCT_NAME}</p>
    </main>
  );
}
