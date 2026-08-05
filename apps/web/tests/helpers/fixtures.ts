/**
 * Real fixtures. Every id below comes back from Postgres — nothing is invented.
 *
 * The previous version of this file fabricated its return values (leadCount: 0,
 * empty leadIds, stubbed drainExport/captureWebhook), so the tenant-isolation
 * suite asserted against data that never existed and proved nothing.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { createSessionToken } from './session';

export interface TenantFixture {
  tenantId: string;
  slug: string;
  userId: string;
  /** Cookie header value carrying a real, active session for this tenant's admin. */
  cookie: string;
  leadCount: number;
  leadIds: string[];
  stageId: string;
}

export interface Fixture {
  a: TenantFixture;
  b: TenantFixture;
  cleanup: () => Promise<void>;
}

const ALL_ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'ASSIGN', 'EXPORT'] as const;
const MODULES = ['leads', 'calls', 'events', 'campaigns', 'accounts', 'contacts', 'opportunities', 'tasks'] as const;

/** An admin role holding every permission at ORGANIZATION scope. */
async function createAdminRole(tenantId: string, suffix: string) {
  const role = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Test Administrator', rank: 0, defaultScope: 'ORGANIZATION', isSystem: true },
  });

  for (const module of MODULES) {
    for (const action of ALL_ACTIONS) {
      const permission = await prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: {},
        create: { module, action },
      });
      await prisma.rolePermission.create({
        data: { tenantId, roleId: role.id, permissionId: permission.id, scope: 'ORGANIZATION' },
      });
    }
  }
  return role;
}

async function createTenant(label: string, suffix: string, leadCount: number): Promise<TenantFixture> {
  const slug = `${label}-${suffix}`;
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: `${label} LLC`, displayName: label },
  });

  // Both modules on, so a refusal below is isolation rather than entitlement.
  // Entitlement gating is covered separately by the acceptance scenario.
  await prisma.moduleEntitlement.createMany({
    data: [
      { tenantId: tenant.id, module: 'HRMS', state: 'ACTIVE' },
      { tenantId: tenant.id, module: 'SALES', state: 'ACTIVE' },
    ],
  });

  const role = await createAdminRole(tenant.id, suffix);
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `admin@${slug}.test`,
      fullName: `${label} Administrator`,
      roleId: role.id,
      status: 'ACTIVE',
    },
  });

  const stage = await prisma.leadStage.create({
    data: { tenantId: tenant.id, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });

  const leadIds: string[] = [];
  for (let i = 0; i < leadCount; i++) {
    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        reference: `${slug.toUpperCase()}-${i}`,
        fullName: `${label} Lead ${i}`,
        stageId: stage.id,
        ownerId: user.id,
      },
    });
    leadIds.push(lead.id);
  }

  return {
    tenantId: tenant.id,
    slug,
    userId: user.id,
    cookie: await createSessionToken(tenant.id, user.id),
    leadCount,
    leadIds,
    stageId: stage.id,
  };
}

export interface Member {
  id: string;
  cookie: string;
  leadId: string;
}

export interface Hierarchy {
  tenantId: string;
  /** Reps, each owning exactly one lead. */
  repA1: Member; repA2: Member; repSubTeam: Member; repB1: Member; repOtherRegion: Member;
  /** Managers at each visibility scope. */
  teamManagerA: Member; branchManager: Member; regionalManager: Member; director: Member;
  totalLeads: number;
  cleanup: () => Promise<void>;
}

/**
 * One workspace shaped like a real sales org, so visibility scopes have
 * something to actually resolve against:
 *
 *   Region 1 ── Branch 1 ── Team 1 ────── repA1, repA2, teamManagerA
 *   │           │          └ Team 1a ─── repSubTeam
 *   │           └ Branch 2 ─ Team 2 ──── repB1
 *   Region 2 ── Branch 3 ─────────────── repOtherRegion
 *
 * branchManager sits in Branch 1, regionalManager in Region 1, director above all.
 */
