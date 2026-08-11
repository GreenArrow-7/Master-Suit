#!/usr/bin/env node
/**
 * Creates or resets the named administrator account for a workspace, and prints
 * a temporary password exactly once.
 *
 * Usage:
 *   node scripts/ensure-workspace-admin.mjs manath-homes \
 *     --name "System Administrator" --email admin@manathhomes.ae --code ADM-001
 *
 * ── Why a script and not a page ────────────────────────────────────────────
 *
 * The in-app reset deliberately refuses to touch an account at or above the
 * operator's own level, so there is no screen from which an administrator can
 * reset the top administrator — that rule is what stops a deputy from taking
 * the workspace. Recovering the top account therefore has to happen from a
 * shell, where possession of the database is already the authority.
 *
 * The password is generated here and shown once. It is never written to the
 * database in the clear, never mailed, and not accepted as an argument: a
 * password passed on a command line ends up in shell history and process
 * listings, which is exactly the leak this account cannot afford.
 */
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const client = new PrismaClient({ adapter });

const argv = process.argv.slice(2);
const slug = argv.find((value) => !value.startsWith('--'));
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};

const fullName = flag('name', 'System Administrator');
const email = (flag('email') ?? '').trim().toLowerCase();
const employeeNumber = flag('code', 'ADM-001');
const roleKey = flag('role');

if (!slug || !email) {
  console.error('Usage: ensure-workspace-admin.mjs <workspace-slug> --email <address> [--name ...] [--code ...]');
  process.exit(2);
}

// Same shape as services/identity/accounts.ts generateTemporaryPassword.
const temporaryPassword = `${randomBytes(9).toString('base64url')}-${randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Every table here is RLS-forced, so a plain client sees nothing: the same
 * `app.platform_admin` flag `withPlatformTx` asserts is what lets this cross the
 * tenant boundary. `set_config(..., true)` is transaction-local and cannot leak
 * to the next borrower of the pooled connection.
 */
function withPlatformTx(fn) {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.platform_admin', 'on', true)`);
    return fn(tx);
  }, { timeout: 60_000 });
}

async function main() {
  return withPlatformTx(async (client) => {
  const tenant = await client.tenant.findFirst({ where: { slug }, select: { id: true, displayName: true } });
  if (!tenant) throw new Error(`No workspace with slug "${slug}".`);

  // The highest-ranked role in the workspace: rank ascends downward, so the
  // minimum rank is the most senior. Hardcoding a key would break on a tenant
  // that renamed theirs.
  const role = await client.role.findFirst({
    where: { tenantId: tenant.id, ...(roleKey ? { key: roleKey } : {}) },
    orderBy: { rank: 'asc' },
    select: { id: true, key: true, name: true, rank: true },
  });
  if (!role) throw new Error(`Workspace "${slug}" has no role${roleKey ? ` with key "${roleKey}"` : 's'}.`);

  // Same cost parameters as lib/auth/password.ts, read from the same env vars,
  // so a hash written here verifies at sign-in.
  const passwordHash = await hash(temporaryPassword, {
    memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19456),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
  });
  const existingUser = await client.user.findFirst({
    where: { tenantId: tenant.id, email, deletedAt: null },
    select: { id: true, workspaceMembership: { select: { id: true, platformUserId: true, employee: { select: { id: true } } } } },
  });

  let userId;
  let employeeId;

  if (existingUser?.workspaceMembership) {
    // passwordChangedAt: null is what makes the next sign-in demand a password
    // of the account holder's own choosing.
    await client.platformUser.update({
      where: { id: existingUser.workspaceMembership.platformUserId },
      data: { passwordHash, passwordChangedAt: null, failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' },
    });
    await client.user.update({
      where: { id: existingUser.id },
      data: { fullName, status: 'ACTIVE', roleId: role.id, employeeCode: employeeNumber },
    });
    // Every live session dies with the old password: a reset that leaves the
    // refresh tokens alive is pointless in the one case it matters.
    await client.platformSession.updateMany({
      where: { platformUserId: existingUser.workspaceMembership.platformUserId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
    });
    userId = existingUser.id;
    employeeId = existingUser.workspaceMembership.employee?.id ?? null;
    console.log(`Reset the existing account ${email}.`);
  } else {
    const platformUser = await client.platformUser.upsert({
      where: { normalizedEmail: email },
      update: { passwordHash, passwordChangedAt: null, status: 'ACTIVE', fullName },
      create: {
        email,
        normalizedEmail: email,
        fullName,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        passwordChangedAt: null,
      },
    });
    const user = await client.user.create({
      data: {
        tenantId: tenant.id,
        email,
        fullName,
        employeeCode: employeeNumber,
        status: 'ACTIVE',
        roleId: role.id,
        emailVerifiedAt: new Date(),
      },
    });
    const membership = await client.workspaceMembership.create({
      data: {
        tenantId: tenant.id,
        platformUserId: platformUser.id,
        salesUserId: user.id,
        status: 'ACTIVE',
        roleSnapshot: role.key,
        joinedAt: new Date(),
      },
    });
    await client.membershipRole.create({
      data: { tenantId: tenant.id, membershipId: membership.id, roleId: role.id },
    });
    const employee = await client.employeeProfile.create({
      data: {
        tenantId: tenant.id,
        membershipId: membership.id,
        employeeNumber,
        employmentStatus: 'ACTIVE',
        joinedOn: new Date(),
      },
    });
    userId = user.id;
    employeeId = employee.id;
    console.log(`Created ${email}.`);
  }

  await client.auditLog
    .create({
      data: {
        tenantId: tenant.id,
        actorUserId: userId,
        event: 'PASSWORD_CHANGED',
        objectType: 'user',
        recordId: userId,
        metadata: { action: 'account.admin_bootstrap', script: 'ensure-workspace-admin', employeeNumber },
      },
    })
    .catch((error) => console.warn(`Audit row not written: ${error.message}`));

  console.log('');
  console.log(`  Workspace          ${tenant.displayName} (${slug})`);
  console.log(`  Name               ${fullName}`);
  console.log(`  Sign in with       ${email}`);
  console.log(`  Employee code      ${employeeNumber}`);
  console.log(`  Role               ${role.name} (${role.key}, rank ${role.rank})`);
  console.log(`  Employee record    ${employeeId ?? 'none'}`);
  console.log('');
  console.log(`  Temporary password ${temporaryPassword}`);
  console.log('');
  console.log('  Shown once. It is not stored anywhere in the clear and cannot be printed again.');
  console.log('  The account must set its own password at first sign-in before anything else opens.');
  });
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
