import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/branding';
import { MODULES } from '@/components/brand/ecosystem/modules';
import { platformValue } from '@/lib/value/platformValue';
import BrandHero, { LEAD_EAGLE } from './BrandHero';

/**
 * The shared frame for every screen outside a session: sign in, MFA enrolment,
 * password recovery, invitations.
 *
 * Left, 48%: the brand — mark, headline, and the ecosystem graphic that shows
 * the product's parts working as one (BrandHero). Right, 52%: the task at hand,
 * on a card over the workspace's own canvas. The split is measured by
 * tests/e2e/mobile.spec.ts: the form column stays the wider one above 820px.
 *
 * Below 820px the desktop story steps aside and a compact brand band — the
 * lockup, the one line, four modules — sits above the card, so a phone still
 * opens on the brand without pushing the form out of reach.
 *
 * The graphic is decorative to assistive technology; one visually hidden
 * sentence says in words what it draws.
 *
 * `product="lead-eagle"` brands the frame as Lead Eagle (PROD-13); the task
 * card and everything it posts to are the same.
 */
export default async function AuthShell({ children, product }: { children: React.ReactNode; product?: 'lead-eagle' }) {
  // Measured, not claimed: counts of work the platform did (lib/value/platformValue.ts).
  const value = await platformValue();
  return (
    <main className="lf-auth">
      <p className="lf-visually-hidden">
        {product === 'lead-eagle'
          ? `${LEAD_EAGLE.label} by ${PRODUCT_NAME}: ${LEAD_EAGLE.description}`
          : `${PRODUCT_NAME}: ${PRODUCT_DESCRIPTION} Modules: ${MODULES.map((m) => m.label).join(', ')}.`}
      </p>
      <section className="lf-auth-story" aria-hidden="true">
        <BrandHero value={value} product={product} />
      </section>

      <section className="lf-auth-pane">
        <div className="lf-auth-column">
          <div className="lf-auth-compactWrap" aria-hidden="true">
            <BrandHero variant="compact" product={product} />
          </div>
          <div className="lf-auth-card">{children}</div>
        </div>
      </section>
    </main>
  );
}
