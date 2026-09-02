/**
 * Which product the viewer is currently in.
 *
 * ── The bug this replaces ───────────────────────────────────────────────────
 *
 * Three surfaces answered this question and two of them answered it with
 * entitlement instead of location:
 *
 *     module={shell.modules.includes('SALES') ? 'sales' : 'people'}
 *
 * For a company that owns both products — the case the whole platform is built
 * for — that is unconditionally `'sales'`. An HR manager standing on
 * `/abc/people/leave` got the Sales tab bar: Leads, Calls, Tasks, and no way
 * back to Leave except the drawer. It was not a styling problem; the phone
 * navigation was for the wrong product on every HR screen.
 *
 * Owning a product says the tabs are *available*. Only the URL says which one
 * the person is actually looking at.
 */
export type ActiveProduct = 'people' | 'sales';

/** Cookie holding the last product the viewer used, for shared routes. */
export const ACTIVE_PRODUCT_COOKIE = 'ms_active_product';

/**
 * The product a path belongs to, or null when it belongs to neither.
 *
 * The module is the third segment — `/{slug}/people/...` — and is matched as a
 * segment rather than a substring. `pathname.includes('/people')` also matched
 * `/{slug}/sales/people`, a Sales screen, and matched every screen of any
 * workspace whose slug contained the word.
 */
export function productFromPathname(pathname: string): ActiveProduct | null {
  const segment = pathname.split('/')[2];
  if (segment === 'people') return 'people';
  if (segment === 'sales') return 'sales';
  return null;
}

/** `people` needs HRMS, `sales` needs SALES. */
export function moduleForProduct(product: ActiveProduct): 'HRMS' | 'SALES' {
  return product === 'people' ? 'HRMS' : 'SALES';
}

/**
 * The product to render navigation for.
 *
 * Location first, and it is authoritative: a person standing inside a product
 * sees that product's navigation, full stop. Entitlement is not consulted there
 * — the route guard has already refused anyone who may not be on the page, so
 * second-guessing it here could only ever produce navigation that disagrees with
 * the screen it is attached to.
 *
 * Only *shared* routes (`/dashboard`, `/tasks`, `/notifications`, `/admin/**`,
 * `/profile/**`) have a genuine choice, and there the order is: what the viewer
 * last used, then whichever single product they have, then People. Falling back
 * to People rather than Sales is deliberate — an HRMS-only workspace must never
 * be shown a Sales rail, whereas the reverse is caught by the `available` check.
 */
export function resolveActiveProduct(
  pathname: string,
  available: readonly string[],
  lastUsed?: string | null,
): ActiveProduct {
  const fromPath = productFromPathname(pathname);
  if (fromPath) return fromPath;

  const canPeople = available.includes('HRMS');
  const canSales = available.includes('SALES');

  // A remembered product only counts while the company still owns it: a
  // cancelled Sales subscription must not keep sending people to a Sales rail.
  if (lastUsed === 'people' && canPeople) return 'people';
  if (lastUsed === 'sales' && canSales) return 'sales';

  if (canPeople && !canSales) return 'people';
  if (canSales && !canPeople) return 'sales';

  /**
   * Both products, and nothing remembered: Sales.
   *
   * This is the behaviour that was already there, and it is deliberately left
   * alone. The bug being fixed is that entitlement decided the product on
   * *module* routes, where the URL already says the answer; on a genuinely
   * neutral route with no stored preference there is no better signal than the
   * default the product already had, and changing it was an unrequested
   * behaviour change — it moved a both-module workspace's `/dashboard` from the
   * Sales rail to the People one.
   */
  return 'sales';
}
