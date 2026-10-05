/**
 * The same screen, reached through Lead Eagle: one set of rows, rendered by the
 * Sales page (realty/leads/page.tsx records why there is no second copy).
 * `lead-eagle/layout.tsx` gates the URL; the page's `LEAD_MODULES` entitlement
 * admits a workspace that owns only Lead Eagle.
 */
export { default, metadata } from '../../sales/projects/page';
