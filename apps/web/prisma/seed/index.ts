/**
 * Master Suite — demo workspace seed.
 *
 * Deterministic in its *shape*: the same SEED_KEY reproduces the same tenants and
 * records, so screenshots, tests and bug reports refer to the same rows. The
 * passwords are not deterministic — see the guard below.
 *
 *   ALLOW_DEMO_SEED=yes npm run db:seed
 *   ALLOW_DEMO_SEED=yes npm run db:seed -- --reset     drop and rebuild
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ROLES, A, R, B, T, O, type RoleSpec } from './roles';
import { hash } from '@node-rs/argon2';

/**
 * Two independent gates, because this script creates dozens of ACTIVE,
 * email-verified logins. Pointed at a production DATABASE_URL it is a mass
 * account-provisioning tool, and it used to run on nothing but an npm script
 * name. NODE_ENV alone is not enough — staging and production frequently share
 * a NODE_ENV — so the operator has to say yes explicitly as well.
 */
if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed demo data: NODE_ENV is production.');
}
if (process.env.ALLOW_DEMO_SEED !== 'yes') {
  throw new Error(
    'Refusing to seed demo data.\n' +
      '  This creates dozens of active logins. Confirm the target database is disposable, then:\n' +
      '    ALLOW_DEMO_SEED=yes npm run db:seed\n' +
      `  Current DATABASE_URL host: ${safeHost(process.env.DATABASE_URL)}`,
  );
}

/**
 * Provisioning, so it connects as the migration role like `prisma migrate` does.
 *
 * This client has no tenant-guard extension, so nothing sets `app.tenant_id` for
 * it; as the NOBYPASSRLS application role every insert would fail its WITH CHECK.
 * Seeding creates the tenants in the first place — it is control-plane work.
 */
const seedUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString: seedUrl! });
const db = new PrismaClient({ adapter });

const SEED_KEY = process.env.SEED_KEY ?? 'meridian-2026';
const RESET = process.argv.includes('--reset');

/**
 * Generated per run and printed once, never committed. The previous value was a
 * constant in this file, so every deployment that had ever run the seed shared
 * one publicly-known password across every demo account.
 */
const DEMO_PASSWORD = `${randomBytes(9).toString('base64url')}-${randomBytes(3).toString('hex').toUpperCase()}`;

/** Host only — a connection string carries the password. */
function safeHost(url: string | undefined): string {
  if (!url) return '(DATABASE_URL is not set)';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(unparseable)';
  }
}

/** The primary demo workspace. One place, so the whole seed follows it. */
const DEMO_WORKSPACE = {
  slug: 'manath-homes',
  legalName: 'Manath Homes LLC',
  displayName: 'Manath Homes',
  primaryDomain: 'manathhomes.ae',
  employeePrefix: 'MH',
};

/** A second workspace, so cross-workspace isolation is visible in the UI. */
const SECOND_WORKSPACE = {
  slug: 'leadersfort',
  legalName: 'Leadersfort LLC',
  displayName: 'Leadersfort',
  adminEmail: 'admin@leadersfort.com',
  planCode: 'hrms',
  modules: ['HRMS'] as const,
};

