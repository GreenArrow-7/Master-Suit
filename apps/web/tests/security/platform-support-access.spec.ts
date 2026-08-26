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
import { can } from '@/lib/security/rbac';
import { isSupportRole } from '@/lib/auth/support-actor';
import { createPlatformSessionToken } from '../helpers/session';

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

  it('refuses a plain company user with no membership — support access is not a fallback for everyone', async () => {
    const cookie = await createPlatformSessionToken(memberId, tenantId);
    await expect(resolveCtx(asRequest(cookie), 'req-member')).rejects.toThrow();
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
