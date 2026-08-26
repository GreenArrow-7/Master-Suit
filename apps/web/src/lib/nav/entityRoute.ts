/**
 * The one place that turns "what kind of record is this" into "where does it live".
 *
 * Everything that lets somebody click a record and go to it used to answer that
 * question for itself, and three different answers were in the codebase at once:
 *
 *   1. `SalesLink` resolves a module-relative href against `usePathname()`, so a
 *      Lead chip clicked from the Notifications screen resolved to
 *      `/{slug}/notifications/leads/{id}` — the page the click happened on
 *      decided the destination, not the type of the thing clicked.
 *   2. `Notification.actionUrl` stored bare paths like `/people/overtime` with a
 *      comment promising the client would prefix the workspace slug. Nothing
 *      did, and every one of those clicks 404'd.
 *   3. The three social services stored `/social-leads/{id}`, a route that does
 *      not exist under any prefix.
 *
 * So this function takes the semantic type, the record id and the workspace
 * slug, and returns a path. It reads no hooks, imports no React and consults
 * nothing ambient — the same three arguments always produce the same string,
 * whether it is called in a worker, a route handler or a client component. That
 * is the property that fixes the bug: the current URL cannot participate.
 *
 * The slug is an argument rather than something inferred because a person can
 * hold memberships in several workspaces. A notification written in workspace A
 * and read while standing in workspace B must land in A, so the caller has to
 * supply the slug that belongs to the *record*, never the one in the address bar.
 */

/** A destination that needs a record id: `/{slug}/sales/leads/{id}`. */
interface DetailDest {
  kind: 'detail';
  path: string;
}
/** A destination that is a whole screen; the record id adds nothing. */
interface ScreenDest {
  kind: 'screen';
  path: string;
}
/** A screen that selects the record through a query parameter it really reads. */
interface QueryDest {
  kind: 'query';
  path: string;
  key: string;
}
type Dest = DetailDest | ScreenDest | QueryDest;

/**
 * Every routable type, and where it goes.
 *
 * Two vocabularies share the table on purpose. Record types (`lead`,
 * `hr_leave_request`) name a thing; view types (`tasks_overdue`,
 * `leads_breached`) name a screen the assistant offers as a next step. Both are
 * destinations, both were previously written as loose path strings scattered
 * across services and tool executors, and keeping them together is what lets the
 * test at `tests/unit/entity-route.spec.ts` assert that every path here matches
 * a route that exists.
 *
 * `kind: 'query'` is used only where the destination screen genuinely reads the
 * parameter — `/people/payroll` reads `?run=`, `/people/performance` reads
 * `?cycle=`. Inventing a parameter a screen ignores would look like deep linking
 * and do nothing.
 */
const ROUTES: Record<string, Dest> = {
  // ── Sales records with a detail screen ──────────────────────────────────
  lead: { kind: 'detail', path: '/sales/leads' },
  account: { kind: 'detail', path: '/sales/accounts' },
  contact: { kind: 'detail', path: '/sales/contacts' },
  opportunity: { kind: 'detail', path: '/sales/opportunities' },
  call: { kind: 'detail', path: '/sales/calls' },
  campaign: { kind: 'detail', path: '/sales/campaigns' },
  project: { kind: 'detail', path: '/sales/projects' },
  listing: { kind: 'detail', path: '/sales/listings' },
  event: { kind: 'detail', path: '/sales/events' },
  site_visit: { kind: 'detail', path: '/sales/site-visits' },
  requirement: { kind: 'detail', path: '/sales/requirements' },

  // ── Records whose home is a queue, because no detail screen exists ──────
  // A social enquiry is worked from the Social Leads queue; there is no
  // `social-leads/[id]` route, which is precisely what the three services
  // writing `/social-leads/{id}` into `actionUrl` were assuming.
  social_comment: { kind: 'screen', path: '/sales/social-leads' },

  // ── People records ─────────────────────────────────────────────────────
  candidate: { kind: 'detail', path: '/people/recruitment' },
  employee: { kind: 'screen', path: '/people/employees' },

  // ── HR queue items: the approval queue is the destination ──────────────
  hr_overtime_request: { kind: 'screen', path: '/people/overtime' },
  hr_leave_request: { kind: 'screen', path: '/people/leave' },
  hr_shift_change_request: { kind: 'screen', path: '/people/roster' },
  hr_payroll_run: { kind: 'query', path: '/people/payroll', key: 'run' },
  hr_payslip: { kind: 'screen', path: '/people/payslips' },
  hr_requisition: { kind: 'screen', path: '/people/recruitment' },
  hr_review_cycle: { kind: 'query', path: '/people/performance', key: 'cycle' },
  hr_review: { kind: 'screen', path: '/people/performance' },
  hr_pip: { kind: 'screen', path: '/people/performance' },

  // ── Named views, for surfaces that offer a screen rather than a record ──
  leads: { kind: 'screen', path: '/sales/leads' },
  leads_mine: { kind: 'screen', path: '/sales/leads?filter=mine' },
  leads_unassigned: { kind: 'screen', path: '/sales/leads?filter=unassigned' },
  leads_overdue: { kind: 'screen', path: '/sales/leads?filter=overdue' },
  leads_breached: { kind: 'screen', path: '/sales/leads?filter=breached' },
  tasks: { kind: 'screen', path: '/sales/tasks' },
  tasks_overdue: { kind: 'screen', path: '/sales/tasks?tab=overdue' },
  follow_ups: { kind: 'screen', path: '/sales/follow-ups' },
  follow_ups_overdue: { kind: 'screen', path: '/sales/follow-ups?due=overdue' },
  calendar: { kind: 'screen', path: '/sales/calendar' },
};

export type EntityType = keyof typeof ROUTES;

/** Every type this resolver knows, for the tests and for the dev-time guard. */
export const ROUTABLE_TYPES = Object.keys(ROUTES) as EntityType[];

export function isRoutableType(value: string): value is EntityType {
  return normalise(value) in ROUTES;
}

/**
 * Types are written in three different cases by the three subsystems that store
 * them — `hr_overtime_request` by HR, `SOCIAL_COMMENT` by the social services,
 * `LEAD` by the automation engine. Normalising here means none of them has to
 * change how it writes, and a new caller cannot get it subtly wrong.
 */
function normalise(type: string): string {
  return type.trim().toLowerCase();
}

/**
 * Where a record of this type lives, in this workspace.
 *
 * Returns null rather than a guess when the type is unknown or a detail route
 * has no id: a caller that cannot build a destination should render something
 * that is not a link, not send somebody to a 404. Both the notification feed and
 * the assistant depend on that — an unroutable row simply stops being clickable.
 */
export function entityRoute(
  type: string | null | undefined,
  id: string | null | undefined,
  slug: string,
): string | null {
  if (!type || !slug) return null;
  const dest = ROUTES[normalise(type)];
  if (!dest) return null;

  const base = `/${slug}`;
  if (dest.kind === 'detail') {
    if (!id) return null;
    return `${base}${dest.path}/${encodeURIComponent(id)}`;
  }
  if (dest.kind === 'query') {
    if (!id) return `${base}${dest.path}`;
    return `${base}${dest.path}?${dest.key}=${encodeURIComponent(id)}`;
  }
  return `${base}${dest.path}`;
}
