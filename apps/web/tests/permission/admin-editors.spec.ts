/**
 * 4.4 — the administration area was output-only.
 *
 * Company profile, security, modules and subscription each rendered a static
 * two-column table with no form, no button and no input, so a workspace could
 * read its own settings and change none of them. A customer who rebranded could
 * not change their own display name.
 *
 * Two sections are now writable, and two are deliberately not: modules and
 * subscription belong to the platform owner, and an endpoint that let a
 * workspace grant itself a module would make entitlement decorative.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { PATCH as settingsPatch } from '@/app/api/v1/workspaces/[workspaceSlug]/settings/[section]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { patch } from '../helpers/request';
import type { Grants } from '../helpers/fixtures';

const suffix = randomBytes(4).toString('hex');
const slug = `admined-${suffix}`;

let tenantId = '';
let adminCookie = '';
let viewerCookie = '';

async function member(label: string, grants: Grants) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 10, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@admined.test`,
    fullName: label,
  });
  return createSessionToken(tenantId, user.id);
}

const at = (section: string) => ({
  path: `/api/v1/workspaces/${slug}/settings/${section}`,
  params: { workspaceSlug: slug, section },
});

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      legalName: 'Admin Editors LLC',
      displayName: 'Admin Editors',
      status: 'ACTIVE',
      timezone: 'Asia/Dubai',
      currency: 'AED',
    },
  });
  tenantId = tenant.id;
  await prisma.organizationSetting.create({
    data: {
      tenantId,
      mfaRequired: false,
      passwordPolicy: { minLength: 12, requireUpper: true, requireLower: true, requireNumber: true },
    },
  });

  adminCookie = await member('cfgadmin', [
    ['settings', 'VIEW'],
    ['settings', 'MANAGE_CONFIGURATION'],
  ]);
  viewerCookie = await member('viewer', [['settings', 'VIEW']]);
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('company profile', () => {
  it('can be changed — the whole point of 4.4', async () => {
    const res = await patch(
      settingsPatch,
      at('company').path,
      {
        displayName: 'Rebranded Co',
        companyEmail: 'HELLO@Rebranded.test',
        companyAddress: 'Level 4, Somewhere',
      },
      adminCookie,
      at('company').params,
    );

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Rebranded Co');
    // Normalised on write, not just on read.
    expect(res.body.companyEmail).toBe('hello@rebranded.test');

    const row = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(row!.displayName).toBe('Rebranded Co');
    expect((row!.address as { formatted?: string }).formatted).toBe('Level 4, Somewhere');
  });

  it('rejects a malformed value rather than storing it', async () => {
    const res = await patch(
      settingsPatch,
      at('company').path,
      { companyEmail: 'not-an-email' },
      adminCookie,
      at('company').params,
    );
    expect(res.status).toBe(422);
  });

  it('refuses someone who may read settings but not configure them', async () => {
    const res = await patch(
      settingsPatch,
      at('company').path,
      { displayName: 'Hijacked' },
      viewerCookie,
      at('company').params,
    );
    expect(res.status).toBe(403);
    expect((await prisma.tenant.findUnique({ where: { id: tenantId } }))!.displayName).not.toBe('Hijacked');
  });
});

describe('security', () => {
  it('turns mandatory two-factor on', async () => {
    // Safe to expose only because P1-3 gives an unenrolled user an enrolment
    // grant at login. Before that, this toggle locked out the whole company.
    const res = await patch(
      settingsPatch,
      at('security').path,
      { mfaRequired: true },
      adminCookie,
      at('security').params,
    );

    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect((await prisma.organizationSetting.findUnique({ where: { tenantId } }))!.mfaRequired).toBe(true);
  });

  it('changes the password policy', async () => {
    const res = await patch(
      settingsPatch,
      at('security').path,
      {
        passwordPolicy: {
          minLength: 16,
          requireUpper: true,
          requireLower: true,
          requireNumber: true,
          requireSymbol: true,
        },
      },
      adminCookie,
      at('security').params,
    );

    expect(res.status).toBe(200);
    const stored = (await prisma.organizationSetting.findUnique({ where: { tenantId } }))!.passwordPolicy as Record<
      string,
      unknown
    >;
    expect(stored.minLength).toBe(16);
    expect(stored.requireSymbol).toBe(true);
  });

  it('refuses a policy weaker than the floor', async () => {
    const res = await patch(
      settingsPatch,
      at('security').path,
      {
        passwordPolicy: { minLength: 4, requireUpper: false, requireLower: false, requireNumber: false },
      },
      adminCookie,
      at('security').params,
    );
    expect(res.status).toBe(422);
  });
});

describe('what a workspace may not change about itself', () => {
  it('has no endpoint for modules or subscription', async () => {
    // Entitlement is meaningless if a workspace can grant itself a module.
    // The section enum does not admit them, so this is a validation refusal
    // rather than a permission one — there is nothing there to reach.
    for (const section of ['modules', 'subscription']) {
      const res = await patch(
        settingsPatch,
        at(section).path,
        { planCode: 'enterprise' },
        adminCookie,
        at(section).params,
      );
      expect(res.status).toBe(422);
    }
  });

  it('leaves the entitlements untouched after such an attempt', async () => {
    const before = await prisma.moduleEntitlement.count({ where: { tenantId } });
    await patch(
      settingsPatch,
      at('modules').path,
      { module: 'SALES', state: 'ACTIVE' },
      adminCookie,
      at('modules').params,
    );
    expect(await prisma.moduleEntitlement.count({ where: { tenantId } })).toBe(before);
  });
});
