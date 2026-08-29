#!/usr/bin/env node
/**
 * Provisions and manages the anonymous platform service identity — the machine
 * account that reads across every workspace for background and AI work.
 *
 * Two credential paths, deliberately separate (see §9 of the brief):
 *
 *   machine       `lf_svc_…` bearer token, per-request scoping, no session
 *   interactive   username + password + TOTP, short browser session
 *
 * Revoking one does not revoke the other. That is the point: a leaked token and
 * a compromised login are different incidents with different responses.
 *
 * Usage — the account itself:
 *   node scripts/platform-service-identity.mjs create-account
 *   node scripts/platform-service-identity.mjs status
 *
 * Usage — machine credentials:
 *   node scripts/platform-service-identity.mjs create --name "AI insights"      \
 *        --scopes leads:read,users:read,hrms:read --days 30 [--workspaces id,id]
 *   node scripts/platform-service-identity.mjs list
 *   node scripts/platform-service-identity.mjs rotate --id <credentialId> --days 30
 *   node scripts/platform-service-identity.mjs revoke --id <credentialId> --reason "..."
 *   node scripts/platform-service-identity.mjs revoke-all --reason "incident 4821"
 *
 * Usage — the interactive login:
 *   node scripts/platform-service-identity.mjs set-username --username ai.reader
 *   node scripts/platform-service-identity.mjs set-password
 *   node scripts/platform-service-identity.mjs set-session-scopes                \
 *        --scopes leads:read,users:read [--workspaces id,id]
 *   node scripts/platform-service-identity.mjs reset-mfa --reason "lost phone"
 *   node scripts/platform-service-identity.mjs revoke-sessions --reason "..."
 *   node scripts/platform-service-identity.mjs deactivate --reason "..."
 *   node scripts/platform-service-identity.mjs activate
 *   node scripts/platform-service-identity.mjs status
 *
 * No username and no password is hard-coded anywhere. `--username` is chosen by
 * the operator; the password is always generated here and printed once.
 *
 * ── Why the credential is minted here and not in the console ────────────────
 *
 * The secret is printed once, to a terminal, on a machine an operator is
 * already sitting at. There is no screen that can show it again and no endpoint
 * that returns it — which is the property that makes "rotate" meaningful. A
 * console button that mints one would put a cross-tenant read credential into a
 * browser session's response body and, from there, into whatever logs that
 * response passes through.
 *
 * ── The interactive login, and what still holds ─────────────────────────────
 *
 * A freshly created identity has no username, no password and no authenticator,
 * so it cannot be signed into at all — `set-username` and `set-password` are
 * deliberate acts, and MFA enrolment is forced at the first sign-in.
 *
 * It never reaches `POST /auth/login`: that route issues FULL sessions, and
 * `resolvePlatformCtx` refuses an AI_SERVICE identity holding one. The only way
 * in is `POST /auth/service-login`, which mints an AI_SERVICE-purpose session.
 *
 * Signing in buys no authority. The session is read-only, cannot be elevated by
 * a break-glass grant, and stays inside `serviceScopes` and
 * `serviceTenantAllowlist` — which is why `set-session-scopes` exists and why an
 * identity with none reads nothing.
 */
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const list = (name) =>
  (flag(name, '') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

/** Mirrors MAX_CREDENTIAL_DAYS in lib/auth/service-identity.ts. */
const MAX_DAYS = 90;
/** Mirrors the READ_SCOPE regex there. Only read scopes exist for this identity. */
const READ_SCOPE = /^[a-z][a-z0-9_]*:read$/;

/**
 * The identity's address. It is not a mailbox and never receives anything — the
 * column is unique and required, so it is a stable name rather than a contact.
 */
const IDENTITY_EMAIL = (process.env.PLATFORM_SERVICE_EMAIL ?? 'ai-service@platform.internal').trim().toLowerCase();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const client = new PrismaClient({ adapter });

async function identity() {
  return client.platformUser.upsert({
    where: { normalizedEmail: IDENTITY_EMAIL },
    // Never touches passwordHash: it stays null, and that is the thing stopping
    // an interactive sign-in. An update that set one would quietly turn this
    // into a loginable account.
    update: { status: 'ACTIVE', platformRole: 'AI_SERVICE' },
    create: {
      email: IDENTITY_EMAIL,
      normalizedEmail: IDENTITY_EMAIL,
      fullName: 'Platform service',
      status: 'ACTIVE',
      platformRole: 'AI_SERVICE',
      mfaEnabled: false,
    },
    select: { id: true, email: true },
  });
}

async function create() {
  const name = flag('name');
  const scopes = list('scopes');
  const days = Number(flag('days', '30'));
  const workspaces = list('workspaces');

  if (!name) fail('--name is required: it is how a rotation knows which credential it replaces.');
  if (scopes.length === 0) fail('--scopes is required. A credential with no scopes can read nothing.');
  const bad = scopes.filter((scope) => !READ_SCOPE.test(scope));
  if (bad.length) fail(`Only read scopes are grantable. Rejected: ${bad.join(', ')}`);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) fail(`--days must be between 1 and ${MAX_DAYS}.`);

  const service = await identity();
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86_400_000);

  const record = await client.platformServiceCredential.create({
    data: {
      platformUserId: service.id,
      name,
      prefix,
      // Same cost parameters as lib/auth/password.ts so the hash verifies at
      // request time.
      keyHash: await hash(secret, {
        memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19456),
        timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
        parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
      }),
      scopes,
      tenantAllowlist: workspaces,
      expiresAt,
    },
    select: { id: true },
  });

  console.log('');
  console.log(`  Identity      ${service.email}  (AI_SERVICE, no password, cannot sign in)`);
  console.log(`  Credential    ${record.id}  "${name}"`);
  console.log(`  Scopes        ${scopes.join(', ')}`);
  console.log(`  Workspaces    ${workspaces.length ? workspaces.join(', ') : 'all'}`);
  console.log(`  Expires       ${expiresAt.toISOString()}`);
  console.log('');
  console.log(`  Secret        lf_svc_${prefix}_${secret}`);
  console.log('');
  console.log('  Shown once. Store it in the secret manager; nothing can print it again.');
  console.log('  Send it as:   Authorization: Bearer <secret>');
  console.log('                x-workspace-id: <the workspace this request is about>');
  console.log('                x-initiated-by: <your job or operator id>   (recorded, unverified)');
  console.log('');
}

