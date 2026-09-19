import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as selfPost } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/self/[action]/route';
import { POST as actionsPost } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/actions/[action]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { post } from '../helpers/request';

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

beforeAll(async () => {
  slug = `self-${suffix}`;
  const tenant = await prisma.tenant.create({ data: { slug, legalName: 'Self Service Co', displayName: 'Self Service', status: 'ACTIVE' } });
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
  const membership = await prisma.workspaceMembership.findFirstOrThrow({ where: { tenantId, salesUserId: user.id } });
  await prisma.employeeProfile.create({
    data: { tenantId, membershipId: membership.id, employeeNumber: `SS-${suffix}`, employmentStatus: 'ACTIVE' },
  });
  cookie = await createSessionToken(tenantId, user.id);
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

const at = (base: 'self' | 'actions', action: string) => ({
  path: `/api/v1/workspaces/${slug}/hr/${base}/${action}`,
  params: { workspaceSlug: slug, action },
});

describe('self-service attendance for an employee without employee:VIEW', () => {
  it('records consent and answers preflight on hr/self', async () => {
    const consent = await post(selfPost, at('self', 'consent-grant').path, {}, cookie, at('self', 'consent-grant').params);
    expect(consent.status).toBe(200);

    const preflight = await post(
      selfPost,
      at('self', 'attendance-preflight').path,
      { action: 'CHECK_IN', latitude: 25.2, longitude: 55.27, gpsAccuracyM: 10 },
      cookie,
      at('self', 'attendance-preflight').params,
    );
    // Not a permission failure: the employee is told about their own assignment state.
    expect(preflight.status).toBe(200);
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
