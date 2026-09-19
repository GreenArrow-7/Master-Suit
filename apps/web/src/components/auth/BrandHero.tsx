import { COMPANY_NAME, PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/branding';
import YouhanMark from '@/components/brand/YouhanMark';
import BrandBackground from '@/components/brand/BrandBackground';
import BusinessEcosystem from '@/components/brand/ecosystem/BusinessEcosystem';

/**
 * The brand side of every screen outside a session.
 *
 * Three levels and no more: the lockup, the one sentence the product is
 * (headline plus its description), and the ecosystem graphic that shows what
 * "working as one" means — a lead moving through sales, tasks, the team, a
 * workflow, the AI and the dashboard. The trust line and the parent company
 * sit at the foot, quietly. No statistics: nobody has counted anything on a
 * screen a visitor has not signed in to.
 *
 * Decorative to assistive technology — the form is the task — except for one
 * visually hidden sentence that says what the graphic shows.
 */
export default function BrandHero({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  if (variant === 'compact') {
    return (
      <div className="lf-auth-compact">
        <BrandBackground />
        <div className="lf-auth-brand">
          <YouhanMark size={30} className="lf-auth-mark" />
          <span className="lf-wordmark">{PRODUCT_NAME}</span>
        </div>
        <h2 className="lf-auth-headline lf-auth-headline--compact">
          Your business. <em>Working as one.</em>
        </h2>
        <BusinessEcosystem variant="compact" className="lf-auth-eco" />
      </div>
    );
  }

  return (
    <>
      <BrandBackground />
      <div className="lf-auth-brand">
        <YouhanMark size={34} className="lf-auth-mark" />
        <span className="lf-wordmark">{PRODUCT_NAME}</span>
      </div>

      <div className="lf-auth-message">
        <h2 className="lf-auth-headline">
          Your business.
          <br />
          <em>Working as one.</em>
        </h2>
        <p className="lf-auth-sub">{PRODUCT_DESCRIPTION}</p>
      </div>

      <BusinessEcosystem className="lf-auth-eco" />

      <div className="lf-auth-foot">
        <p className="lf-auth-trust">
          <span>Private by design</span>
          <span>Role-based access</span>
          <span>Every action audited</span>
        </p>
        <p className="lf-auth-parent">Built by {COMPANY_NAME}</p>
      </div>
    </>
  );
}
