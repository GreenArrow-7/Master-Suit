import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as selfGet, POST as selfPost } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/self/[action]/route';
import { POST as actionsPost } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/actions/[action]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { get, post } from '../helpers/request';

/**
 * An ordinary employee — no HR directory permission at all — must be able to
 * give biometric consent and start a check-in. The check-in and security
 * screens are wired to `hr/self` for exactly this reason; `hr/actions` still
 * gates the same verbs on `employee:VIEW`, which this employee does not hold.
 */
const suffix = randomBytes(4).toString('hex');
let tenantId: string;
let slug: string;
let cookie: string;
let salesTenantId: string;
let salesSlug: string;
let salesCookie: string;

/** A tenant with one ordinary employee on the given modules, and that employee's session. */
async function workspaceWithEmployee(key: string, modules: ('HRMS' | 'SALES')[]) {
  const tenant = await prisma.tenant.create({
    data: { slug: key, legalName: `${key} Co`, displayName: key, status: 'ACTIVE' },
  });
  for (const product of modules) {
    await prisma.moduleEntitlement.create({ data: { tenantId: tenant.id, module: product, state: 'ACTIVE' } });
  }
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: `employee-${key}`, name: 'Employee', rank: 90, defaultScope: 'OWN' },
  });
  const user = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: role.id,
    email: `staff-${key}@example.com`,
    fullName: 'Plain Staff',
  });
  await prisma.employeeProfile.create({
    data: {
      tenantId: tenant.id,
      membershipId: user.membershipId,
      employeeNumber: `SS-${key}`,
      employmentStatus: 'ACTIVE',
    },
  });
  return { tenantId: tenant.id, cookie: await createSessionToken(tenant.id, user.id) };
}

beforeAll(async () => {
  slug = `self-${suffix}`;
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Self Service Co', displayName: 'Self Service', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  const role = await prisma.role.create({
    data: { tenantId, key: `employee-${suffix}`, name: 'Employee', rank: 90, defaultScope: 'OWN' },
  });
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `staff-${suffix}@example.com`,
    fullName: 'Plain Staff',
  });
  await prisma.employeeProfile.create({
    data: { tenantId, membershipId: user.membershipId, employeeNumber: `SS-${suffix}`, employmentStatus: 'ACTIVE' },
  });
  cookie = await createSessionToken(tenantId, user.id);

  salesSlug = `self-sales-${suffix}`;
  ({ tenantId: salesTenantId, cookie: salesCookie } = await workspaceWithEmployee(salesSlug, ['SALES']));
});

afterAll(async () => {
  for (const id of [tenantId, salesTenantId]) {
    await prisma.tenant.delete({ where: { id } }).catch(() => {});
  }
});

const at = (base: 'self' | 'actions', action: string, workspace = slug) => ({
  path: `/api/v1/workspaces/${workspace}/hr/${base}/${action}`,
  params: { workspaceSlug: workspace, action },
});

/**
 * What the check-in console sends to preflight. Read from the console rather
 * than typed here, because typing it here is how this spec came to agree with
 * the route while both disagreed with the only caller: it posted `action`, the
 * route parsed `action`, CI was green, and every real preflight threw.
 */
const PREFLIGHT = { punchType: 'CHECK_IN', latitude: 25.2, longitude: 55.27, gpsAccuracyM: 10 };

describe('self-service attendance for an employee without employee:VIEW', () => {
  it('records consent and answers preflight on hr/self', async () => {
    const consent = await post(
      selfPost,
      at('self', 'consent-grant').path,
      {},
      cookie,
      at('self', 'consent-grant').params,
    );
    expect(consent.status).toBe(200);

    const preflight = await post(
      selfPost,
      at('self', 'attendance-preflight').path,
      PREFLIGHT,
      cookie,
      at('self', 'attendance-preflight').params,
    );
    // Not a permission failure: the employee is told about their own assignment state.
    expect(preflight.status).toBe(200);
  });

  /**
   * `hr/self` takes API keys by design, so a client outside this repository may
   * have been sending the old field name while the console could not. Fixing
   * one must not break the other.
   */
  it('still accepts the old `action` field, for clients built against it', async () => {
    const { punchType, ...where } = PREFLIGHT;
    const res = await post(
      selfPost,
      at('self', 'attendance-preflight').path,
      { action: punchType, ...where },
      cookie,
      at('self', 'attendance-preflight').params,
    );
    expect(res.status).toBe(200);
  });

  it('refuses a preflight that names neither field', async () => {
    const { punchType: _omitted, ...where } = PREFLIGHT;
    const res = await post(
      selfPost,
      at('self', 'attendance-preflight').path,
      where,
      cookie,
      at('self', 'attendance-preflight').params,
    );
    expect(res.status).toBe(422);
  });

  it('sends preflight the field the route reads', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'src', 'app', '(workspace)', '[workspaceSlug]', 'check-in', 'CheckInConsole.tsx'),
      'utf8',
    );
    const call = source.slice(source.indexOf("post('attendance-preflight'"));
    expect(call.slice(0, call.indexOf('})')), 'the console no longer sends punchType').toContain('punchType');
  });

  it('lists the employee’s own recent punches on hr/self', async () => {
    const res = await get(
      selfGet,
      `${at('self', 'attendance-punches').path}?limit=8`,
      cookie,
      at('self', 'attendance-punches').params,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * The check-in screen now sits outside every module folder, so a workspace
   * licensing Sales without People can open it. That is only worth anything if
   * the API behind it serves them too.
   */
  it('serves a workspace that licenses Sales and not People', async () => {
    const consent = await post(
      selfPost,
      at('self', 'consent-grant', salesSlug).path,
      {},
      salesCookie,
      at('self', 'consent-grant', salesSlug).params,
    );
    expect(consent.status).toBe(200);

    const preflight = await post(
      selfPost,
      at('self', 'attendance-preflight', salesSlug).path,
      PREFLIGHT,
      salesCookie,
      at('self', 'attendance-preflight', salesSlug).params,
    );
    expect(preflight.status).toBe(200);

    const recent = await get(
      selfGet,
      `${at('self', 'attendance-punches', salesSlug).path}?limit=8`,
      salesCookie,
      at('self', 'attendance-punches', salesSlug).params,
    );
    expect(recent.status).toBe(200);
  });

  it('the HR dispatcher still refuses the same verbs for that employee', async () => {
    const res = await post(
      actionsPost,
      at('actions', 'attendance-challenge').path,
      {},
      cookie,
      at('actions', 'attendance-challenge').params,
    );
    expect(res.status).toBe(403);
  });
});