export async function seedHierarchy(): Promise<Hierarchy> {
  const suffix = randomBytes(4).toString('hex');
  const tenant = await prisma.tenant.create({
    data: { slug: `hierarchy-${suffix}`, legalName: 'Hierarchy LLC', displayName: 'Hierarchy' },
  });
  const tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const region1 = await prisma.region.create({ data: { tenantId, name: 'Region 1', code: `R1-${suffix}` } });
  const region2 = await prisma.region.create({ data: { tenantId, name: 'Region 2', code: `R2-${suffix}` } });
  const branch1 = await prisma.branch.create({ data: { tenantId, name: 'Branch 1', code: `B1-${suffix}`, regionId: region1.id } });
  const branch2 = await prisma.branch.create({ data: { tenantId, name: 'Branch 2', code: `B2-${suffix}`, regionId: region1.id } });
  const branch3 = await prisma.branch.create({ data: { tenantId, name: 'Branch 3', code: `B3-${suffix}`, regionId: region2.id } });
  const team1 = await prisma.team.create({ data: { tenantId, name: 'Team 1', code: `T1-${suffix}`, branchId: branch1.id } });
  const team1a = await prisma.team.create({ data: { tenantId, name: 'Team 1a', code: `T1A-${suffix}`, branchId: branch1.id, parentTeamId: team1.id } });
  const team2 = await prisma.team.create({ data: { tenantId, name: 'Team 2', code: `T2-${suffix}`, branchId: branch2.id } });

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });

  /** A role granting every lead action at exactly `scope`. */
  async function roleAt(key: string, scope: 'OWN' | 'TEAM' | 'BRANCH' | 'REGION' | 'ORGANIZATION', rank: number) {
    const role = await prisma.role.create({
      data: { tenantId, key: `${key}-${suffix}`, name: key, rank, defaultScope: scope },
    });
    for (const action of ALL_ACTIONS) {
      // Reps may not ASSIGN: claiming another owner's record is the escalation
      // the scope tests probe for.
      if (action === 'ASSIGN' && scope === 'OWN') continue;
      const permission = await prisma.permission.upsert({
        where: { module_action: { module: 'leads', action } },
        update: {},
        create: { module: 'leads', action },
      });
      await prisma.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: permission.id, scope } });
    }
    return role;
  }

  const repRole = await roleAt('rep', 'OWN', 60);
  const teamRole = await roleAt('team_manager', 'TEAM', 50);
  const branchRole = await roleAt('branch_manager', 'BRANCH', 40);
  const regionRole = await roleAt('regional_manager', 'REGION', 30);
  const directorRole = await roleAt('director', 'ORGANIZATION', 20);

  async function member(
    name: string,
    roleId: string,
    placement: { branchId?: string; regionId?: string; teamId?: string; isManager?: boolean },
  ): Promise<Member> {
    const user = await prisma.user.create({
      data: {
        tenantId, roleId, status: 'ACTIVE',
        email: `${name}-${suffix}@hierarchy.test`,
        fullName: name,
        branchId: placement.branchId ?? null,
        regionId: placement.regionId ?? null,
      },
    });
    if (placement.teamId) {
      await prisma.userTeam.create({
        data: { tenantId, userId: user.id, teamId: placement.teamId, isManager: placement.isManager ?? false },
      });
    }
    const lead = await prisma.lead.create({
      data: { tenantId, reference: `${name}-${suffix}`, fullName: `${name} lead`, stageId: stage.id, ownerId: user.id },
    });
    return { id: user.id, cookie: await createSessionToken(tenantId, user.id), leadId: lead.id };
  }

  const hierarchy = {
    tenantId,
    repA1: await member('repA1', repRole.id, { branchId: branch1.id, regionId: region1.id, teamId: team1.id }),
    repA2: await member('repA2', repRole.id, { branchId: branch1.id, regionId: region1.id, teamId: team1.id }),
    repSubTeam: await member('repSubTeam', repRole.id, { branchId: branch1.id, regionId: region1.id, teamId: team1a.id }),
    repB1: await member('repB1', repRole.id, { branchId: branch2.id, regionId: region1.id, teamId: team2.id }),
    repOtherRegion: await member('repOtherRegion', repRole.id, { branchId: branch3.id, regionId: region2.id }),
    teamManagerA: await member('teamManagerA', teamRole.id, { branchId: branch1.id, regionId: region1.id, teamId: team1.id, isManager: true }),
    branchManager: await member('branchManager', branchRole.id, { branchId: branch1.id, regionId: region1.id }),
    regionalManager: await member('regionalManager', regionRole.id, { branchId: branch1.id, regionId: region1.id }),
    director: await member('director', directorRole.id, {}),
  };

  return {
    ...hierarchy,
    totalLeads: 9,
    cleanup: async () => { await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {}); },
  };
}

/**
 * Two fully-populated workspaces standing in for two customers of the platform.
 * Tenant A holds more leads than B so a leaked row is detectable by count alone.
 */
export async function seedTwoTenants(): Promise<Fixture> {
  const suffix = randomBytes(4).toString('hex');
  const a = await createTenant('manath', suffix, 5);
  const b = await createTenant('leadersfort', suffix, 3);

  return {
    a,
    b,
    cleanup: async () => {
      for (const id of [a.tenantId, b.tenantId]) {
        await prisma.tenant.delete({ where: { id } }).catch(() => {});
      }
    },
  };
}
