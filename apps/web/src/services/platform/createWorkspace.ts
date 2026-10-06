import type { SubscriptionPlan } from '@prisma/client';
import { withPlatformTx } from '@/lib/db';
import { Conflict } from '@/lib/errors';
import type { ProductModuleKey } from '@/lib/modules/catalogue';
import { platformAudit } from '@/lib/security/audit';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { provisionLeadWork } from '@/services/platform/provisioning';

/**
 * A new workspace, complete: the tenant with its subscription, entitlements and
 * usage, the Company Administrator role holding the whole catalogue, the first
 * administrator (reusing their platform identity when the email already has
 * one), and each module's starting configuration — in one transaction.
 *
 * The platform portal's wizard and the self-serve sign-up both make workspaces
 * through this, so a workspace is the same whoever made it.
 */
export interface NewWorkspace {
  workspaceName: string;
  slug: string;
  legalName: string;
  displayName: string;
  industry?: string;
  companySize?: string;
  country: string;
  timezone: string;
  currency: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  logoUrl?: string;
  primaryAdminName: string;
  primaryAdminEmail: string;
  enabledModules: ProductModuleKey[];
  maxEmployees: number;
  maxUsers: number;
  maxStorageMb: number;
  trialStartDate?: Date | null;
  trialEndDate?: Date | null;
  status: 'ACTIVE' | 'SUSPENDED';
}

