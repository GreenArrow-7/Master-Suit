import { COMPANY_NAME, PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/branding';
import YouhanMark from '@/components/brand/YouhanMark';

/**
 * The shared frame for every screen outside a session: sign in, MFA enrolment,
 * password recovery, invitations.
 *
 * Left, 45%: YOUHAN midnight. The mark, the product name, one headline, and
 * the four things the product does — named, not measured. This panel used to
 * show "3 follow-ups due", "46 present", "9 workspaces": numbers nobody had
 * counted, on the one screen where a visitor has no way to know that. It also
 * ran a pipeline animation that never stopped. Both are gone; nothing here
 * moves, and nothing here is a statistic.
 *
 * Right, 55%: the task at hand, on the workspace's own light surface. Below
 * 820px the story steps aside and the lockup sits above the form — someone on
 * a phone is here to sign in.
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="lf-auth">
      <section className="lf-auth-story" aria-hidden="true">
        <div className="lf-auth-brand">
          <YouhanMark size={34} className="lf-auth-mark" />
          <span className="lf-wordmark">{PRODUCT_NAME}</span>
        </div>

        <div>
          <h2 className="lf-auth-headline">
            Your business.
            <br />
            <em>Working as one.</em>
          </h2>
          <p className="lf-auth-sub">{PRODUCT_DESCRIPTION}</p>

          {/* What the product is made of. Each line is a module that exists and
              a sentence about what it does — no figures. */}
          <ul className="lf-auth-modules">
            <li>
              <strong>Sales CRM</strong>
              <span>Leads, opportunities, follow-ups, calls and commissions in one pipeline.</span>
            </li>
            <li>
              <strong>People &amp; HR</strong>
              <span>Attendance, leave, payroll and the employee record, on the same login.</span>
            </li>
            <li>
              <strong>Operations</strong>
              <span>Tasks, workflows and approvals that move with the business.</span>
            </li>
            <li data-ai="">
              <strong>AI Intelligence</strong>
              <span>Call analysis, coaching and a copilot that answers from your own data.</span>
            </li>
          </ul>
        </div>

        <div>
          <div className="lf-auth-trust">
            <span>Private by design</span>
            <span>Role-based access</span>
            <span>Every action audited</span>
          </div>
          {/* The parent company, said once, quietly, on the one screen where a
              visitor may not yet know who built this. */}
          <p className="lf-auth-parent">Built by {COMPANY_NAME}</p>
        </div>
      </section>

      <section className="lf-auth-pane">
        <div className="lf-auth-card">
          <div className="lf-auth-brand">
            <YouhanMark size={34} className="lf-auth-mark" />
            <span className="lf-wordmark">{PRODUCT_NAME}</span>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
