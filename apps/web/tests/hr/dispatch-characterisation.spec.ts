/**
 * Every resource the HR dispatcher accepts, driven once.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `hr/[resource]/route.ts` is 1,089 lines and switches over 46 resources. Both
 * architecture assessments recorded its size as a readability problem and
 * recommended splitting it by resource family. The reason that had not been
 * done is not laziness — it is that **34 of the 46 branches were not named by
 * any test**, and a mechanical split of a permission-gated payroll, attendance
 * and leave surface with three-quarters of its branches uncovered is how a
 * silent regression reaches payroll.
 *
 * So the untested branches were the real defect, and the file length was only
 * the visible one. This closes the real one first.
 *
 * ── What it asserts, and why that is the useful assertion ───────────────────
 *
 * Not the contents of each response — those belong to the specs that own each
 * feature, and duplicating them here would make this file the thing that has to
 * change whenever a feature does. What it pins is the property a refactor
 * breaks and a feature change does not:
 *
 *   1. **Every enum member is reachable.** A split that drops a `case` makes it
 *      fall through, and this fails.
 *   2. **Every reachable resource returns its own data.** Status alone is not
 *      enough, and finding out why took three attempts at this assertion. The
 *      switch has **no `default`**, so a dropped `case` falls out of the
 *      function returning `undefined` — and the kernel serialises that as
 *      `200 {"ok":true}`. A missing resource is therefore indistinguishable
 *      from a cheerful success: not a 5xx, not an empty body, not an error.
 *      Every weaker form of this check passed against a deliberately deleted
 *      `case`. So the assertion is specifically that a 2xx is an array, or an
 *      object carrying something other than the bare `{ok:true}` envelope.
 *   3. **The permission gate is the declared one.** A caller holding only the
 *      floor permission is refused exactly the resources `RESOURCE_PERMISSION`
 *      says need more — so a split cannot quietly move a resource to the floor.
 *   4. **Which `FLOOR` resources delegate downward is pinned.** `FLOOR` does not
 *      mean "anyone with `employee:VIEW` may read this"; the route's own comment
 *      is explicit that it means "no *additional route-level* check", and that
 *      protection for some of them lives in the service — `listRequisitions`
 *      throws without `mayReadRecruitment`. That is a deliberate design and not
 *      a gap, but it is invisible from the map, so the set is written down here
 *      and fails if it changes. The first run of this file found three such
 *      resources the author of a split would have had no way to know about.
 *   5. **The enum and the permission map agree**, checked against the route's
 *      own schema rather than a list copied into this file, which would rot.
 *
 * That is a characterisation test: it does not say the behaviour is *right*, it
 * says the behaviour does not *change*. That is exactly what is needed before
 * moving 1,089 lines, and it is worth having afterwards too.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as hrRead } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { get } from '../helpers/request';
import type { PermissionAction, VisibilityScope } from '@prisma/client';

const suffix = randomBytes(4).toString('hex');
const slug = `hr-dispatch-${suffix}`;
let tenantId = '';
let fullCookie = '';
let floorCookie = '';

/**
 * The resources, and what each needs beyond `employee:VIEW`.
 *
 * Deliberately spelled out rather than imported: this file is the independent
 * statement of the contract, and importing the map would make the test agree
 * with the route by construction. The final case below asserts the two lists
 * describe the same set, so a resource added to one and not the other fails.
 */
