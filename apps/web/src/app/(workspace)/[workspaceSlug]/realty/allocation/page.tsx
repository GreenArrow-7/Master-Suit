/**
 * The same screen, reached through Real Estate.
 *
 * This is the data pool: `poolDepth` counts leads with no owner in an OPEN
 * stage, and the screen puts them next to who is waiting for work and how much
 * each of them can actually take. A brokerage distributes enquiries the same
 * way a sales floor does, over the same `Lead` rows and the same
 * `LeadAssignmentHistory`, so this route renders the Sales page rather than a
 * second allocator that could hand the same lead to two people.
 *
 * `realty/layout.tsx` asserts REAL_ESTATE for this URL, `useModuleBase`
 * resolves the page's module-relative links against `/{slug}/realty`, and the
 * page's own `SALES_OR_REALTY` entitlement lets a workspace that owns only Real
 * Estate through. The permission check is unchanged.
 */
export { default, metadata } from '../../sales/allocation/page';
