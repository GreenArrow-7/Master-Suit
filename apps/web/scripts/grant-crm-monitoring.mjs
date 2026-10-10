#!/usr/bin/env node
/**
 * Issues ONE standing platform-wide CRM monitoring entitlement, and changes
 * nothing else.
 *
 * Usage (dry run — inspects and prints the plan, writes nothing):
 *   node scripts/grant-crm-monitoring.mjs --email owner@example.com
 *
 * Apply (refused unless the identity is the one you expect):
 *   node scripts/grant-crm-monitoring.mjs --email owner@example.com \
 *     --expect-id <platformUserId> --reason "who authorised it, and why" --apply
 *
 * Revoke:
 *   node scripts/grant-crm-monitoring.mjs --email owner@example.com --revoke \
 *     --expect-id <platformUserId> --reason "why it ends" --apply
 *
 * ── Why a script and not the console ───────────────────────────────────────
 *
 * The same reasoning as `platform-identity-email.mjs`: the console has no
 * screen that issues this, and possession of the database is already the
 * authority, so it is an operator act from a shell with the reason written down.
 * The per-workspace and operational-coverage grants keep their owner-only API
 * route; this is the standing entitlement, issued rarely and deliberately.
 *
 * ── What it does, exactly ──────────────────────────────────────────────────
 *
 *   1. Loads the identity by address. Stops unless it exists, is ACTIVE, is
 *      platform staff, and is the id named by --expect-id.
 *   2. Stops if a live CRM_MONITORING grant already exists — two live grants
 *      means two expiry dates, and "when does this end" stops having one answer.
 *   3. Writes one PlatformCoverageGrant: kind CRM_MONITORING, the stated reason,
 *      an expiry (90 days by default, 365 at most), `sensitive` false.
 *   4. Writes one PlatformAuditEvent (MONITORING_COVERAGE_GRANTED), the same
 *      event the API route writes, so both paths land in one stream.
 *   5. Re-reads and refuses to commit unless exactly one live grant now exists.
 *
 * What it never does: touch passwords, MFA, role, status, memberships, other
 * grants, or any business record. It cannot widen authority — a monitoring
 * session is read-only over `MONITORING_MODULES` whatever grants it holds, and
 * `sensitive` stays false, so recordings, transcripts and documents are still
 * a separate ask.
 *
 * Nothing secret is printed.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};
const has = (name) => argv.includes(`--${name}`);

const email = (flag('email') ?? '').trim().toLowerCase();
const expectId = (flag('expect-id') ?? '').trim();
const reason = (flag('reason') ?? '').trim();
const days = Number(flag('days') ?? 90);
const apply = has('apply');
const revoke = has('revoke');

const MIN_REASON = 12;
const MAX_DAYS = 365;

const die = (message) => {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
};

if (!email) die('--email is required');
if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) die(`--days must be between 1 and ${MAX_DAYS}`);
if (apply && !expectId) die('--apply needs --expect-id, so a mistyped address cannot land on somebody else');
if (apply && reason.length < MIN_REASON) die(`--apply needs --reason of at least ${MIN_REASON} characters`);

const url = process.env.DATABASE_URL;
if (!url) die('DATABASE_URL is not set');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const STAFF = ['OWNER', 'SUPPORT', 'SECURITY_AUDITOR'];

try {
  const identity = await prisma.platformUser.findFirst({
    where: { normalizedEmail: email, deletedAt: null },
    select: { id: true, email: true, platformRole: true, status: true },
  });
  if (!identity) die(`no platform identity with the address ${email}`);
  if (identity.status !== 'ACTIVE') die(`${email} is ${identity.status}, not ACTIVE`);
  if (!STAFF.includes(identity.platformRole)) die(`${email} is ${identity.platformRole}; monitoring is for platform staff`);
  if (expectId && identity.id !== expectId) die(`${email} is ${identity.id}, not the expected ${expectId}`);

  const live = await prisma.platformCoverageGrant.findMany({
    where: { platformUserId: identity.id, kind: 'CRM_MONITORING', revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, reason: true, expiresAt: true, sensitive: true },
    orderBy: { expiresAt: 'desc' },
  });

  console.log('identity:', JSON.stringify(identity));
  console.log('live CRM_MONITORING grants:', live.length, live.map((g) => g.expiresAt.toISOString()).join(' '));

  if (revoke) {
    if (live.length === 0) {
      console.log('plan: nothing to revoke — no live entitlement.');
    } else {
      console.log(`plan: revoke ${live.length} live entitlement(s) for ${identity.email}.`);
    }
    if (!apply) {
      console.log('DRY RUN — nothing was written.');
    } else {
      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.platformCoverageGrant.updateMany({
          where: { platformUserId: identity.id, kind: 'CRM_MONITORING', revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: reason },
        });
        await tx.platformAuditEvent.create({
          data: {
            actorUserId: identity.id,
            event: 'MONITORING_COVERAGE_REVOKED',
            objectType: 'platform_user',
            objectId: identity.id,
            metadata: {
              subject: identity.email,
              kind: 'CRM_MONITORING',
              reason,
              revoked: count,
              performedBy: 'scripts/grant-crm-monitoring.mjs (operator shell)',
            },
          },
        });
        return count;
      });
      console.log(`APPLIED: revoked ${result} entitlement(s).`);
    }
  } else {
    if (live.length > 0) die(`${email} already holds a live entitlement until ${live[0].expiresAt.toISOString()}; revoke it first`);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000);
    console.log(
      `plan: issue CRM_MONITORING to ${identity.email} (${identity.id}) until ${expiresAt.toISOString()}, sensitive=false; 1 audit event.`,
    );
    if (!apply) {
      console.log('DRY RUN — nothing was written. Re-run with --expect-id, --reason and --apply to issue it.');
    } else {
      const grant = await prisma.$transaction(async (tx) => {
        const created = await tx.platformCoverageGrant.create({
          data: {
            platformUserId: identity.id,
            grantedById: identity.id,
            kind: 'CRM_MONITORING',
            sensitive: false,
            reason,
            expiresAt,
          },
          select: { id: true, expiresAt: true, kind: true, sensitive: true },
        });
        await tx.platformAuditEvent.create({
          data: {
            actorUserId: identity.id,
            event: 'MONITORING_COVERAGE_GRANTED',
            objectType: 'platform_user',
            objectId: identity.id,
            metadata: {
              subject: identity.email,
              kind: 'CRM_MONITORING',
              reason,
              expiresAt: created.expiresAt.toISOString(),
              performedBy: 'scripts/grant-crm-monitoring.mjs (operator shell)',
            },
          },
        });
        const after = await tx.platformCoverageGrant.count({
          where: { platformUserId: identity.id, kind: 'CRM_MONITORING', revokedAt: null, expiresAt: { gt: new Date() } },
        });
        if (after !== 1) throw new Error(`refusing to commit: ${after} live entitlements after the write, expected 1`);
        return created;
      });
      console.log('APPLIED:', JSON.stringify(grant));
      console.log('The monitoring password now lists every ACTIVE workspace. Read-only; CRM modules only.');
    }
  }
} finally {
  await prisma.$disconnect();
}
