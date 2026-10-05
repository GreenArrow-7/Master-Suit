/**
 * The attendance record, reached from Home.
 *
 * Check-in works in every workspace, but `people/layout.tsx` asserts HRMS, so a
 * workspace with Sales or Real Estate alone had nowhere to see its days. This
 * route renders the People page outside that layout; the page's own entitlement
 * admits any module, and its scope (self, reporting line or everyone) is
 * unchanged.
 */
export { default, metadata } from '../people/attendance/page';