async function show() {
  const rows = await client.platformServiceCredential.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      tenantAllowlist: true,
      expiresAt: true,
      revokedAt: true,
      revokedReason: true,
      lastUsedAt: true,
      rotatedFromId: true,
    },
  });
  if (rows.length === 0) return console.log('No service credentials.');
  for (const row of rows) {
    const state = row.revokedAt
      ? `revoked ${row.revokedAt.toISOString()} (${row.revokedReason ?? 'no reason given'})`
      : row.expiresAt < new Date()
        ? `expired ${row.expiresAt.toISOString()}`
        : `live until ${row.expiresAt.toISOString()}`;
    console.log('');
    console.log(`  ${row.id}  "${row.name}"  lf_svc_${row.prefix}_…`);
    console.log(`     ${state}`);
    console.log(`     scopes      ${row.scopes.join(', ') || 'none'}`);
    console.log(`     workspaces  ${row.tenantAllowlist.length ? row.tenantAllowlist.join(', ') : 'all'}`);
    console.log(`     last used   ${row.lastUsedAt?.toISOString() ?? 'never'}`);
    if (row.rotatedFromId) console.log(`     rotated from ${row.rotatedFromId}`);
  }
  console.log('');
}

async function rotate() {
  const id = flag('id');
  const days = Number(flag('days', '30'));
  if (!id) fail('--id is required.');
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) fail(`--days must be between 1 and ${MAX_DAYS}.`);

  const current = await client.platformServiceCredential.findUnique({ where: { id } });
  if (!current) fail(`No credential ${id}.`);

  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86_400_000);

  const replacement = await client.platformServiceCredential.create({
    data: {
      platformUserId: current.platformUserId,
      name: current.name,
      prefix,
      keyHash: await hash(secret, {
        memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19456),
        timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
        parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
      }),
      scopes: current.scopes,
      tenantAllowlist: current.tenantAllowlist,
      expiresAt,
      rotatedFromId: current.id,
    },
    select: { id: true },
  });

  // The old one dies now rather than overlapping. Two live credentials for one
  // identity is the state in which "revoke it" and "rotate it" stop meaning the
  // same thing. A hand-over window is `create` then `revoke`, done knowingly.
  await client.platformServiceCredential.updateMany({
    where: { id: current.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: `Rotated to ${replacement.id}` },
  });

  console.log('');
  console.log(`  Replaced      ${current.id}  →  ${replacement.id}`);
  console.log(`  Expires       ${expiresAt.toISOString()}`);
  console.log(`  Secret        lf_svc_${prefix}_${secret}`);
  console.log('');
  console.log('  The previous credential stopped working the moment this printed.');
  console.log('');
}