export async function createWorkspace(
  body: NewWorkspace,
  plan: SubscriptionPlan,
  /** The administrator's password, already hashed; ignored when the email already has an identity. */
  passwordHash: string,
  actor: Parameters<typeof platformAudit>[0],
) {
  const trialStartedAt = body.trialStartDate ?? null;
  const trialEndsAt = body.trialEndDate ?? null;
  const state = trialEndsAt && trialEndsAt > new Date() ? ('TRIAL' as const) : ('ACTIVE' as const);
  const adminEmail = body.primaryAdminEmail.trim().toLowerCase();

  return withPlatformTx(async (tx) => {
    const created = await tx.tenant.create({
      data: {
        workspaceName: body.workspaceName,
        slug: body.slug,
        legalName: body.legalName,
        displayName: body.displayName,
        industry: body.industry,
        companySize: body.companySize,
        country: body.country.toUpperCase(),
        timezone: body.timezone,
        currency: body.currency.toUpperCase(),
        companyEmail: body.companyEmail?.toLowerCase(),
        companyPhone: body.companyPhone,
        address: body.companyAddress ? { formatted: body.companyAddress } : {},
        logoUrl: body.logoUrl || null,
        status: body.status,
        planCode: plan.code,
        maxUsers: body.maxUsers,
        maxEmployees: body.maxEmployees,
        maxStorageMb: body.maxStorageMb,
        trialStartedAt,
        trialEndsAt,
        settings: { create: { defaultTimezone: body.timezone, defaultCurrency: body.currency.toUpperCase() } },
        subscription: {
          create: {
            planId: plan.id,
            state,
            trialEndsAt,
            modules: { create: body.enabledModules.map((module) => ({ module, state })) },
          },
        },
        moduleEntitlements: {
          create: body.enabledModules.map((module) => ({ module, state, endsAt: trialEndsAt })),
        },
        workspaceUsage: {
          create: [
            { metric: 'users', used: 1, limit: body.maxUsers },
            { metric: 'employees', used: 1, limit: body.maxEmployees },
            { metric: 'storage_mb', used: 0, limit: body.maxStorageMb },
          ],
        },
        hrLeaveTypes: body.enabledModules.includes('HRMS')
          ? {
              create: [
                { code: 'ANNUAL', name: 'Annual Leave', annualAllowance: 30, paid: true },
                { code: 'SICK', name: 'Sick Leave', annualAllowance: 15, paid: true, requiresDocument: true },
              ],
            }
          : undefined,
      },
      include: { subscription: { include: { plan: true } }, moduleEntitlements: true },
    });

    const permissionPairs = [
      ...[
        // HR, split into the authorities it actually contains (P1-8) rather
        // than one `hrms` permission that conferred all of them at once.
        'employee',
        'leave',
        'attendance',
        'hr_documents',
        'departments',
        'overtime',
        'shifts',
        'holidays',
        'work_locations',
        'hr_reports',
        // Retained so an upgraded workspace and a new one look the same, and
        // so the migration's backfill has a source to derive from.
        'hrms',
      ],
      ...['leads', 'opportunities', 'accounts', 'contacts', 'activities', 'tasks', 'calls', 'campaigns', 'reports'],
      ...['users', 'roles', 'settings', 'auditlogs', 'integrations'],
    ].flatMap((module) =>
      ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'MANAGE_USERS', 'MANAGE_CONFIGURATION'].map((action) => ({
        module,
        action,
      })),
    );
    // The approval and sensitive-read authorities exist only where they mean
    // something, so an administrator editing the matrix is not shown rows like
    // `leads:APPROVE` that nothing consults.
    permissionPairs.push(
      { module: 'leave', action: 'APPROVE' },
      { module: 'attendance', action: 'APPROVE' },
      { module: 'overtime', action: 'APPROVE' },
      { module: 'hr_documents', action: 'VIEW_SENSITIVE_FIELDS' },
    );
    // 144 sequential upserts — one network round trip each — inside a 5 s
    // interactive transaction. It measured a hair over the limit under any
    // concurrent load, so workspace provisioning failed intermittently with an
    // expired-transaction error and a bare 500. The upsert's `update` was empty,
    // so this is exactly equivalent in one round trip.
    await tx.permission.createMany({ data: permissionPairs as never, skipDuplicates: true });

    /**
     * Everything in the catalogue, not the list above.
     *
     * The list is a floor — it guarantees the baseline permissions exist in a
     * fresh database. Using it as the *grant* set meant a workspace created
     * through this wizard could only reach the modules somebody had
     * remembered to add here, and 36 of 61 modules had never been added:
     * projects, listings, visits, bookings, commissions, events, documents,
     * products, tickets, payroll, recruitment and the rest were simply
     * invisible in any new workspace.
     *
     * The migrations that shipped those modules backfill grants by deriving
     * from rows already in RolePermission, so they only ever helped workspaces
     * that already existed. A workspace created afterwards got the hardcoded
     * list and nothing else.
     *
     * This role is called Company Administrator and describes itself as full
     * administration inside the workspace. Granting it the catalogue is what
     * that sentence already claims, and it cannot drift again the next time a
     * module ships.
     */
    const permissions = await tx.permission.findMany({ select: { id: true } });
    const adminRole = await tx.role.create({
      data: {
        tenantId: created.id,
        key: 'company_admin',
        name: 'Company Administrator',
        description: 'Full administration inside this workspace only.',
        isSystem: true,
        rank: 10,
        defaultScope: 'ORGANIZATION',
      },
    });
    await tx.rolePermission.createMany({
      data: permissions.map((permission) => ({
        tenantId: created.id,
        roleId: adminRole.id,
        permissionId: permission.id,
        granted: true,
        scope: 'ORGANIZATION',
      })),
    });
    const salesUser = await tx.user.create({
      data: {
        tenantId: created.id,
        email: adminEmail,
        emailVerifiedAt: new Date(),
        fullName: body.primaryAdminName,
        status: 'ACTIVE',
        roleId: adminRole.id,
        employeeCode: 'ADMIN-001',
        jobTitle: 'Company Administrator',
        timezone: body.timezone,
      },
    });
    // An existing identity keeps its own password.
    //
    // This was an upsert whose `update` branch silently omitted passwordHash,
    // so provisioning a workspace with an email that already existed — a
    // consultant administering two customers — produced an administrator who
    // could not sign in with the password the platform owner had just typed
    // and communicated. Say which of the two happened instead of guessing.
    const existingIdentity = await tx.platformUser.findUnique({
      where: { normalizedEmail: adminEmail },
      select: { id: true, deletedAt: true },
    });
    if (existingIdentity?.deletedAt) {
      throw Conflict('That email belongs to a deleted account. Restore it or use a different address.');
    }
    const reusedExistingIdentity = Boolean(existingIdentity);
    const platformUser = existingIdentity
      ? await tx.platformUser.update({
          where: { id: existingIdentity.id },
          data: { fullName: body.primaryAdminName, status: 'ACTIVE' },
        })
      : await tx.platformUser.create({
          data: {
            email: adminEmail,
            normalizedEmail: adminEmail,
            fullName: body.primaryAdminName,
            passwordHash,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
          },
        });
    const membership = await tx.workspaceMembership.create({
      data: {
        tenantId: created.id,
        platformUserId: platformUser.id,
        salesUserId: salesUser.id,
        status: 'ACTIVE',
        isPrimaryAdmin: true,
        roleSnapshot: 'company_admin',
        joinedAt: new Date(),
      },
    });
    await tx.membershipRole.create({
      data: { tenantId: created.id, membershipId: membership.id, roleId: adminRole.id },
    });
    await tx.employeeProfile.create({
      data: {
        tenantId: created.id,
        membershipId: membership.id,
        employeeNumber: 'ADMIN-001',
        designation: 'Company Administrator',
        employmentStatus: 'ACTIVE',
        joinedOn: new Date(),
      },
    });
    // Lead stages, activity and task types: every module that works leads needs them.
    if (body.enabledModules.some((module) => (LEAD_MODULES as readonly string[]).includes(module))) {
      await provisionLeadWork(tx, created.id);
    }
    if (body.enabledModules.includes('SALES')) {
      /**
       * The default opportunity pipeline and its stages.
       *
       * `createOpportunity` resolves the tenant's default pipeline and throws
       * `NotFound('Pipeline')` when there is none, so without this a newly
       * provisioned workspace cannot create an opportunity at all — the
       * central object of the CRM — and the failure surfaces to the user as a
       * bare 404 on save. Like the type tables (`provisionLeadWork`), a pipeline
       * existed only in the demo seed, so this was invisible in the demo tenant
       * and broken for every real customer.
       *
       * Mirrors the seed's stage set, including the probability each stage
       * carries: forecasting multiplies amount by stage probability, so a
       * provisioned workspace that omitted them would report every open
       * opportunity as worth zero.
       */
      const pipeline = await tx.pipeline.create({
        data: { tenantId: created.id, key: 'sales', name: 'Sales Pipeline', isDefault: true },
      });
      await tx.pipelineStage.createMany({
        // The six stages `prisma/seed/crm.ts` seeds for the demo workspace.
        data: (
          [
            ['qualification', 'Qualification', 'OPEN', '#3D6BC7', 10],
            ['needs_analysis', 'Needs Analysis', 'OPEN', '#2447C7', 25],
            ['proposal', 'Proposal', 'OPEN', '#8A5A1A', 50],
            ['negotiation', 'Negotiation', 'OPEN', '#6E4B12', 70],
            ['closed_won', 'Closed Won', 'CONVERSION', '#0B6E5A', 100],
            ['closed_lost', 'Closed Lost', 'TERMINAL_NEGATIVE', '#A8232B', 0],
          ] as const
        ).map(([key, name, category, color, probability], position) => ({
          tenantId: created.id,
          pipelineId: pipeline.id,
          key,
          name,
          category,
          color,
          position,
          probability,
        })),
      });
    }
    await platformAudit(
      actor,
      {
        tenantId: created.id,
        event: 'WORKSPACE_CREATED',
        objectType: 'workspace',
        objectId: created.id,
        metadata: {
          slug: created.slug,
          planCode: plan.code,
          modules: body.enabledModules,
          primaryAdmin: adminEmail,
          reusedExistingIdentity,
        },
      },
      tx,
    );
    return { created, reusedExistingIdentity };
  });
}
