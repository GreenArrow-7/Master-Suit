/**
 * The holiday register, reached from Administration (M18-08): automatic
 * assignment skips a confirmed holiday, and `people/layout.tsx` asserts HRMS, so
 * a workspace without People enters its holidays here. The page's own
 * entitlement admits any module; its permission check is unchanged.
 */
export { default, metadata } from '../../people/holidays/page';
