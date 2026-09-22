/**
 * The standing platform-wide CRM monitoring entitlement.
 *
 * The journey spec next door walks the whole monitoring path with per-workspace
 * grants. This one holds the property that entitlement adds and nothing else:
 * one named identity sees every ACTIVE workspace, including workspaces created
 * after the grant was written, and loses them the moment it is revoked or
 * expires — while an identity without it keeps exactly the scope it had.
 *
 * Rows are written directly rather than through the issuing route, because what
 * is under test is what the *authorisation layer* concludes from a row. How a
 * row comes to exist is the route's business and is covered where the route is.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import {
  MAX_COVERAGE_MINUTES,
  MAX_CRM_MONITORING_MINUTES,
  activeCoverage,
  activeCrmMonitoring,
  authorizedTenantIds,
  coverageWindow,
  mayEnterWorkspace,
} from '@/lib/auth/platform-access';
import { MONITORING_ACTIONS, MONITORING_MODULES } from '@/lib/auth/support-actor';

const suffix = randomBytes(4).toString('hex');
const ids: { entitled: string; plain: string; tenants: string[] } = { entitled: '', plain: '', tenants: [] };

const makeTenant = async (name: string) => {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `crmmon-${name}-${suffix}`,
      displayName: `CRM Mon ${name} ${suffix}`,
      legalName: `CRM Mon ${name} ${suffix} Ltd`,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  ids.tenants.push(tenant.id);
  return tenant.id;
};

const makeIdentity = async (label: string) => {
  const identity = await prisma.platformUser.create({
    data: {
      email: `crmmon-${label}-${suffix}@example.invalid`,
      normalizedEmail: `crmmon-${label}-${suffix}@example.invalid`,
      fullName: `CRM Monitor ${label}`,
      platformRole: 'SUPPORT',
      status: 'ACTIVE',
      passwordHash: 'not-used-by-this-spec',
    },
    select: { id: true },
  });
  return identity.id;
};

const grant = (platformUserId: string, kind: 'OPERATIONAL' | 'CRM_MONITORING', minutes: number) =>
  withPlatformTx((tx) =>
    tx.platformCoverageGrant.create({
      data: {
        platformUserId,
        kind,
        reason: `Spec fixture for ${kind} coverage, stated at length because the issuer requires it.`,
        expiresAt: new Date(Date.now() + minutes * 60_000),
      },
      select: { id: true },
    }),
  );

beforeAll(async () => {
  ids.entitled = await makeIdentity('entitled');
  ids.plain = await makeIdentity('plain');
  await makeTenant('alpha');
  await makeTenant('beta');
  await grant(ids.entitled, 'CRM_MONITORING', 60 * 24 * 30);
});

afterAll(async () => {
  await withPlatformTx((tx) =>
    tx.platformCoverageGrant.deleteMany({ where: { platformUserId: { in: [ids.entitled, ids.plain] } } }),
  );
  await prisma.tenant.deleteMany({ where: { id: { in: ids.tenants } } });
  await prisma.platformUser.deleteMany({ where: { id: { in: [ids.entitled, ids.plain] } } });
});

describe('platform-wide CRM monitoring', () => {
  it('puts every workspace in scope without any per-workspace grant', async () => {
    // null is the layer's way of saying "all of them" — not a list captured now.
    expect(await authorizedTenantIds(ids.entitled)).toBeNull();
  });

  it('covers a workspace created after the entitlement was issued', async () => {
    const later = await makeTenant('created-later');
    expect(await authorizedTenantIds(ids.entitled)).toBeNull();
    expect(await mayEnterWorkspace(ids.entitled, later)).toBe(true);
  });

  it('leaves an identity without the entitlement with no workspaces at all', async () => {
    expect(await authorizedTenantIds(ids.plain)).toEqual([]);
    expect(await mayEnterWorkspace(ids.plain, ids.tenants[0])).toBe(false);
  });

  it('is reported as its own kind, distinct from operational coverage', async () => {
    const entitlement = await activeCrmMonitoring(ids.entitled);
    expect(entitlement?.kind).toBe('CRM_MONITORING');
    // An operational grant is not a CRM monitoring entitlement, even though it
    // also admits its holder everywhere.
    await grant(ids.plain, 'OPERATIONAL', 60);
    expect(await activeCrmMonitoring(ids.plain)).toBeNull();
    expect((await activeCoverage(ids.plain))?.kind).toBe('OPERATIONAL');
    expect(await authorizedTenantIds(ids.plain)).toBeNull();
  });

  it('never implies access to recordings, transcripts or documents', async () => {
    expect((await activeCrmMonitoring(ids.entitled))?.sensitive).toBe(false);
  });

  it('ends immediately on revocation, without waiting for a session to expire', async () => {
    const revokable = await makeIdentity('revokable');
    await grant(revokable, 'CRM_MONITORING', 60 * 24);
    expect(await authorizedTenantIds(revokable)).toBeNull();

    await withPlatformTx((tx) =>
      tx.platformCoverageGrant.updateMany({
        where: { platformUserId: revokable, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'spec' },
      }),
    );

    expect(await activeCrmMonitoring(revokable)).toBeNull();
    expect(await authorizedTenantIds(revokable)).toEqual([]);
    expect(await mayEnterWorkspace(revokable, ids.tenants[0])).toBe(false);

    await withPlatformTx((tx) => tx.platformCoverageGrant.deleteMany({ where: { platformUserId: revokable } }));
    await prisma.platformUser.deleteMany({ where: { id: revokable } });
  });

  it('expires on its own, read at query time rather than by a sweeper', async () => {
    const lapsed = await makeIdentity('lapsed');
    await withPlatformTx((tx) =>
      tx.platformCoverageGrant.create({
        data: {
          platformUserId: lapsed,
          kind: 'CRM_MONITORING',
          reason: 'A grant whose window closed an hour ago, written long enough to pass the reason check.',
          expiresAt: new Date(Date.now() - 60 * 60_000),
        },
      }),
    );
    expect(await activeCrmMonitoring(lapsed)).toBeNull();
    expect(await authorizedTenantIds(lapsed)).toEqual([]);

    await withPlatformTx((tx) => tx.platformCoverageGrant.deleteMany({ where: { platformUserId: lapsed } }));
    await prisma.platformUser.deleteMany({ where: { id: lapsed } });
  });

  it('is bounded: longer than operational coverage, and never unlimited', () => {
    expect(coverageWindow('CRM_MONITORING').ceiling).toBe(MAX_CRM_MONITORING_MINUTES);
    expect(coverageWindow('OPERATIONAL').ceiling).toBe(MAX_COVERAGE_MINUTES);
    expect(MAX_CRM_MONITORING_MINUTES).toBeGreaterThan(MAX_COVERAGE_MINUTES);
    expect(Number.isFinite(MAX_CRM_MONITORING_MINUTES)).toBe(true);
    expect(coverageWindow('CRM_MONITORING').fallback).toBeLessThanOrEqual(MAX_CRM_MONITORING_MINUTES);
  });

  it('does not let the Sales layout ask a question that refuses monitoring outright', async () => {
    /**
     * The layout gates the SALES module for every `/sales/*` screen. It used to
     * ask for `SELF_SERVICE`, which `assertPageAccess` refuses for a monitoring
     * session by design — so every CRM screen threw, was caught, and redirected
     * to the dashboard, which refuses a monitoring actor too. An entitlement
     * gate must ask about the entitlement.
     */
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/app/(workspace)/[workspaceSlug]/sales/layout.tsx', 'utf8');
    // The prose above the gate may name SELF_SERVICE — explaining why it is not
    // used is the point of it. What must not come back is the call.
    expect(source).not.toMatch(/permission:\s*SELF_SERVICE/);
    expect(source).toContain("requestWorkspace(ctx, workspaceSlug, 'SALES')");
  });

  it('widens which workspaces are visible, never what may be done in one', () => {
    // The entitlement changes scope only. Authority stays where it was: read,
    // CRM modules, and nothing that touches people, pay or credentials.
    expect([...MONITORING_ACTIONS]).toEqual(['VIEW']);
    for (const forbidden of ['employee', 'payroll', 'documents', 'roles', 'users', 'billing', 'integrations']) {
      expect(MONITORING_MODULES.has(forbidden)).toBe(false);
    }
    for (const allowed of ['leads', 'calls', 'activities', 'tasks', 'visits']) {
      expect(MONITORING_MODULES.has(allowed)).toBe(true);
    }
  });
});
