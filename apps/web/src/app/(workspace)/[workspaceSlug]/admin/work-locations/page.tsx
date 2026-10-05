/**
 * The same screen, reached from Administration.
 *
 * Check-in works in every workspace, but `people/layout.tsx` asserts HRMS, so a
 * workspace with Sales or Real Estate alone had no way to place the locations
 * check-in is measured against. This route renders the People page outside
 * that layout; the page's own entitlement admits any module, and its
 * permission check is unchanged.
 */
export { default } from '../../people/work-locations/page';
