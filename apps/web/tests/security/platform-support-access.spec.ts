/**
 * Platform staff reaching a customer workspace.
 *
 * Regression cover for the bug where the platform owner could sign in, land on
 * /platform, and never reach the People or Sales modules at all: resolveCtx
 * required a WorkspaceMembership, platform staff hold none, so every /{slug}/...
 * URL bounced to /login.
 *
 * The support actor must be able to *look* and nothing more.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import { isSupportRole } from '@/lib/auth/support-actor';
import { createPlatformSessionToken } from '../helpers/session';

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let ownerId = '';
let memberId = '';

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

  // A VIEW permission must exist for the support actor to pick up.
  await prisma.permission.upsert({
    where: { module_action: { module: 'leads', action: 'VIEW' } },
    update: {},
    create: { module: 'leads', action: 'VIEW' },
  });

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
    expect(ctx.actor.roleKey).toBe('platform_support');
  });

  it('grants read access but never writes', async () => {
    const cookie = await createPlatformSessionToken(ownerId, tenantId);
    const ctx = await resolveCtx(asRequest(cookie), 'req-support');
    expect(can(ctx, 'leads', 'VIEW')).toBe(true);
    for (const action of ['CREATE', 'EDIT', 'DELETE', 'ASSIGN'] as const) {
      expect(can(ctx, 'leads', action)).toBe(false);
    }
  });

  it('never exposes sensitive fields, even to the platform owner', async () => {
    const cookie = await createPlatformSessionToken(ownerId, tenantId);
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