const RESOURCES: Record<string, [string, PermissionAction] | null> = {
  departments: null,
  designations: null,
  employees: null,
  attendance: null,
  shifts: null,
  leave: null,
  holidays: null,
  documents: null,
  'work-locations': null,
  'leave-types': null,
  'leave-balances': null,
  'leave-pending': ['leave', 'APPROVE'],
  'leave-calendar': null,
  checklist: null,
  lifecycle: null,
  'expiring-documents': null,
  settlement: null,
  'attendance-days': null,
  'attendance-punches': null,
  'attendance-review': ['attendance', 'APPROVE'],
  'face-status': null,
  'location-assignments': null,
  settings: ['employee', 'EDIT'],
  'temporary-requests': ['attendance', 'APPROVE'],
  'exception-requests': ['attendance', 'APPROVE'],
  'exception-reasons': null,
  overtime: null,
  'overtime-pending': ['overtime', 'APPROVE'],
  'payroll-runs': ['payroll', 'VIEW'],
  'payroll-run': ['payroll', 'VIEW'],
  payslips: null,
  compensation: null,
  roster: null,
  'shift-changes': null,
  requisitions: null,
  candidates: null,
  candidate: null,
  pipeline: null,
  'review-cycles': null,
  reviews: null,
  goals: null,
  competencies: null,
  pips: null,
  'performance-summary': null,
  reports: null,
  report: null,
};

const at = (resource: string) => ({
  path: `/api/v1/workspaces/${slug}/hr/${resource}`,
  params: { workspaceSlug: slug, resource },
});

