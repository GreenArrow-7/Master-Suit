/**
 * The same screen, reached through Real Estate.
 *
 * A proposal is a shortlist of `Listing` rows sent to a client from a buyer
 * requirement — one register, read by both products. `realty/layout.tsx`
 * asserts REAL_ESTATE for this URL, and the page's own `SALES_OR_REALTY`
 * entitlement lets a workspace that owns only Real Estate through. The
 * permission check is unchanged.
 */
export { default, metadata } from '../../sales/proposals/page';
