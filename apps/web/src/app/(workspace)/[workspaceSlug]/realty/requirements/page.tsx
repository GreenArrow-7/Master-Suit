/**
 * The same screen, reached through Real Estate.
 *
 * A buyer requirement is one record — `ClientRequirement` — and the matching it
 * drives already exists in `services/inventory/demand.ts`, read from both ends
 * by the requirement screen and the listing screen. Real Estate needs the same
 * register, not a second one, so this route renders the Sales page and a fix to
 * one is a fix to both.
 *
 * `realty/layout.tsx` asserts REAL_ESTATE for this URL, `useModuleBase`
 * resolves the page's module-relative links against `/{slug}/realty`, and the
 * page's own `SALES_OR_REALTY` entitlement lets a workspace that owns only Real
 * Estate through. The permission check is unchanged.
 */
export { default, metadata } from '../../sales/requirements/page';
