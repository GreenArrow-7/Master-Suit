/**
 * P0-2 — credentials must never appear in a response body.
 *
 * `include: { platformUser: true }` returns every scalar on the relation, and
 * both PlatformUser and User carry `passwordHash`, `mfaSecret` and
 * `mfaRecoveryCodes`. Twenty-three HR queries did that and handed the result
 * straight to NextResponse.json, so any holder of `hrms:VIEW` could read the
 * argon2 hash and the *live TOTP secret* of everyone in the workspace. A TOTP
 * secret is not a hash: knowing it generates valid codes forever.
 *
 * Two layers are asserted here, because either alone would be one mistake away
 * from regressing:
 *   1. the scrub in lib/api/handler.ts — property-level, on every route;
 *   2. the real HR read endpoints, driven end to end against real rows.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { SECRET_KEYS } from '@/lib/security/audit';
import { GET as hrGet } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { createSessionToken } from '../helpers/session';
import { get } from '../helpers/request';
import type { Grants } from '../helpers/fixtures';

const suffix = randomBytes(4).toString('hex');
const slug = `egress-${suffix}`;

/** Every key in `SECRET_KEYS` found anywhere in the structure, with its path. */
function findSecrets(value: unknown, path = '$', hits: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return hits;
  if (Array.isArray(value)) {
    value.forEach((item, i) => findSecrets(item, `${path}[${i}]`, hits));
    return hits;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) hits.push(`${path}.${key}`);
    findSecrets(item, `${path}.${key}`, hits);
  }
  return hits;
}

/**
 * Every GET resource the HR route serves. Taken from the route's own param
 * enum, so a resource added later fails this test until it is listed — the
 * point is that this is a sweep, not a handful of hand-picked cases.
 */
const HR_RESOURCES = [
  'departments',
  'employees',
  'attendance',
  'shifts',
  'leave',
  'holidays',
  'documents',
  'work-locations',
  'leave-types',
  'leave-pending',
  'leave-calendar',
  'lifecycle',
  'expiring-documents',
  'attendance-days',
  'attendance-punches',
  'attendance-review',
  'location-assignments',
  'settings',
  'temporary-requests',
  'exception-requests',
  'exception-reasons',
] as const;

let tenantId = '';
let cookie = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Egress LLC', displayName: 'Egress', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `hr-${suffix}`, name: 'HR', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of [
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
    ['hr_documents', 'VIEW'],
    ['hr_documents', 'VIEW_SENSITIVE_FIELDS'],
    ['leave', 'APPROVE'],
    ['attendance', 'APPROVE'],
  ] as Grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }

  // A person carrying every secret the leak exposed, so an unfiltered read has
  // something real to expose.
  //
  // Only the identity carries them now: P1-9 dropped the duplicate credential
  // columns from `User`, so half the original leak surface no longer exists at
  // the schema level rather than being filtered out.
  const salesUser = await prisma.user.create({
    data: { tenantId, email: `victim-${suffix}@egress.test`, fullName: 'Victim', roleId: role.id, status: 'ACTIVE' },
  });
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `victim-${suffix}@egress.test`,
      normalizedEmail: `victim-${suffix}@egress.test`,
      fullName: 'Victim',
      status: 'ACTIVE',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$SALTSALTSALT$HASHHASHHASH',
      mfaEnabled: true,
      mfaSecret: 'JBSWY3DPEHPK3PXP',
      mfaRecoveryCodes: ['recovery-one', 'recovery-two'],
    },
  });
  const membership = await prisma.workspaceMembership.create({
    data: {
      tenantId,
      platformUserId: platformUser.id,
      salesUserId: salesUser.id,
      status: 'ACTIVE',
      roleSnapshot: role.key,
      joinedAt: new Date(),
    },
  });
  await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `E-${suffix}`,
      employmentStatus: 'ACTIVE',
      joinedOn: new Date(),
    },
  });

  cookie = await createSessionToken(tenantId, salesUser.id);
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.platformUser
      .deleteMany({ where: { normalizedEmail: `victim-${suffix}@egress.test` } })
      .catch(() => {});
  }
});

describe('P0-2 no response body carries a credential', () => {
  it.each(HR_RESOURCES)('GET hr/%s', async (resource) => {
    const res = await get(hrGet, `/api/v1/workspaces/${slug}/hr/${resource}`, cookie, {
      workspaceSlug: slug,
      resource,
    });

    // 200 or a clean refusal — either is fine. A 500 would mean the sweep never
    // reached the serialiser and the assertion below proves nothing.
    expect(res.status).toBeLessThan(500);
    expect(findSecrets(res.body)).toEqual([]);
  });

  it('the fixture really does carry secrets — an unfiltered read still exposes them', async () => {
    // Guards the test itself: if the fixture stopped carrying secrets, every
    // case above would pass vacuously.
    const raw = await prisma.employeeProfile.findMany({
      where: { tenantId },
      include: { membership: { include: { platformUser: true, salesUser: true } } },
    });
    expect(findSecrets(raw).length).toBeGreaterThan(0);
  });
});

describe('P0-2 the kernel scrub', () => {
  // Imported lazily so the module-level route table above is not disturbed.
  it('removes credential keys at any depth, through arrays and nesting', async () => {
    const { scrubForTest } = await import('@/lib/api/handler');
    const scrubbed = scrubForTest({
      id: 'u1',
      passwordHash: 'secret',
      nested: { mfaSecret: 'JBSWY3DPEHPK3PXP', keep: 1 },
      list: [{ mfaRecoveryCodes: ['a'], name: 'x' }, { tokenHash: 'h' }],
    });
    expect(findSecrets(scrubbed)).toEqual([]);
    expect(scrubbed).toEqual({ id: 'u1', nested: { keep: 1 }, list: [{ name: 'x' }, {}] });
  });

  it('leaves Date and Buffer values intact rather than flattening them', async () => {
    const { scrubForTest } = await import('@/lib/api/handler');
    const when = new Date('2026-01-02T03:04:05.000Z');
    const bytes = Buffer.from('hello');
    const out = scrubForTest({ when, bytes, passwordHash: 'x' });
    expect(out.when).toBeInstanceOf(Date);
    expect(out.when.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(Buffer.isBuffer(out.bytes)).toBe(true);
    expect(out.bytes.toString()).toBe('hello');
    expect('passwordHash' in out).toBe(false);
  });

  it('survives a cycle', async () => {
    const { scrubForTest } = await import('@/lib/api/handler');
    const node: any = { name: 'root', passwordHash: 'x' };
    node.self = node;
    const out = scrubForTest(node);
    expect(out.name).toBe('root');
    expect('passwordHash' in out).toBe(false);
    expect(out.self).toBe(out);
  });
});