async function revoke() {
  const id = flag('id');
  const reason = flag('reason');
  if (!id) fail('--id is required.');
  if (!reason) fail('--reason is required. A revocation with no reason explains nothing later.');
  const { count } = await client.platformServiceCredential.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  console.log(count ? `Revoked ${id}.` : `Nothing to do — ${id} was already revoked or does not exist.`);
}

async function revokeAll() {
  const reason = flag('reason');
  if (!reason) fail('--reason is required.');
  const service = await client.platformUser.findUnique({
    where: { normalizedEmail: IDENTITY_EMAIL },
    select: { id: true },
  });
  if (!service) return console.log('No service identity exists.');
  const { count } = await client.platformServiceCredential.updateMany({
    where: { platformUserId: service.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  console.log(`Revoked ${count} live credential(s).`);
}

// ── The interactive login ───────────────────────────────────────────────────

/**
 * Every audit row this script writes.
 *
 * Administering the account from a terminal is still administration, and it has
 * to land in the same protected log the console writes to — otherwise "who reset
 * this password" has an answer only when it was done through the UI.
 *
 * `actorUserId` is null: a shell has no platform session behind it. The operator
 * is named from `--operator` or the OS user, as an unverified label, because a
 * blank actor with no hint at all is worse than an honest one.
 */
async function audit(platformUserId, event, metadata = {}) {
  const operator = flag('operator', process.env.USERNAME || process.env.USER || null);
  await client.platformAuditEvent
    .create({
      data: {
        tenantId: null,
        actorUserId: null,
        event,
        objectType: 'platform_service_identity',
        objectId: platformUserId,
        metadata: { ...metadata, via: 'cli', declaredOperator: operator },
      },
    })
    .catch((err) => console.error('warning: audit write failed —', err.message));
}

/** The identity, or a clear error. Never creates one implicitly. */
async function existing() {
  const found = await client.platformUser.findUnique({
    where: { normalizedEmail: IDENTITY_EMAIL },
    select: {
      id: true,
      email: true,
      username: true,
      status: true,
      platformRole: true,
      mfaEnabled: true,
      lockedUntil: true,
      failedLoginCount: true,
      serviceScopes: true,
      serviceTenantAllowlist: true,
      passwordHash: true,
      lastLoginAt: true,
    },
  });
  if (!found) fail('No service identity exists yet. Run `create` first.');
  if (found.platformRole !== 'AI_SERVICE') fail(`${found.email} is not an AI_SERVICE identity. Refusing.`);
  return found;
}

/**
 * Creates the identity and nothing else.
 *
 * Separate from `create`, which mints a machine credential and upserts the
 * identity as a side effect. An operator who only wants the interactive login
 * should not have to mint a `lf_svc_` token they never intend to use — issuing
 * a credential in order to avoid issuing a credential is how unused secrets end
 * up live in a database.
 */
async function createAccount() {
  const before = await client.platformUser.findUnique({
    where: { normalizedEmail: IDENTITY_EMAIL },
    select: { id: true },
  });
  const service = await identity();
  if (before) {
    console.log(`Identity already exists: ${service.email} (${service.id}). Nothing changed.`);
  } else {
    await audit(service.id, 'SERVICE_IDENTITY_CREATED', { email: service.email });
    console.log('');
    console.log(`  Created  ${service.email}  (AI_SERVICE)`);
    console.log('');
    console.log('  It cannot sign in yet: no username, no password, no authenticator.');
    console.log('  Next:  set-username  →  set-password  →  set-session-scopes');
    console.log('');
  }
}

async function setUsername() {
  const username = (flag('username') ?? '').trim().toLowerCase();
  if (!username) fail('--username is required.');
  // Same shape the login route accepts, checked here so a username that cannot
  // be used is refused at the point it is set rather than at first sign-in.
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    fail('Username must be 3–64 characters: letters, digits, dot, underscore or hyphen.');
  }
  const service = await existing();
  const clash = await client.platformUser.findUnique({ where: { username }, select: { id: true } });
  if (clash && clash.id !== service.id) fail(`The username "${username}" is already taken.`);

  await client.platformUser.update({ where: { id: service.id }, data: { username } });
  // A username change is a change to how the account is reached; live sessions
  // are ended so the next sign-in proves the new identifier.
  const { count } = await client.platformSession.updateMany({
    where: { platformUserId: service.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'USERNAME_CHANGED' },
  });
  await audit(service.id, 'USERNAME_CHANGED', { username, sessionsRevoked: count });
  console.log(`Username set to "${username}". ${count} session(s) revoked.`);
}

async function setPassword() {
  const service = await existing();
  if (!service.username) fail('Set a username first — the account cannot be signed into without one.');

  /**
   * Generated, never accepted as an argument.
   *
   * A password passed on a command line lands in shell history and in the
   * process list, which is the one leak this credential cannot afford. Same
   * reasoning as scripts/bootstrap-owner.mjs.
   */
  const password = `${randomBytes(12).toString('base64url')}-${randomBytes(3).toString('hex').toUpperCase()}`;

  await client.platformUser.update({
    where: { id: service.id },
    data: {
      passwordHash: await hash(password, {
        memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19456),
        timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
        parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
      }),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  const { count } = await client.platformSession.updateMany({
    where: { platformUserId: service.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
  });
  await audit(service.id, 'PASSWORD_RESET', { sessionsRevoked: count });

  console.log('');
  console.log(`  Username      ${service.username}`);
  console.log(`  Password      ${password}`);
  console.log('');
  console.log(`  Shown once. ${count} existing session(s) revoked.`);
  console.log(
    `  MFA is mandatory: ${service.mfaEnabled ? 'already enrolled' : 'enrol at /enroll-2fa after signing in'}.`,
  );
  console.log('');
}

async function setSessionScopes() {
  const scopes = list('scopes');
  const workspaces = list('workspaces');
  if (scopes.length === 0) fail('--scopes is required. An empty list lets an interactive session read nothing.');
  const bad = scopes.filter((scope) => !READ_SCOPE.test(scope));
  if (bad.length) fail(`Only read scopes are grantable. Rejected: ${bad.join(', ')}`);

  const service = await existing();
  await client.platformUser.update({
    where: { id: service.id },
    data: { serviceScopes: scopes, serviceTenantAllowlist: workspaces },
  });
  await audit(service.id, 'SERVICE_SCOPES_CHANGED', { scopes, workspaces: workspaces.length ? workspaces : 'all' });
  console.log(`Interactive session scopes: ${scopes.join(', ')}`);
  console.log(`Workspaces: ${workspaces.length ? workspaces.join(', ') : 'all'}`);
  console.log('Applied on the next request — existing sessions re-read this every time.');
}

async function resetMfa() {
  const reason = flag('reason');
  if (!reason) fail('--reason is required.');
  const service = await existing();

  await client.platformUser.update({
    where: { id: service.id },
    data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] },
  });
  await client.authenticationFactor.deleteMany({ where: { platformUserId: service.id, type: 'TOTP' } });
  const { count } = await client.platformSession.updateMany({
    where: { platformUserId: service.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'MFA_RESET' },
  });
  await audit(service.id, 'MFA_RESET', { reason, sessionsRevoked: count });

  console.log(`Authenticator and recovery codes cleared. ${count} session(s) revoked.`);
  console.log('This is not a bypass: the next sign-in issues an enrolment grant that reaches');
  console.log('/enroll-2fa and nothing else. The new QR code and recovery codes appear there.');
}

async function revokeSessions() {
  const reason = flag('reason') ?? 'REVOKED_BY_OPERATOR';
  const service = await existing();
  const { count } = await client.platformSession.updateMany({
    where: { platformUserId: service.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'SESSIONS_REVOKED' },
  });
  await audit(service.id, 'SESSIONS_REVOKED', { reason, sessionsRevoked: count });
  console.log(`Revoked ${count} session(s). Machine credentials are untouched — use revoke-all for those.`);
}

async function setActive(active) {
  const reason = flag('reason') ?? (active ? 'REACTIVATED' : 'DEACTIVATED');
  const service = await existing();
  await client.platformUser.update({
    where: { id: service.id },
    data: { status: active ? 'ACTIVE' : 'DEACTIVATED', ...(active ? { failedLoginCount: 0, lockedUntil: null } : {}) },
  });
  let count = 0;
  if (!active) {
    // Deactivation stops both paths at once: resolvePlatformCtx refuses a
    // non-ACTIVE identity, and so does requirePlatformServiceActor.
    ({ count } = await client.platformSession.updateMany({
      where: { platformUserId: service.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_DEACTIVATED' },
    }));
  }
  await audit(service.id, active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', { reason, sessionsRevoked: count });
  console.log(
    active
      ? 'Account reactivated. Both the login and any unrevoked machine credentials work again.'
      : `Account deactivated. ${count} session(s) revoked; machine credentials stop working too.`,
  );
}

async function status() {
  const service = await existing();
  const live = await client.platformSession.count({
    where: { platformUserId: service.id, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  const credentials = await client.platformServiceCredential.count({
    where: { platformUserId: service.id, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  const locked = service.lockedUntil && service.lockedUntil > new Date();

  console.log('');
  console.log(`  Identity            ${service.email}`);
  console.log(`  Role                ${service.platformRole}`);
  console.log(
    `  Status              ${service.status}${locked ? `  (LOCKED until ${service.lockedUntil.toISOString()})` : ''}`,
  );
  console.log('');
  console.log('  Interactive login');
  console.log(`    username          ${service.username ?? 'not set'}`);
  console.log(`    password          ${service.passwordHash ? 'set' : 'not set — cannot sign in'}`);
  console.log(
    `    MFA               ${service.mfaEnabled ? 'enrolled' : 'NOT enrolled — enrolment forced at next sign-in'}`,
  );
  console.log(`    failed attempts   ${service.failedLoginCount}`);
  console.log(`    live sessions     ${live}`);
  console.log(`    session scopes    ${service.serviceScopes.join(', ') || 'none — reads nothing'}`);
  console.log(
    `    session workspaces ${service.serviceTenantAllowlist.length ? service.serviceTenantAllowlist.join(', ') : 'all'}`,
  );
  console.log(`    last sign-in      ${service.lastLoginAt?.toISOString() ?? 'never'}`);
  console.log('');
  console.log('  Machine access');
  console.log(`    live credentials  ${credentials}`);
  console.log('');
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

const commands = {
  'create-account': createAccount,
  create,
  list: show,
  rotate,
  revoke,
  'revoke-all': revokeAll,
  'set-username': setUsername,
  'set-password': setPassword,
  'set-session-scopes': setSessionScopes,
  'reset-mfa': resetMfa,
  'revoke-sessions': revokeSessions,
  deactivate: () => setActive(false),
  activate: () => setActive(true),
  status,
};

if (!commands[command]) {
  console.error('Usage: platform-service-identity.mjs <command> [flags]');
  console.error('');
  console.error('  Account:             create-account | status');
  console.error('  Machine access:      create | list | rotate | revoke | revoke-all');
  console.error('  Interactive login:   set-username | set-password | set-session-scopes');
  console.error('                       reset-mfa | revoke-sessions | deactivate | activate');
  console.error('  Both:                status');
  console.error('');
  console.error('See the header comment in this file for the full flag list.');
  process.exit(2);
}

commands[command]()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
