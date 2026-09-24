/**
 * The same screen, reached through Real Estate.
 *
 * An open house is an `Event`: a time, a place, a capacity and a list of
 * `EventInvitee` rows carrying RSVP state and `checkedInAt`. A brokerage
 * running a viewing day and a sales floor running a launch event are filling in
 * the same record, so this route renders the Sales page rather than a second
 * event register that would split one guest list in two.
 *
 * `realty/layout.tsx` asserts REAL_ESTATE for this URL, `useModuleBase`
 * resolves the page's module-relative links against `/{slug}/realty`, and the
 * page's own `SALES_OR_REALTY` entitlement lets a workspace that owns only Real
 * Estate through. The permission check is unchanged.
 */
export { default, metadata } from '../../sales/events/page';
