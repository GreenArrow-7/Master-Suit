#!/usr/bin/env node
/**
 * Synthetic enterprise tenant for performance testing: ~10 000 users and
 * ~100 000 leads, plus the activity/task/call volume that hangs off them.
 *
 * This is NOT the demo seed. It writes one obviously-synthetic tenant
 * (perf-titan, everything named PERF-...) into a dedicated performance
 * database, for load tests and data-shape validation only. Guards mirror the
 * demo seed's: never against a database named production/staging, and never
 * without the operator saying so.
 *
 *   PERF_DATABASE_URL=postgresql://leadflow:...@localhost:5432/master_saas_perf \
 *     ALLOW_PERF_SEED=yes node scripts/perf/seed-perf.mjs
 *
 * Volumes come from flags so a smaller shape is one flag away:
 *   --users 10000 --leads 100000 --activities 200000 --calls 20000 --tasks 50000
 *
 * Speed comes from three choices: one argon2 hash shared by every synthetic
 * login (hashing 10k distinct passwords would take ~8 minutes and prove
 * nothing), createMany in 5k batches, and cuid-free deterministic ids
 * (perf-u-000001 …) so re-runs are idempotent via skipDuplicates.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..');
const require = createRequire(path.join(appRoot, 'package.json'));
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('@node-rs/argon2');

const url = process.env.PERF_DATABASE_URL;
if (!url) {
  console.error('Set PERF_DATABASE_URL to the dedicated performance database.');
  process.exit(1);
}
const dbName = new URL(url).pathname.slice(1).split('?')[0];
if (/[_-](prod|production|staging|stage)\d*$/i.test(dbName)) {
  console.error(`Refusing: "${dbName}" is named as a shared environment.`);
  process.exit(1);
}
if (!/perf/i.test(dbName)) {
  console.error(`Refusing: "${dbName}" does not look like a performance database (want *perf*).`);
  process.exit(1);
}
if (process.env.ALLOW_PERF_SEED !== 'yes') {
  console.error('Refusing without ALLOW_PERF_SEED=yes.');
  process.exit(1);
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const USERS = arg('users', 10_000);
const LEADS = arg('leads', 100_000);
const ACTIVITIES = arg('activities', 200_000);
const CALLS = arg('calls', 20_000);
const TASKS = arg('tasks', 50_000);

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const pad = (n) => String(n).padStart(6, '0');
const BATCH = 5_000;

async function batched(label, total, make, create) {
  const started = Date.now();
  for (let offset = 0; offset < total; offset += BATCH) {
    const rows = [];
    for (let i = offset; i < Math.min(offset + BATCH, total); i++) rows.push(make(i));
    await create(rows);
  }
  console.log(`  ${label}: ${total} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const TENANT = 'perf-titan-tenant';
console.log(
  `Seeding ${dbName}: ${USERS} users, ${LEADS} leads, ${ACTIVITIES} activities, ${CALLS} calls, ${TASKS} tasks`,
);

// ── Tenant, role, stages ─────────────────────────────────────────────────────
await db.tenant.upsert({
  where: { id: TENANT },
  update: {},
  create: {
    id: TENANT,
    slug: 'perf-titan',
    legalName: 'PERF Titan Industries (synthetic)',
    displayName: 'PERF Titan',
    status: 'ACTIVE',
    planCode: 'enterprise',
  },
});
await db.moduleEntitlement.upsert({
  where: { id: 'perf-ent-sales' },
  update: {},
  create: { id: 'perf-ent-sales', tenantId: TENANT, module: 'SALES', state: 'ACTIVE' },
});
const role = await db.role.upsert({
  where: { id: 'perf-role-rep' },
  update: {},
  create: { id: 'perf-role-rep', tenantId: TENANT, key: 'sales_rep', name: 'Sales Rep', rank: 70, defaultScope: 'OWN' },
});
// The load driver's user must read the whole 100k-lead tenant — the point is to
// measure the big lists, not one owner's slice. ORGANIZATION VIEW across the
// CRM modules; the permission catalogue is global and idempotent to upsert.
for (const [module, action] of [
  ['leads', 'VIEW'],
  ['opportunities', 'VIEW'],
  ['accounts', 'VIEW'],
  ['contacts', 'VIEW'],
  ['activities', 'VIEW'],
  ['tasks', 'VIEW'],
  ['calls', 'VIEW'],
  ['dashboards', 'VIEW'],
]) {
  const permission = await db.permission.upsert({
    where: { module_action: { module, action } },
    update: {},
    create: { module, action },
  });
  await db.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: { scope: 'ORGANIZATION', granted: true },
    create: { tenantId: TENANT, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
  });
}
const stages = [];
for (const [i, key] of ['new', 'contacted', 'qualified', 'won', 'lost'].entries()) {
  stages.push(
    await db.leadStage.upsert({
      where: { id: `perf-stage-${key}` },
      update: {},
      create: {
        id: `perf-stage-${key}`,
        tenantId: TENANT,
        key,
        name: key[0].toUpperCase() + key.slice(1),
        position: i,
        isDefault: key === 'new',
        category: key === 'won' ? 'CONVERSION' : key === 'lost' ? 'TERMINAL_NEGATIVE' : 'OPEN',
      },
    }),
  );
}

// ── Users: one shared hash, deterministic ids ────────────────────────────────
const passwordHash = await hash(`Perf-${randomBytes(9).toString('base64url')}`, {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});
await batched(
  'platform users',
  USERS,
  (i) => ({
    id: `perf-pu-${pad(i)}`,
    email: `perf.user.${pad(i)}@perf-titan.test`,
    normalizedEmail: `perf.user.${pad(i)}@perf-titan.test`,
    fullName: `PERF User ${pad(i)}`,
    passwordHash,
    passwordChangedAt: new Date(),
    status: 'ACTIVE',
    platformRole: 'USER',
  }),
  (data) => db.platformUser.createMany({ data, skipDuplicates: true }),
);
await batched(
  'workspace users',
  USERS,
  (i) => ({
    id: `perf-u-${pad(i)}`,
    tenantId: TENANT,
    email: `perf.user.${pad(i)}@perf-titan.test`,
    fullName: `PERF User ${pad(i)}`,
    status: 'ACTIVE',
    roleId: role.id,
  }),
  (data) => db.user.createMany({ data, skipDuplicates: true }),
);
await batched(
  'memberships',
  USERS,
  (i) => ({
    id: `perf-m-${pad(i)}`,
    tenantId: TENANT,
    platformUserId: `perf-pu-${pad(i)}`,
    salesUserId: `perf-u-${pad(i)}`,
    status: 'ACTIVE',
    roleSnapshot: 'sales_rep',
    joinedAt: new Date(),
  }),
  (data) => db.workspaceMembership.createMany({ data, skipDuplicates: true }),
);

// ── Leads: spread across owners, stages and a year of timestamps ─────────────
const yearAgo = Date.now() - 365 * 86_400_000;
const at = (i, total) => new Date(yearAgo + Math.floor((i / total) * 364 * 86_400_000));
await batched(
  'leads',
  LEADS,
  (i) => ({
    id: `perf-l-${pad(i)}`,
    tenantId: TENANT,
    reference: `PERF-LD-${pad(i)}`,
    fullName: `PERF Lead ${pad(i)}`,
    company: `PERF Co ${i % 500}`,
    email: `lead.${pad(i)}@perf-example.test`,
    phoneNormalized: `+9715${String(10000000 + i).slice(0, 8)}`,
    stageId: stages[i % stages.length].id,
    ownerId: i % 10 === 0 ? null : `perf-u-${pad(i % USERS)}`,
    score: i % 100,
    createdAt: at(i, LEADS),
    updatedAt: at(i, LEADS),
  }),
  (data) => db.lead.createMany({ data, skipDuplicates: true }),
);

// ── Activity / task / call history hanging off the leads ─────────────────────
const activityType = await db.activityType.upsert({
  where: { id: 'perf-at-touch' },
  update: {},
  create: { id: 'perf-at-touch', tenantId: TENANT, key: 'perf_touch', name: 'PERF Touch' },
});
await batched(
  'activities',
  ACTIVITIES,
  (i) => ({
    id: `perf-a-${pad(i)}`,
    tenantId: TENANT,
    typeId: activityType.id,
    leadId: `perf-l-${pad(i % LEADS)}`,
    ownerId: `perf-u-${pad(i % USERS)}`,
    notes: `PERF touch ${i}`,
    occurredAt: at(i, ACTIVITIES),
  }),
  (data) => db.activity.createMany({ data, skipDuplicates: true }),
);
const taskType = await db.taskType.upsert({
  where: { id: 'perf-tt-todo' },
  update: {},
  create: { id: 'perf-tt-todo', tenantId: TENANT, key: 'perf_todo', name: 'PERF To-do' },
});
await batched(
  'tasks',
  TASKS,
  (i) => ({
    id: `perf-t-${pad(i)}`,
    tenantId: TENANT,
    typeId: taskType.id,
    title: `PERF task ${i}`,
    status: i % 3 === 0 ? 'COMPLETED' : 'OPEN',
    ownerId: `perf-u-${pad(i % USERS)}`,
    leadId: `perf-l-${pad(i % LEADS)}`,
    dueAt: new Date(Date.now() + ((i % 20) - 10) * 86_400_000),
  }),
  (data) => db.task.createMany({ data, skipDuplicates: true }),
);
await batched(
  'calls',
  CALLS,
  (i) => ({
    id: `perf-c-${pad(i)}`,
    tenantId: TENANT,
    callerId: `perf-u-${pad(i % USERS)}`,
    leadId: `perf-l-${pad(i % LEADS)}`,
    direction: 'OUTBOUND',
    status: 'COMPLETED',
    recipientNumber: `+9715${String(10000000 + i).slice(0, 8)}`,
    startedAt: at(i, CALLS),
    durationSecs: 60 + (i % 600),
  }),
  (data) => db.call.createMany({ data, skipDuplicates: true }),
);

const counts = await Promise.all([
  db.platformUser.count(),
  db.lead.count({ where: { tenantId: TENANT } }),
  db.activity.count({ where: { tenantId: TENANT } }),
  db.call.count({ where: { tenantId: TENANT } }),
]);
console.log(`Done. platformUsers=${counts[0]} leads=${counts[1]} activities=${counts[2]} calls=${counts[3]}`);
await db.$disconnect();
