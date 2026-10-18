import { COMPANY_NAME, PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/branding';
import { PRODUCT_MODULE_CHOICES } from '@/lib/modules/catalogue';
import YouhanMark from '@/components/brand/YouhanMark';
import BrandBackground from '@/components/brand/BrandBackground';
import BusinessEcosystem from '@/components/brand/ecosystem/BusinessEcosystem';
import type { ValueSummary } from '@/lib/value/platformValue';

/**
 * The brand side of every screen outside a session.
 *
 * Three levels and no more: the lockup, the one sentence the product is
 * (headline plus its description), and the ecosystem graphic that shows what
 * "working as one" means — a lead moving through sales, tasks, the team, a
 * workflow, the AI and the dashboard. The trust line and the parent company
 * sit at the foot, quietly, under the one kind of figure allowed here: counts
 * of work the platform actually did (lib/value/platformValue.ts), absent until
 * there is work to count. Never a number nobody counted.
 *
 * Decorative to assistive technology — the form is the task — except for one
 * visually hidden sentence that says what the graphic shows.
 *
 * `product="lead-eagle"` is Lead Eagle's door (PROD-13): its name beside the
 * mark, its own line and the catalogue's description of it, and no ecosystem
 * graphic — that one draws the whole platform, not the one application.
 */
export const LEAD_EAGLE = PRODUCT_MODULE_CHOICES.find((choice) => choice.value === 'LEAD_EAGLE')!;

export default function BrandHero({
  variant = 'full',
  value = null,
  product,
}: {
  variant?: 'full' | 'compact';
  value?: ValueSummary | null;
  product?: 'lead-eagle';
}) {
  const leadEagle = product === 'lead-eagle';
  const name = leadEagle ? LEAD_EAGLE.label : PRODUCT_NAME;
  const [first, second] = leadEagle ? ['Every lead.', 'Followed up.'] : ['Your business.', 'Working as one.'];

  if (variant === 'compact') {
    return (
      <div className="lf-auth-compact">
        <BrandBackground />
        <div className="lf-auth-brand">
          <YouhanMark size={30} className="lf-auth-mark" />
          <span className="lf-wordmark">{name}</span>
        </div>
        <h2 className="lf-auth-headline lf-auth-headline--compact">
          {first} <em>{second}</em>
        </h2>
        {!leadEagle && <BusinessEcosystem variant="compact" className="lf-auth-eco" />}
      </div>
    );
  }

  return (
    <>
      <BrandBackground />
      <div className="lf-auth-brand">
        <YouhanMark size={34} className="lf-auth-mark" />
        <span className="lf-wordmark">{name}</span>
      </div>

      <div className="lf-auth-message" data-product={product}>
        <h2 className="lf-auth-headline">
          {first}
          <br />
          <em>{second}</em>
        </h2>
        <p className="lf-auth-sub">{leadEagle ? LEAD_EAGLE.description : PRODUCT_DESCRIPTION}</p>
      </div>

      {!leadEagle && <BusinessEcosystem className="lf-auth-eco" />}

      <div className="lf-auth-foot">
        {value && (
          <dl className="lf-auth-value" aria-label="What the platform has automated">
            <div>
              <dt>Hours of manual work saved</dt>
              <dd>{value.hoursSaved.toLocaleString('en')}+</dd>
            </div>
            <div>
              <dt>Actions automated</dt>
              <dd>{value.actions.toLocaleString('en')}</dd>
            </div>
            {value.counts.callsAnalysed > 0 && (
              <div>
                <dt>Calls analysed by AI</dt>
                <dd>{value.counts.callsAnalysed.toLocaleString('en')}</dd>
              </div>
            )}
          </dl>
        )}
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
