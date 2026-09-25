/**
 * The same screen, reached through Real Estate.
 *
 * The project catalogue and the listing register are the brokerage's inventory
 * and the sales team's inventory — one set of rows, not two. So this route
 * renders the Sales page rather than a copy of it, and a fix to one is a fix to
 * both.
 *
 * `realty/layout.tsx` asserts REAL_ESTATE for this URL, `useModuleBase` resolves
 * the page's module-relative links against `/{slug}/realty`, and the page's own
 * `SALES_OR_REALTY` entitlement lets a workspace that owns only Real Estate
 * through. The permission check is unchanged.
 */
export { default, metadata } from '../../../sales/projects/[id]/page';