async function member(label: string, grants: [string, PermissionAction][], scope: VisibilityScope = 'ORGANIZATION') {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 10 },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope },
    });
  }
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@dispatch.test`,
    fullName: label,
  });
  return createSessionToken(tenantId, user.id);
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Dispatch LLC', displayName: 'Dispatch', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  // Everything RESOURCE_PERMISSION can ask for, *plus* the permissions the
  // services assert for themselves — otherwise a service-gated 403 would read
  // as a broken branch. See SERVICE_GATED below.
  const every = new Set<string>(['recruitment:VIEW', 'performance:VIEW']);
  for (const extra of Object.values(RESOURCES)) if (extra) every.add(`${extra[0]}:${extra[1]}`);
  fullCookie = await member('full', [
    ['employee', 'VIEW'],
    ...[...every].map((k) => k.split(':') as [string, PermissionAction]),
  ]);

  // The floor and nothing else.
  floorCookie = await member('floor', [['employee', 'VIEW']]);
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('every resource the dispatcher declares is reachable', () => {
  it.each(Object.keys(RESOURCES))('GET %s does not fall through or throw', async (resource) => {
    const { path, params } = at(resource);
    const response = await get(hrRead, path, fullCookie, params);

    // A 5xx is a branch that throws on an empty workspace.
    expect(
      response.status,
      `GET ${resource} returned ${response.status}: ${JSON.stringify(response.body)}`,
    ).toBeLessThan(500);

    // 400/404/422 are legitimate for the resources that need an `id` they were
    // not given. 401/403 are not — this caller holds every declared permission.
    expect([401, 403]).not.toContain(response.status);

    // The one that catches a dropped `case`. There is no `default` in the
    // switch, so falling through returns `undefined` and the kernel answers 200
    // with nothing in it — indistinguishable from a working empty list unless
    // the body is inspected.
    if (response.status < 300) {
      const body = response.body as unknown;
      // `{ok:true}` is what a fall-through produces, so it is the one shape a
      // read must never have. Verified by deleting a `case` and watching this
      // fail — three looser versions of this line did not.
      const isBareOk =
        typeof body === 'object' &&
        body !== null &&
        !Array.isArray(body) &&
        Object.keys(body).length === 1 &&
        (body as { ok?: unknown }).ok === true;
      const shaped = Array.isArray(body) || (typeof body === 'object' && body !== null && !isBareOk);
      expect(
        shaped,
        `GET ${resource} answered ${response.status} with ${JSON.stringify(body)} — the case fell through`,
      ).toBe(true);
    }
  });
});

describe('the declared permission gate is the one that runs', () => {
  const gated = Object.entries(RESOURCES).filter(([, extra]) => extra !== null);

  it.each(gated)('%s refuses a caller holding only employee:VIEW', async (resource) => {
    const { path, params } = at(resource);
    const response = await get(hrRead, path, floorCookie, params);
    expect(response.status).toBe(403);
  });

  /**
   * `FLOOR` resources whose protection is a service assertion, not the map.
   *
   * Found by running this file: each is declared `FLOOR` and still refuses a
   * caller holding only `employee:VIEW`, because `listRequisitions`,
   * `listCandidates` and `pipelineSummary` each call `mayReadRecruitment`,
   * which wants `recruitment:VIEW` at TEAM scope or better.
   *
   * That is the documented design — the route's `FLOOR` comment says so in as
   * many words — but it is not visible from `RESOURCE_PERMISSION`, and somebody
   * splitting this file by resource family would read the map, see `FLOOR`, and
   * have no reason to preserve a gate they never knew existed. Pinned so the
   * set cannot grow or shrink unnoticed.
   */
  const SERVICE_GATED = new Set(['requisitions', 'candidates', 'pipeline']);

  /**
   * A note on what this suite deliberately cannot catch.
   *
   * Deleting a resource's entry from `RESOURCE_PERMISSION` — moving
   * `payroll-runs` to `FLOOR`, say — does not change observable behaviour,
   * because `listRuns` and `runDetail` call `mayReadPayroll` for themselves.
   * That was checked by making the change and watching all 94 tests stay green.
   *
   * That is defence in depth working, not a hole: the route-level declaration
   * and the service assertion are two independent statements of the same rule,
   * and losing one leaves the other. It does mean the map is documentation as
   * much as enforcement for those resources, which is worth knowing before
   * trusting it as the single source of truth in a refactor.
   */

  const open = Object.entries(RESOURCES).filter(([r, extra]) => extra === null && !SERVICE_GATED.has(r));

  it.each(open)('%s admits a caller holding only employee:VIEW', async (resource) => {
    const { path, params } = at(resource);
    const response = await get(hrRead, path, floorCookie, params);
    // Not 403: the floor is the whole gate for these, and a refactor that
    // tightened one silently would be caught here rather than by a user.
    expect(response.status).not.toBe(403);
    expect(response.status).toBeLessThan(500);
  });

  it.each([...SERVICE_GATED])('%s is FLOOR in the map and still gated by its service', async (resource) => {
    const { path, params } = at(resource);
    const floor = await get(hrRead, path, floorCookie, params);
    expect(floor.status, `${resource} no longer delegates to a service gate`).toBe(403);

    // And the gate opens for the permission the service actually wants, which
    // is what makes the line above a gate rather than a broken branch.
    const full = await get(hrRead, path, fullCookie, params);
    expect(full.status).toBeLessThan(400);
  });

  it('no other FLOOR resource has quietly acquired a service gate', async () => {
    const surprises: string[] = [];
    for (const [resource, extra] of Object.entries(RESOURCES)) {
      if (extra !== null || SERVICE_GATED.has(resource)) continue;
      const { path, params } = at(resource);
      const response = await get(hrRead, path, floorCookie, params);
      if (response.status === 403) surprises.push(resource);
    }
    // A resource appearing here is not necessarily wrong — it may be a
    // deliberate new service gate — but it must be added to SERVICE_GATED so
    // the next person to read the map learns about it from somewhere.
    expect(surprises).toEqual([]);
  });
});

describe('this file and the route agree about which resources exist', () => {
  it('names exactly the resources the route schema accepts', async () => {
    // Read from the route's own source rather than from an export, because the
    // enum is inside a Zod schema and exporting it for a test would change the
    // module's surface to suit the test.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const source = readFileSync(
      path.resolve(__dirname, '../../src/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route.ts'),
      'utf8',
    );
    const block =
      /resource:\s*z\s*\n?\s*\.enum\(\[([\s\S]*?)\]\)/.exec(source) ?? /z\.enum\(\[([\s\S]*?)\]\)/.exec(source);
    expect(block, 'could not find the resource enum in the route source').not.toBeNull();

    const declared = [...block![1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!).sort();
    const covered = Object.keys(RESOURCES).sort();

    expect(covered).toEqual(declared);
  });
});
