/**
 * The same screen, reached through Real Estate.
 *
 * A booking is a `Booking`, its instalments are `Booking` payments and an
 * agent's cut is a commission on that same booking. A brokerage closing a sale
 * and a sales floor closing one are writing the same rows, so this route
 * renders the Sales page rather than a parallel ledger — two ledgers over one
 * set of money is the failure mode worth the most care to avoid.
 *
 * `realty/layout.tsx` asserts REAL_ESTATE for this URL, `useModuleBase`
 * resolves the page's module-relative links against `/{slug}/realty`, and the
 * page's own `SALES_OR_REALTY` entitlement lets a workspace that owns only Real
 * Estate through. The permission check is unchanged.
 */
export { default, metadata } from '../../sales/commissions/page';