// ── deterministic PRNG (mulberry32) ─────────────────────────────────────────
let state = [...SEED_KEY].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
function rnd(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const chance = (p: number) => rnd() < p;

/** Working-hours curve: Sun–Thu, 09:00–19:00 Gulf time, lull at 13:00. Uniform
 *  random timestamps look synthetic and hide bugs in business-hours SLA maths. */
function businessDate(daysBack: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - int(0, daysBack));
  while (d.getDay() === 5 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  let hour = int(9, 18);
  if (hour === 13 && chance(0.6)) hour = int(14, 17);
  d.setHours(hour, int(0, 59), int(0, 59), 0);
  return d;
}

// ── name pools: a Dubai brokerage, not "John Doe" ───────────────────────────
const FIRST = [
  'Amina',
  'Dhruv',
  'Sofia',
  'Joel',
  'Karim',
  'Liza',
  'Rashid',
  'Priya',
  'Omar',
  'Mariam',
  'Anton',
  'Nadia',
  'Faisal',
  'Reem',
  'Vikram',
  'Elena',
  'Tariq',
  'Sana',
  'Marco',
  'Ayesha',
  'Hamdan',
  'Ritika',
  'Youssef',
  'Clara',
  'Bilal',
  'Noor',
  'Rohan',
  'Layla',
  'Stefan',
  'Zainab',
];
const LAST = [
  'Al Rashid',
  'Menon',
  'Marchetti',
  'Fernandes',
  'Haddad',
  'Gonzales',
  'Al Suwaidi',
  'Nair',
  'Khalifa',
  'Al Zaabi',
  'Novak',
  'Karim',
  'Al Mansoori',
  'Iyer',
  'Petrova',
  'Siddiqui',
  'Rossi',
  'Bhatt',
  'Okafor',
  'Al Hashimi',
  'Dcruz',
  'Farooq',
  'Lindqvist',
  'Mehta',
  'Barakat',
  'Silva',
  'Chowdhury',
  'Kovac',
  'Ahmadi',
  'Pereira',
];
const COMPANIES = [
  'Harbour Line Holdings',
  'Zenith Capital FZE',
  'Cedar & Fern Trading',
  'Northbay Logistics',
  'Almasa Group',
  'Vector Health',
  'Bluecrest Partners',
  'Sandline Ventures',
  'Meraki Interiors',
  'Oryx Industrial',
  'Silverpoint Advisory',
  'Dune & Delta',
  'Kite Marine Services',
  'Falcon Ridge Energy',
  'Tessellate Studio',
];
const INDUSTRIES = [
  'Real Estate',
  'Financial Services',
  'Logistics',
  'Healthcare',
  'Hospitality',
  'Construction',
  'Technology',
  'Retail',
  'Energy',
  'Professional Services',
];
const CITIES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah'];

const email = (f: string, l: string, n: number) =>
  `${f.toLowerCase().replace(/[^a-z]/g, '')}.${l.toLowerCase().replace(/[^a-z]/g, '')}${n > 0 ? n : ''}@example.com`;
const phone = () => `+9715${pick(['0', '2', '4', '5', '6'])}${String(int(1000000, 9999999))}`;

// ── permission catalogue ────────────────────────────────────────────────────
const MODULES = [
  'leads',
  'opportunities',
  'accounts',
  'contacts',
  'activities',
  'tasks',
  'documents',
  'tickets',
  'products',
  'fieldsales',
  'campaigns',
  'calls',
  'events',
  'lists',
  'forms',
  'landingpages',
  'communications',
  'automation',
  'distribution',
  'sla',
  'reports',
  'dashboards',
  'smartviews',
  'users',
  'roles',
  'settings',
  'integrations',
  'apikeys',
  'auditlogs',
  'imports',
  'exports',
] as const;

const RECORD_ACTIONS = [
  'VIEW',
  'CREATE',
  'EDIT',
  'DELETE',
  'EXPORT',
  'IMPORT',
  'ASSIGN',
  'REASSIGN',
  'BULK_UPDATE',
  'VIEW_SENSITIVE_FIELDS',
] as const;
const ADMIN_ACTIONS = [
  'VIEW',
  'MANAGE_CONFIGURATION',
  'MANAGE_USERS',
  'MANAGE_AUTOMATION',
  'ACCESS_API',
  'VIEW_REPORTS',
  'CREATE',
  'EDIT',
  'DELETE',
  'EXPORT',
] as const;

const RECORD_MODULES = new Set([
  'leads',
  'opportunities',
  'accounts',
  'contacts',
  'activities',
  'tasks',
  'documents',
  'tickets',
  'products',
  'fieldsales',
  'campaigns',
  'calls',
  'events',
]);

type Scope = 'NONE' | 'OWN' | 'TEAM' | 'BRANCH' | 'REGION' | 'ORGANIZATION';

// "calls" and "events" mirror each role's "leads" grants: whoever may work a lead may
// call it and invite it to an event, at the same scope. Roles granted '*' pick these up
// through the wildcard expansion instead. Keeps this seed in agreement with migration
// 20260805000000_sales_engagement_flow, which backfills the same mapping.
for (const spec of ROLES) {
  if (!spec.grants.leads) continue;
  spec.grants.calls = { ...spec.grants.leads };
  spec.grants.events = { ...spec.grants.leads };
}

const STAGES = [
  ['new', 'New', 'OPEN', '#5B6B85', true, 60],
  ['attempted', 'Attempted Contact', 'OPEN', '#6C7DA0', false, null],
  ['contacted', 'Contacted', 'OPEN', '#3D6BC7', false, null],
  ['interested', 'Interested', 'OPEN', '#2447C7', false, null],
  ['qualified', 'Qualified', 'OPEN', '#1E44B8', false, null],
  ['application_started', 'Application Started', 'OPEN', '#1B6FA8', false, null],
  ['documents_pending', 'Documents Pending', 'OPEN', '#A85A00', false, null],
  ['proposal_sent', 'Proposal Sent', 'OPEN', '#8A5A1A', false, null],
  ['negotiation', 'Negotiation', 'OPEN', '#6E4B12', false, null],
  ['converted', 'Converted', 'CONVERSION', '#0B6E5A', false, null],
  ['not_interested', 'Not Interested', 'TERMINAL_NEGATIVE', '#8A94A6', false, null],
  ['disqualified', 'Disqualified', 'TERMINAL_NEGATIVE', '#A8232B', false, null],
  ['duplicate', 'Duplicate', 'TERMINAL_JUNK', '#8A94A6', false, null],
  ['invalid', 'Invalid', 'TERMINAL_JUNK', '#6F7B8F', false, null],
] as const;

/** Shares from docs/06-SEED-PLAN.md §3 — not a uniform distribution. */
const STAGE_WEIGHTS: Record<string, number> = {
  new: 18,
  attempted: 12,
  contacted: 14,
  interested: 10,
  qualified: 9,
  application_started: 6,
  documents_pending: 5,
  proposal_sent: 5,
  negotiation: 4,
  converted: 7,
  not_interested: 5,
  disqualified: 3,
  duplicate: 1,
  invalid: 1,
};

const SOURCES: [string, number][] = [
  ['PUBLIC_FORM', 24],
  ['MARKETPLACE', 19],
  ['LANDING_PAGE', 11],
  ['AD_LEAD_FORM', 10],
  ['TELEPHONY', 9],
  ['MANUAL', 12],
  ['IMPORT', 7],
  ['API', 8],
];

function weighted<T extends string>(weights: Record<string, number> | [T, number][]): T {
  const pairs: [string, number][] = Array.isArray(weights) ? weights : Object.entries(weights);
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [k, w] of pairs) {
    r -= w;
    if (r <= 0) return k as T;
  }
  return pairs[0]![0] as T;
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seeding demo workspace (SEED_KEY=${SEED_KEY})…\n`);

  if (RESET) {
    const existing = await db.tenant.findUnique({ where: { slug: DEMO_WORKSPACE.slug } });
    if (existing) {
      console.log('  Removing the existing demo tenant…');
      const t = { tenantId: existing.id };
      // Child-first: tenantId is a plain column on most tables, so the Tenant
      // cascade does not reach them. Order matters where FKs do exist.
      await db.auditLog.deleteMany({ where: t });
      await db.leadScoreHistory.deleteMany({ where: t });
      await db.leadAssignmentHistory.deleteMany({ where: t });
      await db.leadStageHistory.deleteMany({ where: t });
      await db.leadCustomFieldValue.deleteMany({ where: t });
      await db.task.deleteMany({ where: t });
      await db.activity.deleteMany({ where: t });
      await db.communication.deleteMany({ where: t });
      await db.document.deleteMany({ where: t });
      await db.opportunity.deleteMany({ where: t });
      await db.lead.deleteMany({ where: t });
      await db.contact.deleteMany({ where: t });
      await db.account.deleteMany({ where: t });
      await db.duplicateRule.deleteMany({ where: t });
      await db.leadCustomFieldDefinition.deleteMany({ where: t });
      await db.leadStage.deleteMany({ where: t });
      await db.activityType.deleteMany({ where: t });
      await db.taskType.deleteMany({ where: t });
      await db.product.deleteMany({ where: t });
      await db.userTeam.deleteMany({ where: t });
      await db.rolePermission.deleteMany({ where: t });
      await db.tenant.delete({ where: { id: existing.id } }); // cascades users, teams, branches, regions, roles
      console.log('  Removed.');
    }
  }

  // 1. Permission catalogue (global, shared across tenants) ──────────────────
  const permissionPairs: { module: string; action: string }[] = [];
  for (const m of MODULES) {
    const actions = RECORD_MODULES.has(m) ? RECORD_ACTIONS : ADMIN_ACTIONS;
    for (const a of actions) permissionPairs.push({ module: m, action: a });
  }
  await db.permission.createMany({ data: permissionPairs as any, skipDuplicates: true });
  const permissions = await db.permission.findMany();
  const permIndex = new Map(permissions.map((p) => [`${p.module}:${p.action}`, p.id]));
  console.log(`  ${permissions.length} permissions`);

  // 2. Tenant ────────────────────────────────────────────────────────────────
  const tenant = await db.tenant.upsert({
    where: { slug: DEMO_WORKSPACE.slug },
    update: {},
    create: {
      slug: DEMO_WORKSPACE.slug,
      legalName: DEMO_WORKSPACE.legalName,
      displayName: DEMO_WORKSPACE.displayName,
      primaryDomain: DEMO_WORKSPACE.primaryDomain,
      dataRegion: 'me-central-1',
      settings: {
        create: {
          productName: DEMO_WORKSPACE.displayName,
          defaultTimezone: 'Asia/Dubai',
          defaultCurrency: 'AED',
          defaultLocale: 'en-AE',
          workingHours: { days: [0, 1, 2, 3, 4], start: '09:00', end: '19:00' },
          quietHours: { start: '21:00', end: '08:00' },
          passwordPolicy: {
            minLength: 12,
            requireUpper: true,
            requireLower: true,
            requireNumber: true,
            reuseWindow: 5,
          },
        },
      },
    },
  });
  const tenantId = tenant.id;
  const planSpecs = [
    { code: 'hrms', name: 'HRMS', modules: ['HRMS'] as const, seatLimit: 100, storageMb: 5120 },
    { code: 'sales', name: 'Sales', modules: ['SALES'] as const, seatLimit: 100, storageMb: 5120 },
    { code: 'business', name: 'Business', modules: ['HRMS', 'SALES'] as const, seatLimit: 250, storageMb: 20480 },
    { code: 'enterprise', name: 'Enterprise', modules: ['HRMS', 'SALES'] as const, seatLimit: 1000, storageMb: 102400 },
  ];
  const seededPlans = new Map<string, { id: string }>();
  for (const spec of planSpecs) {
    const seeded = await db.subscriptionPlan.upsert({
      where: { code: spec.code },
      update: {
        name: spec.name,
        modules: [...spec.modules],
        seatLimit: spec.seatLimit,
        storageMb: spec.storageMb,
        active: true,
      },
      create: {
        ...spec,
        modules: [...spec.modules],
        featureLimits: { apiRequestsPerMinute: 600, leadCeiling: 1_000_000 },
      },
    });
    seededPlans.set(spec.code, seeded);
    for (const planModuleKey of spec.modules) {
      await db.planModule.upsert({
        where: { planId_module: { planId: seeded.id, module: planModuleKey } },
        update: { enabled: true },
        create: { planId: seeded.id, module: planModuleKey },
      });
    }
    for (const [key, value] of Object.entries({
      users: spec.seatLimit,
      employees: spec.seatLimit,
      storage_mb: spec.storageMb,
    })) {
      await db.planLimit.upsert({
        where: { planId_key: { planId: seeded.id, key } },
        update: { value },
        create: { planId: seeded.id, key, value },
      });
    }
  }
  const plan = seededPlans.get('business')!;
  await db.tenantSubscription.upsert({
    where: { tenantId },
    update: { planId: plan.id, state: 'ACTIVE' },
    create: { tenantId, planId: plan.id, state: 'ACTIVE' },
  });
  const seededSubscription = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
  for (const productModule of ['HRMS', 'SALES'] as const) {
    await db.moduleEntitlement.upsert({
      where: { tenantId_module: { tenantId, module: productModule } },
      update: { state: 'ACTIVE' },
      create: { tenantId, module: productModule, state: 'ACTIVE' },
    });
    await db.subscriptionModule.upsert({
      where: { subscriptionId_module: { subscriptionId: seededSubscription.id, module: productModule } },
      update: { state: 'ACTIVE' },
      create: { subscriptionId: seededSubscription.id, module: productModule, state: 'ACTIVE' },
    });
  }
  console.log(`  tenant ${tenant.displayName} (${tenantId})`);

  // 3. Roles and grants ──────────────────────────────────────────────────────
  const roleIds = new Map<string, string>();
  for (const spec of ROLES) {
    const role = await db.role.upsert({
      where: { tenantId_key: { tenantId, key: spec.key } },
      update: {},
      create: {
        tenantId,
        key: spec.key,
        name: spec.name,
        rank: spec.rank,
        defaultScope: spec.defaultScope as any,
        isSystem: true,
      },
    });
    roleIds.set(spec.key, role.id);

    const rows: any[] = [];
    for (const [module, actions] of Object.entries(spec.grants)) {
      if (module === '*') {
        for (const [k, id] of permIndex)
          rows.push({ tenantId, roleId: role.id, permissionId: id, scope: 'ORGANIZATION', granted: true, _k: k });
        continue;
      }
      for (const [action, scope] of Object.entries(actions)) {
        const id = permIndex.get(`${module}:${action}`);
        if (id) rows.push({ tenantId, roleId: role.id, permissionId: id, scope, granted: true });
      }
    }
    await db.rolePermission.createMany({
      data: rows.map(({ _k, ...r }) => r),
      skipDuplicates: true,
    });
  }
  console.log(`  ${ROLES.length} roles with grants`);

  // 4. Structure ─────────────────────────────────────────────────────────────
  const regionSpecs = [
    ['DXB', 'Dubai'],
    ['AUH', 'Abu Dhabi'],
    ['NE', 'Northern Emirates'],
  ];
  const regions = new Map<string, string>();
  for (const [code, name] of regionSpecs) {
    const r = await db.region.upsert({
      where: { tenantId_code: { tenantId, code: code! } },
      update: {},
      create: { tenantId, code: code!, name: name! },
    });
    regions.set(code!, r.id);
  }

  const branchSpecs: [string, string, string, string][] = [
    ['BB', 'Business Bay', 'DXB', 'Dubai'],
    ['JLT', 'Jumeirah Lakes Towers', 'DXB', 'Dubai'],
    ['DT', 'Downtown', 'DXB', 'Dubai'],
    ['REEM', 'Al Reem Island', 'AUH', 'Abu Dhabi'],
    ['SHJ', 'Sharjah', 'NE', 'Sharjah'],
  ];
  const branches = new Map<string, string>();
  for (const [code, name, region, city] of branchSpecs) {
    const b = await db.branch.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { tenantId, code, name, regionId: regions.get(region)!, city, country: 'AE', timezone: 'Asia/Dubai' },
    });
    branches.set(code, b.id);
  }

  const deptSpecs = [
    ['SALES', 'Sales'],
    ['MKTG', 'Marketing'],
    ['SERV', 'Client Services'],
    ['OPS', 'Operations'],
  ];
  const departments = new Map<string, string>();
  for (const [code, name] of deptSpecs) {
    const d = await db.department.upsert({
      where: { tenantId_code: { tenantId, code: code! } },
      update: {},
      create: { tenantId, code: code!, name: name! },
    });
    departments.set(code!, d.id);
  }

  const teamSpecs: [string, string, string, string][] = [
    ['BB-A', 'Business Bay Alpha', 'BB', 'SALES'],
    ['BB-B', 'Business Bay Bravo', 'BB', 'SALES'],
    ['JLT-A', 'JLT Alpha', 'JLT', 'SALES'],
    ['JLT-B', 'JLT Bravo', 'JLT', 'SALES'],
    ['DT-A', 'Downtown Alpha', 'DT', 'SALES'],
    ['REEM-A', 'Al Reem Alpha', 'REEM', 'SALES'],
    ['MKTG-1', 'Marketing', 'BB', 'MKTG'],
    ['SERV-1', 'Client Services', 'BB', 'SERV'],
  ];
  const teams = new Map<string, string>();
  for (const [code, name, branch, dept] of teamSpecs) {
    const t = await db.team.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { tenantId, code, name, branchId: branches.get(branch)!, departmentId: departments.get(dept)! },
    });
    teams.set(code, t.id);
  }
  console.log(`  ${regions.size} regions · ${branches.size} branches · ${teams.size} teams`);

  // 5. Users ─────────────────────────────────────────────────────────────────
  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const ownerEmail = (process.env.PLATFORM_OWNER_EMAIL ?? 'owner@masterapp.local').trim().toLowerCase();
  const ownerPassword = process.env.PLATFORM_OWNER_PASSWORD ?? DEMO_PASSWORD;
  const ownerMfaSecret = process.env.PLATFORM_OWNER_MFA_SECRET?.trim() || null;
  await db.platformUser.upsert({
    where: { normalizedEmail: ownerEmail },
    // passwordHash included: without it, re-seeding after changing
    // PLATFORM_OWNER_PASSWORD silently keeps the old credential.
    update: {
      platformRole: 'OWNER',
      status: 'ACTIVE',
      passwordHash: await hash(ownerPassword, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      passwordChangedAt: new Date(),
    },
    create: {
      email: ownerEmail,
      normalizedEmail: ownerEmail,
      fullName: 'Platform Owner',
      passwordHash: await hash(ownerPassword, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      emailVerifiedAt: new Date(),
      status: 'ACTIVE',
      platformRole: 'OWNER',
      // Stamped, not left null. Null means "still on a password an
      // administrator issued", which every page now refuses to look past — and
      // a seeded credential is the account's own from the first minute, not a
      // temporary one somebody read out over the phone.
      passwordChangedAt: new Date(),
      mfaEnabled: Boolean(ownerMfaSecret),
      mfaSecret: ownerMfaSecret,
    },
  });

  const userSpecs: [string, string, string, string | null, string | null][] = [
    ['Amina', 'Al Rashid', 'org_admin', null, null],
    ['Dhruv', 'Menon', 'sales_director', null, null],
    ['Elena', 'Petrova', 'regional_manager', 'BB', 'DXB'],
    ['Tariq', 'Al Mansoori', 'regional_manager', 'REEM', 'AUH'],
    ['Sofia', 'Marchetti', 'branch_manager', 'BB', 'DXB'],
    ['Omar', 'Khalifa', 'branch_manager', 'JLT', 'DXB'],
    ['Priya', 'Nair', 'branch_manager', 'DT', 'DXB'],
    ['Faisal', 'Al Zaabi', 'branch_manager', 'REEM', 'AUH'],
    ['Marco', 'Rossi', 'branch_manager', 'SHJ', 'NE'],
    ['Rashid', 'Al Suwaidi', 'team_manager', 'BB', 'DXB'],
    ['Ritika', 'Bhatt', 'team_manager', 'BB', 'DXB'],
    ['Vikram', 'Iyer', 'team_manager', 'JLT', 'DXB'],
    ['Clara', 'Lindqvist', 'team_manager', 'DT', 'DXB'],
    ['Joel', 'Fernandes', 'sales_rep', 'BB', 'DXB'],
    ['Nadia', 'Karim', 'sales_rep', 'BB', 'DXB'],
    ['Rohan', 'Mehta', 'sales_rep', 'BB', 'DXB'],
    ['Ayesha', 'Siddiqui', 'sales_rep', 'JLT', 'DXB'],
    ['Stefan', 'Kovac', 'sales_rep', 'JLT', 'DXB'],
    ['Layla', 'Barakat', 'sales_rep', 'DT', 'DXB'],
    ['Youssef', 'Farooq', 'sales_rep', 'REEM', 'AUH'],
    ['Sana', 'Chowdhury', 'sales_rep', 'SHJ', 'NE'],
    ['Karim', 'Haddad', 'field_rep', 'BB', 'DXB'],
    ['Bilal', 'Ahmadi', 'field_rep', 'JLT', 'DXB'],
    ['Noor', 'Al Hashimi', 'marketing_manager', 'BB', 'DXB'],
    ['Anton', 'Novak', 'marketing_exec', 'BB', 'DXB'],
    ['Zainab', 'Okafor', 'marketing_exec', 'BB', 'DXB'],
    ['Mariam', 'Dcruz', 'service_manager', 'BB', 'DXB'],
    ['Liza', 'Gonzales', 'service_agent', 'BB', 'DXB'],
    ['Hamdan', 'Pereira', 'service_agent', 'BB', 'DXB'],
    ['Reem', 'Silva', 'analyst', null, null],
    ['Auditor', 'Account', 'read_only', null, null],
  ];

  const users: { id: string; role: string; branch: string | null; teamCode: string | null }[] = [];
  let n = 0;
  for (const [first, last, roleKey, branchCode, regionCode] of userSpecs) {
    const addr = roleKey === 'read_only' ? 'auditor@example.com' : email(first, last, 0);
    const u = await db.user.upsert({
      where: { tenantId_email: { tenantId, email: addr } },
      update: {},
      create: {
        tenantId,
        email: addr,
        fullName: `${first} ${last}`,
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
        roleId: roleIds.get(roleKey)!,
        branchId: branchCode ? branches.get(branchCode)! : null,
        regionId: regionCode ? regions.get(regionCode)! : null,
        jobTitle: ROLES.find((r) => r.key === roleKey)!.name,
        phone: phone(),
        employeeCode: `${DEMO_WORKSPACE.employeePrefix}-${String(++n).padStart(3, '0')}`,
        dailyLeadQuota: roleKey === 'sales_rep' ? 15 : null,
        activeLeadCapacity: roleKey === 'sales_rep' ? 120 : null,
      },
    });

    const normalizedEmail = addr.trim().toLowerCase();
    const platformUser = await db.platformUser.upsert({
      where: { normalizedEmail },
      update: { fullName: `${first} ${last}`, status: u.status, passwordHash, passwordChangedAt: new Date() },
      create: {
        email: normalizedEmail,
        normalizedEmail,
        fullName: `${first} ${last}`,
        passwordHash,
        emailVerifiedAt: u.emailVerifiedAt,
        status: u.status,
        // See the owner above: a seeded password belongs to its account, so it
        // must not read as an administrator-issued temporary one.
        passwordChangedAt: new Date(),
      },
    });
    const membership = await db.workspaceMembership.upsert({
      where: { tenantId_platformUserId: { tenantId, platformUserId: platformUser.id } },
      update: {
        salesUserId: u.id,
        status: u.status === 'ACTIVE' ? 'ACTIVE' : u.status === 'SUSPENDED' ? 'SUSPENDED' : 'INVITED',
      },
      create: {
        tenantId,
        platformUserId: platformUser.id,
        salesUserId: u.id,
        status: u.status === 'ACTIVE' ? 'ACTIVE' : u.status === 'SUSPENDED' ? 'SUSPENDED' : 'INVITED',
        isPrimaryAdmin: roleKey === 'org_admin',
        roleSnapshot: roleKey,
        joinedAt: u.status === 'ACTIVE' ? new Date() : null,
      },
    });
    await db.employeeProfile.upsert({
      where: { membershipId: membership.id },
      update: { designation: u.jobTitle, employmentStatus: u.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' },
      create: {
        tenantId,
        membershipId: membership.id,
        employeeNumber: u.employeeCode ?? `${DEMO_WORKSPACE.employeePrefix}-${u.id.slice(-8)}`,
        designation: u.jobTitle,
        employmentStatus: u.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
        joinedOn: u.createdAt,
        metadata: { source: 'sales-seed' },
      },
    });

    // team membership: one sales team per branch, round-robined
    const teamCode = branchCode
      ? roleKey === 'marketing_manager' || roleKey === 'marketing_exec'
        ? 'MKTG-1'
        : roleKey === 'service_manager' || roleKey === 'service_agent'
          ? 'SERV-1'
          : (teamSpecs.find((t) => t[2] === branchCode)?.[0] ?? null)
      : null;

    if (teamCode && teams.get(teamCode)) {
      await db.userTeam.upsert({
        where: { userId_teamId: { userId: u.id, teamId: teams.get(teamCode)! } },
        update: {},
        create: { tenantId, userId: u.id, teamId: teams.get(teamCode)!, isManager: roleKey.includes('manager') },
      });
    }
    users.push({ id: u.id, role: roleKey, branch: branchCode, teamCode });
  }

  // two on leave, one suspended — exercises distribution eligibility and lockout
  const reps = users.filter((u) => u.role === 'sales_rep');
  await db.user.update({
    where: { id: reps[reps.length - 1]!.id },
    data: { onLeaveUntil: new Date(Date.now() + 7 * 864e5), isAvailable: false },
  });
  await db.user.update({ where: { id: reps[reps.length - 2]!.id }, data: { status: 'SUSPENDED' } });
  console.log(`  ${users.length} users`);

  // 6. Configuration ─────────────────────────────────────────────────────────
  const stageIds = new Map<string, string>();
  for (let i = 0; i < STAGES.length; i++) {
    const [key, name, category, color, isDefault, sla] = STAGES[i]!;
    const s = await db.leadStage.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: {},
      create: { tenantId, key, name, category: category as any, color, position: i, isDefault, slaMinutes: sla },
    });
    stageIds.set(key, s.id);
  }

  const activityTypes: [string, string, number][] = [
    ['call_out', 'Outbound call', 3],
    ['call_in', 'Incoming call', 8],
    ['call_missed', 'Missed call', 0],
    ['email_sent', 'Email sent', 1],
    ['email_received', 'Email received', 4],
    ['sms_sent', 'SMS sent', 1],
    ['whatsapp_sent', 'WhatsApp sent', 2],
    ['meeting', 'Meeting', 12],
    ['demo', 'Product demonstration', 15],
    ['office_visit', 'Office visit', 12],
    ['field_visit', 'Field visit', 12],
    ['site_visit', 'Site visit', 14],
    ['form_submission', 'Form submission', 10],
    ['document_received', 'Document received', 6],
    ['document_verified', 'Document verified', 6],
    ['payment_received', 'Payment received', 20],
    ['proposal_shared', 'Proposal shared', 10],
    ['follow_up', 'Follow-up completed', 3],
    ['feedback', 'Customer feedback', 2],
    ['note', 'Lead note', 0],
  ];
  const activityTypeIds = new Map<string, string>();
  for (let i = 0; i < activityTypes.length; i++) {
    const [key, name, scoreDelta] = activityTypes[i]!;
    const at = await db.activityType.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: {},
      create: { tenantId, key, name, scoreDelta, position: i },
    });
    activityTypeIds.set(key, at.id);
  }

  const taskTypes: [string, string, string][] = [
    ['call', 'Call', 'TODO'],
    ['meeting', 'Meeting', 'APPOINTMENT'],
    ['follow_up', 'Follow-up', 'TODO'],
    ['demo', 'Product demonstration', 'APPOINTMENT'],
    ['site_visit', 'Site visit', 'APPOINTMENT'],
    ['doc_verify', 'Document verification', 'TODO'],
    ['payment_reminder', 'Payment reminder', 'TODO'],
    ['renewal', 'Renewal reminder', 'TODO'],
    ['app_review', 'Application review', 'TODO'],
    ['internal', 'Internal task', 'TODO'],
  ];
  const taskTypeIds = new Map<string, string>();
  for (const [key, name, category] of taskTypes) {
    const tt = await db.taskType.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: {},
      create: { tenantId, key, name, category: category as any },
    });
    taskTypeIds.set(key, tt.id);
  }

  await db.duplicateRule.createMany({
    data: [
      { tenantId, name: 'Exact email', matchFields: ['email'], strategy: 'BLOCK', position: 0 },
      { tenantId, name: 'Normalised phone', matchFields: ['phoneNormalized'], strategy: 'BLOCK', position: 1 },
      {
        tenantId,
        name: 'Name plus phone',
        matchFields: ['fullName', 'phoneNormalized'],
        strategy: 'WARN',
        position: 2,
      },
    ],
    skipDuplicates: true,
  });

  const productSpecs: [string, string, string, number][] = [
    ['OFF-1BR', 'Off-plan 1 Bedroom', 'Off-plan', 950000],
    ['OFF-2BR', 'Off-plan 2 Bedroom', 'Off-plan', 1650000],
    ['OFF-3BR', 'Off-plan 3 Bedroom', 'Off-plan', 2650000],
    ['OFF-TH', 'Off-plan Townhouse', 'Off-plan', 3200000],
    ['OFF-VIL', 'Off-plan Villa', 'Off-plan', 5400000],
    ['RDY-STU', 'Ready Studio', 'Ready', 680000],
    ['RDY-1BR', 'Ready 1 Bedroom', 'Ready', 1120000],
    ['RDY-2BR', 'Ready 2 Bedroom', 'Ready', 1890000],
    ['RDY-PH', 'Ready Penthouse', 'Ready', 8900000],
    ['COM-OFF', 'Commercial Office Floor', 'Commercial', 4300000],
    ['COM-RET', 'Retail Unit', 'Commercial', 2100000],
    ['COM-WH', 'Warehouse', 'Commercial', 3600000],
    ['MTG-RES', 'Residential Mortgage', 'Mortgage', 0],
    ['MTG-BTL', 'Buy-to-Let Mortgage', 'Mortgage', 0],
    ['MTG-REF', 'Mortgage Refinance', 'Mortgage', 0],
    ['SRV-VAL', 'Property Valuation', 'Services', 3500],
    ['SRV-SNAG', 'Snagging Inspection', 'Services', 2200],
    ['SRV-PM', 'Property Management', 'Services', 12000],
    ['SRV-CONV', 'Conveyancing', 'Services', 7500],
    ['SRV-ADV', 'Investment Advisory', 'Services', 15000],
  ];
  for (const [code, name, category, price] of productSpecs) {
    await db.product.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { tenantId, code, name, category, unitPrice: price, currency: 'AED', taxRate: 5, status: 'ACTIVE' },
    });
  }
  console.log(
    `  ${STAGES.length} stages · ${activityTypes.length} activity types · ${taskTypes.length} task types · ${productSpecs.length} products`,
  );

  // 7. Leads ─────────────────────────────────────────────────────────────────
  const existingLeads = await db.lead.count({ where: { tenantId } });
  if (existingLeads > 0) {
    console.log(`\n  ${existingLeads} leads already present — skipping record generation.`);
    console.log('  Re-run with `npm run db:seed -- --reset` to rebuild from scratch.');
  } else {
    const assignable = users.filter((u) => ['sales_rep', 'field_rep', 'team_manager'].includes(u.role));
    const now = Date.now();
    let ref = 0;

    const leadRows: any[] = [];
    for (let i = 0; i < 500; i++) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const rawPhone = phone();
      const stageKey = weighted(STAGE_WEIGHTS);
      const stage = STAGES.find((s) => s[0] === stageKey)!;
      const createdAt = businessDate(180);

      // 40 unassigned, so the distribution queue and the Unassigned view have work
      const unassigned = i < 40;
      const owner = unassigned ? null : pick(assignable);

      const isOpen = stage[2] === 'OPEN';
      const contacted = !['new'].includes(stageKey) && chance(0.9);
      const slaDue = stage[5] ? new Date(createdAt.getTime() + stage[5] * 60_000) : null;

      leadRows.push({
        tenantId,
        reference: `LD-${String(++ref).padStart(6, '0')}`,
        firstName: first,
        lastName: last,
        fullName: `${first} ${last}`,
        email: email(first, last, i),
        phone: rawPhone,
        phoneNormalized: rawPhone, // phone() already emits E.164
        company: chance(0.45) ? pick(COMPANIES) : null,
        jobTitle: chance(0.4)
          ? pick(['Director', 'Managing Partner', 'Head of Operations', 'Investor', 'Consultant', 'Founder'])
          : null,
        industry: chance(0.5) ? pick(INDUSTRIES) : null,
        city: pick(CITIES),
        country: 'AE',
        source: weighted(SOURCES) as any,
        stageId: stageIds.get(stageKey)!,
        score: stageKey === 'new' ? int(0, 15) : int(10, 95),
        grade: pick(['A', 'B', 'C', 'D']),
        priority: weighted({ LOW: 20, MEDIUM: 50, HIGH: 25, URGENT: 5 }) as any,
        ownerId: owner?.id ?? null,
        branchId: owner?.branch ? branches.get(owner.branch)! : null,
        teamId: owner?.teamCode ? teams.get(owner.teamCode)! : null,
        assignedAt: owner ? createdAt : null,
        consentStatus: chance(0.75) ? 'GRANTED' : 'UNKNOWN',
        doNotCall: chance(0.05),
        emailOptOut: chance(0.07),
        tags: chance(0.35) ? [pick(['hot', 'investor', 'referral', 'repeat', 'nurture'])] : [],
        firstContactedAt: contacted ? new Date(createdAt.getTime() + int(5, 2880) * 60_000) : null,
        lastActivityAt: chance(0.8) ? businessDate(45) : null,
        // 25 leads deliberately past their follow-up date
        nextFollowUpAt: isOpen
          ? i % 20 === 0
            ? new Date(now - int(1, 10) * 864e5)
            : new Date(now + int(1, 21) * 864e5)
          : null,
        slaDueAt: slaDue,
        slaState: !slaDue ? 'ON_TRACK' : contacted ? 'MET' : slaDue.getTime() < now ? 'BREACHED' : 'AT_RISK',
        convertedAt: stageKey === 'converted' ? businessDate(60) : null,
        createdAt,
        updatedAt: createdAt,
      });
    }

    await db.lead.createMany({ data: leadRows, skipDuplicates: true });
    const leads = await db.lead.findMany({
      where: { tenantId },
      select: { id: true, ownerId: true, createdAt: true, stageId: true },
    });
    console.log(`\n  ${leads.length} leads`);

    // stage + assignment history so the timeline is not empty
    await db.leadStageHistory.createMany({
      data: leads.map((l) => ({ tenantId, leadId: l.id, toStageId: l.stageId, createdAt: l.createdAt })),
    });
    await db.leadAssignmentHistory.createMany({
      data: leads
        .filter((l) => l.ownerId)
        .map((l) => ({ tenantId, leadId: l.id, toOwnerId: l.ownerId, reason: 'SEED', createdAt: l.createdAt })),
    });

    // activities, weighted to the recent 90 days
    const atIds = [...activityTypeIds.values()];
    const activityRows: any[] = [];
    for (let i = 0; i < 1000; i++) {
      const lead = pick(leads);
      activityRows.push({
        tenantId,
        typeId: pick(atIds),
        leadId: lead.id,
        ownerId: lead.ownerId,
        occurredAt: businessDate(90),
        status: 'COMPLETED',
        outcome: pick(['Connected', 'No answer', 'Interested', 'Call back later', 'Not interested', 'Voicemail']),
        durationSecs: int(45, 900),
      });
    }
    await db.activity.createMany({ data: activityRows });
    console.log(`  ${activityRows.length} activities`);

    // tasks: 120 open, 60 overdue, 100 completed, 20 cancelled
    const ttIds = [...taskTypeIds.values()];
    const taskRows: any[] = [];
    const buckets: [string, number, boolean][] = [
      ['OPEN', 120, false],
      ['OPEN', 60, true],
      ['COMPLETED', 100, false],
      ['CANCELLED', 20, false],
    ];
    for (const [status, count, overdue] of buckets) {
      for (let i = 0; i < count; i++) {
        const lead = pick(leads);
        const dueAt = overdue ? new Date(now - int(1, 14) * 864e5) : new Date(now + int(-2, 21) * 864e5);
        taskRows.push({
          tenantId,
          typeId: pick(ttIds),
          category: chance(0.4) ? 'APPOINTMENT' : 'TODO',
          title: pick([
            'First contact call',
            'Send proposal',
            'Collect KYC documents',
            'Schedule viewing',
            'Payment follow-up',
            'Confirm site visit',
            'Review application',
          ]),
          leadId: lead.id,
          ownerId: lead.ownerId,
          dueAt,
          priority: weighted({ LOW: 20, MEDIUM: 50, HIGH: 25, URGENT: 5 }) as any,
          status: status as any,
          completedAt: status === 'COMPLETED' ? businessDate(30) : null,
        });
      }
    }
    await db.task.createMany({ data: taskRows });
    console.log(`  ${taskRows.length} tasks (${60} overdue)`);
  }

  // ── second workspace ──────────────────────────────────────────────────────
  // Leadersfort exists so cross-workspace isolation is demonstrable in the UI,
  // and so the Platform Owner sees more than one company. It is deliberately
  // HRMS-only: opening its Sales URLs must be refused by entitlement checks.
  const second = await db.tenant.upsert({
    where: { slug: SECOND_WORKSPACE.slug },
    update: {},
    create: {
      slug: SECOND_WORKSPACE.slug,
      legalName: SECOND_WORKSPACE.legalName,
      displayName: SECOND_WORKSPACE.displayName,
      planCode: SECOND_WORKSPACE.planCode,
      maxUsers: 50,
      maxEmployees: 50,
      settings: {
        create: {
          productName: SECOND_WORKSPACE.displayName,
          defaultTimezone: 'Asia/Dubai',
          defaultCurrency: 'AED',
          defaultLocale: 'en-AE',
        },
      },
    },
  });

  const secondPlan = seededPlans.get(SECOND_WORKSPACE.planCode)!;
  await db.tenantSubscription.upsert({
    where: { tenantId: second.id },
    update: { planId: secondPlan.id, state: 'ACTIVE' },
    create: { tenantId: second.id, planId: secondPlan.id, state: 'ACTIVE' },
  });
  const secondSubscription = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: second.id } });
  for (const productModule of SECOND_WORKSPACE.modules) {
    await db.moduleEntitlement.upsert({
      where: { tenantId_module: { tenantId: second.id, module: productModule } },
      update: { state: 'ACTIVE' },
      create: { tenantId: second.id, module: productModule, state: 'ACTIVE' },
    });
    await db.subscriptionModule.upsert({
      where: { subscriptionId_module: { subscriptionId: secondSubscription.id, module: productModule } },
      update: { state: 'ACTIVE' },
      create: { subscriptionId: secondSubscription.id, module: productModule, state: 'ACTIVE' },
    });
  }

  // Same role catalogue as the primary workspace: roles are per-tenant rows.
  const secondRoleIds = new Map<string, string>();
  for (const spec of ROLES) {
    const role = await db.role.upsert({
      where: { tenantId_key: { tenantId: second.id, key: spec.key } },
      update: {},
      create: {
        tenantId: second.id,
        key: spec.key,
        name: spec.name,
        rank: spec.rank,
        defaultScope: spec.defaultScope as any,
        isSystem: true,
      },
    });
    secondRoleIds.set(spec.key, role.id);
    const rows: any[] = [];
    for (const [module, actions] of Object.entries(spec.grants)) {
      if (module === '*') {
        for (const [, id] of permIndex)
          rows.push({ tenantId: second.id, roleId: role.id, permissionId: id, scope: 'ORGANIZATION', granted: true });
        continue;
      }
      for (const [action, scope] of Object.entries(actions)) {
        const id = permIndex.get(`${module}:${action}`);
        if (id) rows.push({ tenantId: second.id, roleId: role.id, permissionId: id, scope, granted: true });
      }
    }
    await db.rolePermission.createMany({ data: rows, skipDuplicates: true });
  }

  const secondAdminEmail = SECOND_WORKSPACE.adminEmail;
  const secondSalesUser = await db.user.upsert({
    where: { tenantId_email: { tenantId: second.id, email: secondAdminEmail } },
    update: { status: 'ACTIVE' },
    create: {
      tenantId: second.id,
      email: secondAdminEmail,
      fullName: 'Leadersfort Administrator',
      roleId: secondRoleIds.get('org_admin')!,
      status: 'ACTIVE',
    },
  });
  const secondPlatformUser = await db.platformUser.upsert({
    where: { normalizedEmail: secondAdminEmail },
    update: { status: 'ACTIVE' },
    create: {
      email: secondAdminEmail,
      normalizedEmail: secondAdminEmail,
      fullName: 'Leadersfort Administrator',
      passwordHash,
      emailVerifiedAt: new Date(),
      status: 'ACTIVE',
    },
  });
  const secondMembership = await db.workspaceMembership.upsert({
    where: { tenantId_platformUserId: { tenantId: second.id, platformUserId: secondPlatformUser.id } },
    update: { salesUserId: secondSalesUser.id, status: 'ACTIVE' },
    create: {
      tenantId: second.id,
      platformUserId: secondPlatformUser.id,
      salesUserId: secondSalesUser.id,
      status: 'ACTIVE',
      isPrimaryAdmin: true,
      roleSnapshot: 'org_admin',
      joinedAt: new Date(),
    },
  });
  await db.employeeProfile.upsert({
    where: { membershipId: secondMembership.id },
    update: {},
    create: {
      tenantId: second.id,
      membershipId: secondMembership.id,
      employeeNumber: 'LF-001',
      designation: 'Administrator',
      employmentStatus: 'ACTIVE',
      joinedOn: new Date(),
    },
  });
  console.log(`  tenant ${second.displayName} (${second.id}) — ${SECOND_WORKSPACE.modules.join(', ')} only`);

  // ── credentials ───────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────');
  console.log(` Workspace:  ${DEMO_WORKSPACE.slug}`);
  console.log(` Password:   ${DEMO_PASSWORD}   (all demo accounts)`);
  console.log(` Platform:   ${ownerEmail}`);
  console.log('─────────────────────────────────────────────');
  for (const key of [
    'org_admin',
    'sales_director',
    'branch_manager',
    'team_manager',
    'sales_rep',
    'field_rep',
    'service_agent',
    'analyst',
    'read_only',
  ]) {
    const spec = userSpecs.find((u) => u[2] === key)!;
    const addr = key === 'read_only' ? 'auditor@example.com' : email(spec[0], spec[1], 0);
    console.log(` ${key.padEnd(16)} ${addr}`);
  }
  console.log(` ${SECOND_WORKSPACE.slug.padEnd(16)} ${SECOND_WORKSPACE.adminEmail}`);
  console.log('─────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('\nSeed failed:\n', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
