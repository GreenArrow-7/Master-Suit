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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { textDirection } from '@/lib/locale';
import { PATCH as settingsPatch } from '@/app/api/v1/workspaces/[workspaceSlug]/settings/[section]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { patch } from '../helpers/request';
import type { Grants } from '../helpers/fixtures';

/** The deployment's windows, swapped per case (M18-11); everything else in env is real. */
const deployment: { audit?: number; punch?: number; ai?: number } = {};
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get AUDIT_LOG_RETENTION_DAYS() {
        return deployment.audit;
      },
      get ATTENDANCE_PUNCH_RETENTION_DAYS() {
        return deployment.punch;
      },
      get AI_EVENT_RETENTION_DAYS() {
        return deployment.ai;
      },
    },
  };
});

const suffix = randomBytes(4).toString('hex');
const slug = `admined-${suffix}`;

let tenantId = '';
let adminCookie = '';
let viewerCookie = '';

async function member(label: string, grants: Grants) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, grants);
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

  it('sets the brand colours the public pages draw with (M18-09)', async () => {
    const res = await patch(
      settingsPatch,
      at('company').path,
      { primaryColor: '#7a1f3d', accentColor: '#0E7C66' },
      adminCookie,
      at('company').params,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ primaryColor: '#7A1F3D', accentColor: '#0E7C66' });
    expect(await prisma.organizationSetting.findUnique({ where: { tenantId } })).toMatchObject({
      primaryColor: '#7A1F3D',
      accentColor: '#0E7C66',
    });
    for (const primaryColor of ['red', '#12345', 'url(x)']) {
      const bad = await patch(settingsPatch, at('company').path, { primaryColor }, adminCookie, at('company').params);
      expect(bad.status, primaryColor).toBe(422);
    }
  });

  it('stores the brokerage ORN on the workspace settings, and clears it when emptied (M12-04)', async () => {
    const save = (reraOrn: string) =>
      patch(settingsPatch, at('company').path, { reraOrn }, adminCookie, at('company').params);
    expect((await save('ORN 12345')).status).toBe(200);
    const orn = async () =>
      (await prisma.organizationSetting.findUnique({ where: { tenantId }, select: { reraOrn: true } }))?.reraOrn;
    expect(await orn()).toBe('ORN 12345');
    expect((await save('')).status).toBe(200);
    expect(await orn()).toBeNull();
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

  it('sets the workspace language; Arabic lays the workspace out right to left (NFR-09)', async () => {
    const res = await patch(settingsPatch, at('company').path, { locale: 'ar-AE' }, adminCookie, at('company').params);
    expect(res.status).toBe(200);
    expect(res.body.locale).toBe('ar-AE');
    const setting = await prisma.organizationSetting.findUniqueOrThrow({ where: { tenantId } });
    expect(setting.defaultLocale).toBe('ar-AE');
    expect(textDirection(setting.defaultLocale)).toBe('rtl');
    expect(textDirection('en-AE')).toBe('ltr');

    const refused = await patch(
      settingsPatch,
      at('company').path,
      { locale: 'xx-YY' },
      adminCookie,
      at('company').params,
    );
    expect(refused.status).toBe(422);
    await patch(settingsPatch, at('company').path, { locale: 'en-AE' }, adminCookie, at('company').params);
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

describe('data retention (M18-11)', () => {
  const save = (body: Record<string, unknown>, as = adminCookie) =>
    patch(settingsPatch, at('retention').path, body, as, at('retention').params);
  const stored = async () =>
    (await prisma.organizationSetting.findUniqueOrThrow({ where: { tenantId } })).retentionPolicy;

  it('keeps a class longer than the deployment and reports the window the sweep applies', async () => {
    deployment.audit = 2555;
    const res = await save({ auditLog: '3650', attendancePunch: '', aiEvent: '' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await stored()).toEqual({ auditLog: 3650 });
    expect(res.body.find((row: { key: string }) => row.key === 'auditLog')).toMatchObject({
      deployment: 2555,
      workspace: 3650,
      effective: 3650,
    });
  });

  it('refuses a window shorter than the deployment, and keeps what was stored', async () => {
    deployment.audit = 2555;
    const res = await save({ auditLog: 365 });
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ field: 'auditLog' });
    expect(await stored()).toEqual({ auditLog: 3650 });
  });

  it('clears a class back to the deployment when emptied', async () => {
    deployment.audit = 2555;
    expect((await save({ auditLog: '' })).status).toBe(200);
    expect(await stored()).toEqual({});
  });

  it('refuses someone who may read settings but not configure them', async () => {
    expect((await save({ auditLog: 4000 }, viewerCookie)).status).toBe(403);
    expect(await stored()).toEqual({});
  });

  it('saves another class while a value stored before the deployment set a longer window comes back unchanged', async () => {
    deployment.audit = undefined;
    expect((await save({ auditLog: 365 })).status).toBe(200);
    deployment.audit = 2555;
    // The form sends every field, so the stored 365 rides along with the change.
    const res = await save({ auditLog: '365', attendancePunch: '', aiEvent: '400' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await stored()).toEqual({ auditLog: 365, aiEvent: 400 });
    // A changed value below the deployment is still refused.
    expect((await save({ auditLog: 400 })).status).toBe(422);
  });

  it('keeps both of two saves of different classes sent at once', async () => {
    deployment.audit = 2555;
    expect((await save({ auditLog: '', attendancePunch: '', aiEvent: '' })).status).toBe(200);
    const results = await Promise.all([
      save({ auditLog: 3650 }),
      save({ attendancePunch: 900 }),
      save({ aiEvent: 500 }),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await stored()).toEqual({ auditLog: 3650, attendancePunch: 900, aiEvent: 500 });
  });
});
