/**
 * The same screen, reached through Real Estate.
 *
 * Leads, follow-ups, calls and site visits are the brokerage's client register
 * and the sales team's client register — one set of rows, not two. The brief was
 * explicit that Real Estate must not grow a parallel `RealEstateLead`, so there
 * is no second implementation here to drift from the first: this route renders
 * the Sales page, and a fix to it is a fix to both products.
 *
 * What differs is the surrounding chrome and the gate. `realty/layout.tsx`
 * asserts REAL_ESTATE for this URL, `useModuleBase` resolves the page's
 * module-relative links against `/{slug}/realty`, and the page's own
 * `SALES_OR_REALTY` entitlement lets a workspace that owns only Real Estate
 * through. The permission check is unchanged.
 */
export { default, metadata } from '../../sales/site-visits/page';
