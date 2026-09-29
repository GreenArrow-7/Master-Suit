/**
 * The same screen, reached through Real Estate.
 *
 * Portal syndication publishes `Listing` rows — the listings Real Estate already
 * works — so it is one screen, not two. `realty/layout.tsx` asserts REAL_ESTATE
 * for this URL, and the page's own `SALES_OR_REALTY` entitlement lets a
 * workspace that owns only Real Estate through. The permission check is
 * unchanged.
 */
export { default, metadata } from '../../sales/portals/page';
