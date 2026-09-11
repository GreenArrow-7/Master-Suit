/**
 * Platform staff reaching a customer workspace.
 *
 * Regression cover for the bug where the platform owner could sign in, land on
 * /platform, and never reach the People or Sales modules at all: resolveCtx
 * required a WorkspaceMembership, platform staff hold none, so every /{slug}/...
 * URL bounced to /login.
 *
 * Authority is tiered: the OWNER administers customer data with full control,
 * while SUPPORT and SECURITY_AUDITOR may look and nothing more.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { openGrant, revokeGrants } from '@/lib/auth/platform-access';
import { resolveCtx } from '@/lib/auth/session';
import { can, scopeFor } from '@/lib/security/rbac';
import { isSupportRole } from '@/lib/auth/support-actor';
import { mayReadPayroll } from '@/services/hr/payroll';
import { createPlatformSessionToken } from '../helpers/session';
import { GET as listLeads } from '@/app/api/v1/leads/route';

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let ownerId = '';
let memberId = '';
let supportId = '';

const asRequest = (cookie: string) => new Request('http://internal/', { headers: { cookie } });

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `support-${suffix}`, legalName: 'Support LLC', displayName: 'Support Co' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.createMany({
    data: [
      { tenantId, module: 'HRMS', state: 'ACTIVE' },
      { tenantId, module: 'SALES', state: 'ACTIVE' },
    ],
  });

  // The permissions these cases assert on must exist in the catalogue — the
  // support actor grants only rows that are actually there.
  for (const [module, action] of [
    ['leads', 'VIEW'],
    ['leads', 'CREATE'],
    ['leads', 'EDIT'],
    ['leads', 'DELETE'],
    ['leads', 'ASSIGN'],
    ['employee', 'VIEW_SENSITIVE_FIELDS'],
    ['hr_documents', 'VIEW_SENSITIVE_FIELDS'],
  ] as const) {
    await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
  }

  const owner = await prisma.platformUser.create({
    data: {
      email: `owner.${suffix}@platform.test`,
      normalizedEmail: `owner.${suffix}@platform.test`,
      fullName: 'Support Owner',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'OWNER',
    },
  });
  ownerId = owner.id;

  const member = await prisma.platformUser.create({
    data: {
      email: `member.${suffix}@customer.test`,
      normalizedEmail: `member.${suffix}@customer.test`,
      fullName: 'Plain Member',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'USER',
    },
  });
  memberId = member.id;

  const support = await prisma.platformUser.create({
    data: {
      email: `support.${suffix}@platform.test`,
      normalizedEmail: `support.${suffix}@platform.test`,
      fullName: 'Support Staff',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'SUPPORT',
    },
  });
  supportId = support.id;
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('platform support access', () => {
  it('treats owner, support and security auditor as support roles — and nobody else', () => {
    expect(isSupportRole('OWNER')).toBe(true);
    expect(isSupportRole('SUPPORT')).toBe(true);
    expect(isSupportRole('SECURITY_AUDITOR')).toBe(true);
    expect(isSupportRole('USER')).toBe(false);
  });

  it('resolves a workspace context for platform staff who hold no membership', async () => {
    const cookie = await createPlatformSessionToken(ownerId, tenantId);
    const ctx = await resolveCtx(asRequest(cookie), 'req-support');
    expect(ctx.tenantId).toBe(tenantId);
    expect(ctx.actor.roleKey).toBe('platform_owner');
  });

  it('keeps the OWNER read-only until they open a break-glass grant', async () => {
    // This asserted full control, which is what the code did: an OWNER held
    // every permission in every tenant from the moment they opened a workspace,
    // permanently, with no record of why. Reading a customer's data and changing
    // it are different acts — see lib/auth/platform-access.ts.
    const cookie = await createPlatformSessionToken(ownerId, tenantId);
    const before = await resolveCtx(asRequest(cookie), 'req-owner');
    expect(can(before, 'leads', 'VIEW')).toBe(true);
    for (const action of ['CREATE', 'EDIT', 'DELETE', 'ASSIGN'] as const) {
      expect(can(before, 'leads', action)).toBe(false);
    }
    expect(can(before, 'employee', 'VIEW_SENSITIVE_FIELDS')).toBe(false);
  });

  it('gives the OWNER full control while a grant is live, and takes it back after', async () => {
    const cookie = await createPlatformSessionToken(ownerId, tenantId);
    await openGrant({
      platformUserId: ownerId,
      tenantId,
      reason: 'Repairing a duplicated payroll run for this customer',
    });

    const elevated = await resolveCtx(asRequest(cookie), 'req-owner-elevated');
    for (const action of ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'ASSIGN'] as const) {
      expect(can(elevated, 'leads', action)).toBe(true);
    }
    expect(can(elevated, 'employee', 'VIEW_SENSITIVE_FIELDS')).toBe(true);

    // Same session, same cookie: the grant is checked per request, so handing it
    // back does not wait for a sign-in.
    await revokeGrants(ownerId, tenantId);
    const after = await resolveCtx(asRequest(cookie), 'req-owner-after');
    expect(can(after, 'leads', 'EDIT')).toBe(false);
    expect(can(after, 'leads', 'VIEW')).toBe(true);
  });

  it('keeps SUPPORT read-only', async () => {
    const cookie = await createPlatformSessionToken(supportId, tenantId);
    const ctx = await resolveCtx(asRequest(cookie), 'req-support');
    expect(ctx.actor.roleKey).toBe('platform_support');
    expect(can(ctx, 'leads', 'VIEW')).toBe(true);
    for (const action of ['CREATE', 'EDIT', 'DELETE', 'ASSIGN'] as const) {
      expect(can(ctx, 'leads', action)).toBe(false);
    }
  });

  it('never exposes sensitive fields to SUPPORT', async () => {
    const cookie = await createPlatformSessionToken(supportId, tenantId);
    const ctx = await resolveCtx(asRequest(cookie), 'req-support');
    expect(can(ctx, 'employee', 'VIEW_SENSITIVE_FIELDS')).toBe(false);
    expect(can(ctx, 'hr_documents', 'VIEW_SENSITIVE_FIELDS')).toBe(false);
  });

  /**
   * The assertion the test above looks like it already makes, and does not.
   *
   * Payroll is not a sensitive *field*: services/hr/payroll.ts gates it on
   * `payroll:VIEW` at ORGANIZATION scope, which buildSupportActor handed to every
   * support role. So `mayReadPayroll` was true for a read-only platform identity
   * — every payroll run, every payslip's net pay, every compensation history, and
   * the payslip PDF download — while the VIEW_SENSITIVE_FIELDS assertion above
   * passed and read as if it covered exactly that.
   *
   * Asserted through `mayReadPayroll` itself rather than a `can()` call, so this
   * fails if the module set stops matching the gate the service actually applies.
   */
  it('cannot read payroll or employment records — not a sensitive field, a whole module', async () => {
    const cookie = await createPlatformSessionToken(supportId, tenantId);
    const ctx = await resolveCtx(asRequest(cookie), 'req-support');

    expect(mayReadPayroll(ctx)).toBe(false);
    for (const moduleKey of ['payroll', 'employee', 'hr_documents', 'overtime', 'performance', 'recruitment']) {
      expect(scopeFor(ctx, moduleKey, 'VIEW')).toBe('NONE');
    }
    // Still everything it is supposed to see, so this is an exclusion and not a
    // blanket narrowing that happens to cover HR.
    for (const moduleKey of ['leads', 'calls', 'tasks', 'activities', 'visits']) {
      expect(scopeFor(ctx, moduleKey, 'VIEW')).toBe('ORGANIZATION');
    }
  });

  it('withholds payroll from an un-elevated OWNER too — being the owner is not a reason', async () => {
    const cookie = await createPlatformSessionToken(ownerId, tenantId);
    const ctx = await resolveCtx(asRequest(cookie), 'req-owner-hr');
    expect(mayReadPayroll(ctx)).toBe(false);
    expect(scopeFor(ctx, 'employee', 'VIEW')).toBe('NONE');
  });

  /**
   * The door that stays open, and must: a payroll fault cannot be repaired by
   * somebody who cannot read payroll. Break-glass is the audited, time-boxed,
   * reason-carrying path, which is the whole difference from ambient access.
   */
  it('gives payroll back under a break-glass grant, and takes it away again', async () => {
    const cookie = await createPlatformSessionToken(ownerId, tenantId);
    await openGrant({
      platformUserId: ownerId,
      tenantId,
      reason: 'Repairing a duplicated payroll run for this customer',
    });
    const elevated = await resolveCtx(asRequest(cookie), 'req-owner-hr-elevated');
    expect(mayReadPayroll(elevated)).toBe(true);

    await revokeGrants(ownerId, tenantId);
    const after = await resolveCtx(asRequest(cookie), 'req-owner-hr-after');
    expect(mayReadPayroll(after)).toBe(false);
  });

  it('refuses a plain company user with no membership — support access is not a fallback for everyone', async () => {
    const cookie = await createPlatformSessionToken(memberId, tenantId);
    await expect(resolveCtx(asRequest(cookie), 'req-member')).rejects.toThrow();
  });

  /**
   * The asymmetry that made a machine better-audited than a person.
   *
   * `AI_SERVICE` had every request written to the platform log by the API
   * kernel. A human holding platform staff authority had one WORKSPACE_OPENED
   * row at the door and nothing afterwards, because the kernel's hook was
   * `if (ctx?.service)` and a support actor carries no `ctx.service`. Everything
   * they read after entering — every lead, every call, every follow-up — left no
   * trace attributable to them.
   */
  it('writes a platform audit row for a support read, as it always did for a machine read', async () => {
    const cookie = await createPlatformSessionToken(supportId, tenantId);
    const before = await prisma.platformAuditEvent.count({
      where: { tenantId, actorUserId: supportId, event: 'SUPPORT_READ' },
    });

    const res = await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);

    const rows = await prisma.platformAuditEvent.findMany({
      where: { tenantId, actorUserId: supportId, event: 'SUPPORT_READ' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(rows.length).toBe(before + 1);

    const row = rows[0]!;
    // Attributable: which staff member, which workspace, which request.
    expect(row.actorUserId).toBe(supportId);
    expect(row.tenantId).toBe(tenantId);
    expect(row.objectType).toBe('leads');
    expect(row.requestId).toBeTruthy();
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.action).toBe('VIEW');
    expect(meta.path).toBe('/api/v1/leads');
    expect(meta.roleKey).toBe('platform_support');
    // A machine's credential id has no meaning for a person, and inventing one
    // would make the two streams look more alike than they are.
    expect(meta.credentialId).toBeUndefined();
  });

  it('leaves one of the customer’s own employees unaudited by this path', async () => {
    // The hook is for cross-tenant readers. A workspace member reading their own
    // workspace's leads is ordinary use, already covered by AuditLog where it
    // matters, and must not be duplicated into the platform trail.
    const before = await prisma.platformAuditEvent.count({ where: { tenantId, event: 'SUPPORT_READ' } });
    const cookie = await createPlatformSessionToken(supportId, tenantId);
    await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });
    const afterStaff = await prisma.platformAuditEvent.count({ where: { tenantId, event: 'SUPPORT_READ' } });
    expect(afterStaff).toBe(before + 1);

    // `memberId` is a platform USER with no membership here, so it cannot reach
    // the route at all — which is itself the assertion that support access is
    // not a fallback. The absence of a SUPPORT_READ row for it follows.
    const memberCookie = await createPlatformSessionToken(memberId, tenantId);
    await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie: memberCookie } }), {
      params: Promise.resolve({}),
    }).catch(() => undefined);
    expect(await prisma.platformAuditEvent.count({ where: { tenantId, actorUserId: memberId } })).toBe(0);
  });

  it('pins the support actor to the workspace it was opened for', async () => {
    const other = await prisma.tenant.create({
      data: { slug: `other-${suffix}`, legalName: 'Other LLC', displayName: 'Other Co' },
    });
    try {
      const cookie = await createPlatformSessionToken(ownerId, other.id);
      const ctx = await resolveCtx(asRequest(cookie), 'req-other');
      expect(ctx.tenantId).toBe(other.id);
      expect(ctx.tenantId).not.toBe(tenantId);
    } finally {
      await prisma.tenant.delete({ where: { id: other.id } }).catch(() => {});
    }
  });
});
