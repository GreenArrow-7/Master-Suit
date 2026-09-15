#!/usr/bin/env node
/**
 * Creates or resets the first Platform Owner on a deployed environment, and
 * prints a temporary password exactly once.
 *
 * Usage:
 *   node scripts/bootstrap-owner.mjs --email owner@example.com
 *   node scripts/bootstrap-owner.mjs                # takes PLATFORM_OWNER_EMAIL
 *   node scripts/bootstrap-owner.mjs --email x@y --promote-existing
 *
 * ── It does not promote an existing account unless told to ─────────────────
 *
 * An address that already belongs to someone — a customer's administrator, an
 * employee — is not quietly made the platform owner and given a new password.
 * That used to happen: the upsert's update branch set platformRole OWNER and
 * replaced the password of whatever account the address named. Promoting an
 * existing person is a decision; `--promote-existing` is where it is made, and on
 * a running platform the owner console's role change (audited, by another owner)
 * is the better place. Resetting an account that is already the owner needs no
 * flag.
 *
 * It never sets a monitoring password. The account holder sets one themselves,
 * from the console, after signing in with the administration password and MFA.
 *
 * ── Why this exists separately from the seed ───────────────────────────────
 *
 * The demo seed also upserts a Platform Owner, but it refuses to run when
 * NODE_ENV is production — and rightly: pointed at a live database it is a mass
 * insert of fictional people with working logins. That left a deployed
 * environment with no way to create the account that everything else is
 * administered from. This is that way, and it writes exactly one row.
 *
 * Like scripts/ensure-workspace-admin.mjs, the password is generated here and
 * shown once. It is never written in the clear, never mailed, and not accepted
 * as an argument: a password passed on a command line ends up in shell history
 * and in the process list, which is the one leak this account cannot afford.
 */
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};

const email = (flag('email', process.env.PLATFORM_OWNER_EMAIL) ?? '').trim().toLowerCase();
const fullName = flag('name', 'Platform Owner');

if (!email) {
  console.error('Usage: bootstrap-owner.mjs --email <address> [--name "..."]');
  console.error('   or: set PLATFORM_OWNER_EMAIL and run with no arguments.');
  process.exit(2);
}

/**
 * 23 characters from 15 bytes of CSPRNG entropy — the same shape
 * ensure-workspace-admin.mjs issues, for the same reason: this credential
 * reaches every workspace on the platform and may sit in a person's hands
 * longer than a routine reset does.
 */
const temporaryPassword = `${randomBytes(12).toString('base64url')}-${randomBytes(3).toString('hex').toUpperCase()}`;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const client = new PrismaClient({ adapter });

async function main() {
  // Same cost parameters as lib/auth/password.ts, read from the same env vars,
  // so a hash written here verifies at sign-in.
  const passwordHash = await hash(temporaryPassword, {
    memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19456),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
  });

  const existing = await client.platformUser.findUnique({
    where: { normalizedEmail: email },
    select: { id: true, platformRole: true, deletedAt: true },
  });
  if (existing && existing.platformRole !== 'OWNER' && !argv.includes('--promote-existing')) {
    console.error('');
    console.error(`  ${email} already belongs to an account (platform role ${existing.platformRole}).`);
    console.error('  Refusing to promote it to platform owner and replace its password.');
    console.error('  If that is intended, re-run with --promote-existing, or have another owner');
    console.error('  change its role from the platform console.');
    console.error('');
    process.exitCode = 2;
    return;
  }

  const owner = await client.platformUser.upsert({
    where: { normalizedEmail: email },
    /**
     * passwordChangedAt stays null on purpose.
     *
     * Null means "still on a credential an administrator issued", which the
     * application refuses to look past — so the first sign-in has to set a
     * password of the account holder's own choosing. The seed stamps a date
     * instead, because a seeded credential is the account's own from the first
     * minute; one printed to a terminal is not.
     */
    // A new passwordVersion ends every administration session and unfinished
    // sign-in issued under the old password, on their next use.
    update: {
      passwordHash,
      passwordVersion: { increment: 1 },
      passwordChangedAt: null,
      platformRole: 'OWNER',
      status: 'ACTIVE',
    },
    create: {
      email,
      normalizedEmail: email,
      fullName,
      passwordHash,
      passwordChangedAt: null,
      emailVerifiedAt: new Date(),
      status: 'ACTIVE',
      platformRole: 'OWNER',
      mfaEnabled: false,
    },
    select: { id: true },
  });

  // A reset that leaves live sessions alone is pointless in the one case it
  // matters — the account is being recovered because someone else may hold it.
  const revoked = existing
    ? await client.platformSession.updateMany({
        where: { platformUserId: owner.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
      })
    : { count: 0 };
  if (existing) {
    await client.platformMfaChallenge.deleteMany({ where: { platformUserId: owner.id, consumedAt: null } });
  }

  console.log('');
  console.log(`  ${existing ? 'Reset' : 'Created'} Platform Owner  ${email}`);
  console.log(`  Temporary password   ${temporaryPassword}`);
  if (revoked.count > 0) console.log(`  Sessions revoked     ${revoked.count}`);
  console.log('');
  console.log('  Shown once. Sign in and the application will require a new password.');
  console.log('');
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
