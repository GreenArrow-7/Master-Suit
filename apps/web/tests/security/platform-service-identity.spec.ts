/**
 * The anonymous platform service identity, tested at the two bars that matter:
 *
 *   1. **It really is read-only, and really is scoped.** Not "the permission map
 *      looks right" — the actual API kernel is called with the actual credential
 *      and has to refuse the writes and the out-of-scope reads.
 *   2. **It really is audited.** Every request writes a PlatformAuditEvent. The
 *      whole design rests on that trade — invisible as a tenant user, fully
 *      traceable in the protected log — so a silent gap here is the failure that
 *      matters most.
 *
 * And the invisibility itself is asserted the only way it can honestly be: by
 * confirming there is no WorkspaceMembership and no User row, so the tenant-side
 * queries have nothing to return rather than a filter that has to remember.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { clear as clearLimit, limits } from '@/lib/security/ratelimit';
import {
  issueServiceCredential,
  revokeServiceCredential,
  rotateServiceCredential,
  MAX_CREDENTIAL_DAYS,
} from '@/lib/auth/service-identity';
import { seedTwoTenants, grantPermissions, type Fixture, type TenantFixture } from '../helpers/fixtures';
import { GET as listLeads, POST as createLead } from '@/app/api/v1/leads/route';
import { GET as listAccounts } from '@/app/api/v1/accounts/route';
import { GET as identity } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/[action]/route';
import { POST as login } from '@/app/api/v1/auth/login/route';

const suffix = randomBytes(4).toString('hex');
const email = `svc.${suffix}@platform.test`;

let fx: Fixture;
let identityId = '';
let secret = '';
let credentialId = '';

/** A request as the service would make it: bearer credential + named workspace. */
function call(
  // `params` is `any` for the reason tests/helpers/request.ts gives: each route
  // declares its own literal params shape, and a Record is not assignable to
  // those.
  handler: (req: Request, ctx: { params: Promise<any> }) => Promise<Response>,
  path: string,
  options: { secret?: string; tenantId?: string; method?: string; body?: unknown; initiator?: string } = {},
) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.secret ?? secret}`,
  };
  if (options.tenantId !== undefined) headers['x-workspace-id'] = options.tenantId;
  if (options.initiator) headers['x-initiated-by'] = options.initiator;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  return handler(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    }),
    { params: Promise.resolve({}) },
  ).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
}

/**
 * The workspace user directory, which lives behind a two-segment dynamic route
 * rather than a flat one — so its params cannot be inferred from the path.
 */
function callUsers(credential: string, tenant: TenantFixture) {
  return identity(
    new Request(`http://localhost/api/v1/workspaces/${tenant.slug}/identity/accounts`, {
      headers: { authorization: `Bearer ${credential}`, 'x-workspace-id': tenant.tenantId },
    }),
    { params: Promise.resolve({ workspaceSlug: tenant.slug, action: 'accounts' }) },
  ).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
}

/**
 * The field messages behind a 422.
 *
 * `Invalid()` builds an AppError whose `message` is only the summary — "1 field
 * failed validation" — so asserting on the message tests nothing about *which*
 * rule fired. The reasons live in `errors`.
 */
async function rejection(promise: Promise<unknown>): Promise<{ status: number; reasons: string }> {
  try {
    await promise;
    throw new Error('expected a rejection, got none');
  } catch (err) {
    const app = err as { status?: number; errors?: { message: string }[]; message?: string };
    return {
      status: app.status ?? 0,
      reasons: (app.errors ?? []).map((e) => e.message).join(' | ') || (app.message ?? ''),
    };
  }
}

const auditRows = (tenantId: string) =>
  prisma.platformAuditEvent.findMany({
    where: { tenantId, actorUserId: identityId, event: 'SERVICE_READ' },
    orderBy: { occurredAt: 'desc' },
  });

beforeAll(async () => {
  fx = await seedTwoTenants();

  // The fixture's admin role covers the Sales modules only, so it cannot read
  // the user directory as shipped. The invisibility assertion below has to run
  // as somebody who *can* see that list — otherwise a 403 would pass for the
  // same reason an empty list would, and prove nothing.
  const admin = await prisma.user.findFirstOrThrow({
    where: { id: fx.a.userId, tenantId: fx.a.tenantId },
    select: { roleId: true },
  });
  await grantPermissions(fx.a.tenantId, admin.roleId, [['users', 'VIEW']]);

  const serviceIdentity = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: 'Platform service',
      // No passwordHash. This is the thing that makes it non-interactive.
      status: 'ACTIVE',
      platformRole: 'AI_SERVICE',
    },
  });
  identityId = serviceIdentity.id;

  const issued = await issueServiceCredential({
    platformUserId: serviceIdentity.id,
    name: `spec-${suffix}`,
    scopes: ['leads:read'],
    days: 7,
  });
  secret = issued.secret;
  credentialId = issued.id;
});

afterAll(async () => {
  await prisma.platformAuditEvent.deleteMany({ where: { actorUserId: identityId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: email } }).catch(() => {});
  await fx?.cleanup();
});

describe('cross-tenant read access', () => {
  it('reads leads in a workspace it holds no membership in', async () => {
    const res = await call(listLeads, '/api/v1/leads', { tenantId: fx.a.tenantId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.data ?? res.body.items ?? res.body)).toBe(true);
  });

  it('reads a second, unrelated workspace with the same credential', async () => {
    const res = await call(listLeads, '/api/v1/leads', { tenantId: fx.b.tenantId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('refuses a request that does not name a workspace', async () => {
    const res = await call(listLeads, '/api/v1/leads', {});
    expect(res.status).toBe(422);
  });
});

describe('read-only by construction', () => {
  it('refuses a write to a module it can read', async () => {
    const res = await call(createLead, '/api/v1/leads', {
      tenantId: fx.a.tenantId,
      method: 'POST',
      body: { fullName: 'Should Not Exist', phone: '+971500000000', stageId: fx.a.stageId },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);

    const leaked = await prisma.lead.findFirst({
      where: { tenantId: fx.a.tenantId, fullName: 'Should Not Exist' },
    });
    expect(leaked).toBeNull();
  });

  it('a break-glass grant does not elevate it — that path is OWNER-only', async () => {
    await prisma.platformAccessGrant.create({
      data: {
        tenantId: fx.a.tenantId,
        platformUserId: identityId,
        reason: 'attempting to elevate a machine identity',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const res = await call(createLead, '/api/v1/leads', {
      tenantId: fx.a.tenantId,
      method: 'POST',
      body: { fullName: 'Still Should Not Exist', phone: '+971500000001', stageId: fx.a.stageId },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    await prisma.platformAccessGrant.deleteMany({ where: { platformUserId: identityId } });
  });

  it('refuses to mint a credential carrying a write scope', async () => {
    const { status, reasons } = await rejection(
      issueServiceCredential({ platformUserId: identityId, name: 'writer', scopes: ['leads:write'], days: 7 }),
    );
    expect(status).toBe(422);
    expect(reasons).toMatch(/only read scopes/i);
    expect(reasons).toContain('leads:write');
  });

  it('refuses a credential with no scopes at all — an omitted argument reads nothing', async () => {
    const { status, reasons } = await rejection(
      issueServiceCredential({ platformUserId: identityId, name: 'empty', scopes: [], days: 7 }),
    );
    expect(status).toBe(422);
    expect(reasons).toMatch(/can read nothing/i);
  });

  it('refuses a credential that outlives the ceiling', async () => {
    const { status, reasons } = await rejection(
      issueServiceCredential({
        platformUserId: identityId,
        name: 'forever',
        scopes: ['leads:read'],
        days: MAX_CREDENTIAL_DAYS + 1,
      }),
    );
    expect(status).toBe(422);
    expect(reasons).toContain(String(MAX_CREDENTIAL_DAYS));
  });
});

describe('least privilege', () => {
  it('a leads-only credential cannot read another module', async () => {
    const res = await call(listAccounts, '/api/v1/accounts', { tenantId: fx.a.tenantId });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('a leads-only credential cannot read the workspace user directory', async () => {
    const res = await callUsers(secret, fx.a);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('a credential scoped to users:read can — the scope is what decides', async () => {
    const wider = await issueServiceCredential({
      platformUserId: identityId,
      name: `wider-${suffix}`,
      scopes: ['leads:read', 'users:read'],
      days: 7,
    });
    const res = await callUsers(wider.secret, fx.a);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // …and still cannot write, whatever the scope list says.
    const write = await call(createLead, '/api/v1/leads', {
      secret: wider.secret,
      tenantId: fx.a.tenantId,
      method: 'POST',
      body: { fullName: 'Nope', phone: '+971500000002', stageId: fx.a.stageId },
    });
    expect(write.status).toBe(403);
    await revokeServiceCredential(wider.id, 'spec cleanup');
  });

  it('honours a workspace allowlist', async () => {
    const pinned = await issueServiceCredential({
      platformUserId: identityId,
      name: `pinned-${suffix}`,
      scopes: ['leads:read'],
      tenantAllowlist: [fx.a.tenantId],
      days: 7,
    });
    expect((await call(listLeads, '/api/v1/leads', { secret: pinned.secret, tenantId: fx.a.tenantId })).status).toBe(
      200,
    );
    expect((await call(listLeads, '/api/v1/leads', { secret: pinned.secret, tenantId: fx.b.tenantId })).status).toBe(
      403,
    );
    await revokeServiceCredential(pinned.id, 'spec cleanup');
  });
});

describe('credential lifecycle', () => {
  it('a revoked credential stops working immediately', async () => {
    const throwaway = await issueServiceCredential({
      platformUserId: identityId,
      name: `throwaway-${suffix}`,
      scopes: ['leads:read'],
      days: 7,
    });
    expect((await call(listLeads, '/api/v1/leads', { secret: throwaway.secret, tenantId: fx.a.tenantId })).status).toBe(
      200,
    );
    await revokeServiceCredential(throwaway.id, 'spec');
    expect((await call(listLeads, '/api/v1/leads', { secret: throwaway.secret, tenantId: fx.a.tenantId })).status).toBe(
      401,
    );
  });

  it('an expired credential stops working', async () => {
    const expiring = await issueServiceCredential({
      platformUserId: identityId,
      name: `expiring-${suffix}`,
      scopes: ['leads:read'],
      days: 1,
    });
    await prisma.platformServiceCredential.update({
      where: { id: expiring.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await call(listLeads, '/api/v1/leads', { secret: expiring.secret, tenantId: fx.a.tenantId })).status).toBe(
      401,
    );
  });

  it('rotation issues a working replacement and kills the old one', async () => {
    const original = await issueServiceCredential({
      platformUserId: identityId,
      name: `rotating-${suffix}`,
      scopes: ['leads:read'],
      days: 7,
    });
    const replacement = await rotateServiceCredential(original.id, 7);

    expect(
      (await call(listLeads, '/api/v1/leads', { secret: replacement.secret, tenantId: fx.a.tenantId })).status,
    ).toBe(200);
    expect((await call(listLeads, '/api/v1/leads', { secret: original.secret, tenantId: fx.a.tenantId })).status).toBe(
      401,
    );

    const row = await prisma.platformServiceCredential.findUnique({ where: { id: replacement.id } });
    expect(row?.rotatedFromId).toBe(original.id);
    expect(row?.scopes).toEqual(['leads:read']);
    await revokeServiceCredential(replacement.id, 'spec cleanup');
  });

  it('deactivating the identity stops every credential it holds', async () => {
    await prisma.platformUser.update({ where: { id: identityId }, data: { status: 'DEACTIVATED' } });
    expect((await call(listLeads, '/api/v1/leads', { tenantId: fx.a.tenantId })).status).toBe(401);
    await prisma.platformUser.update({ where: { id: identityId }, data: { status: 'ACTIVE' } });
    expect((await call(listLeads, '/api/v1/leads', { tenantId: fx.a.tenantId })).status).toBe(200);
  });

  it('refuses to issue a credential against a human platform account', async () => {
    // A credential bypasses the password and the authenticator; pointed at a
    // person's platform account it would be a way to hold that account's
    // authority without either.
    const humanEmail = `human.${suffix}@platform.test`;
    const human = await prisma.platformUser.create({
      data: {
        email: humanEmail,
        normalizedEmail: humanEmail,
        fullName: 'A Real Owner',
        passwordHash: await hashPassword('IrrelevantPass-2026'),
        status: 'ACTIVE',
        platformRole: 'OWNER',
      },
    });
    await expect(
      issueServiceCredential({ platformUserId: human.id, name: 'hijack', scopes: ['leads:read'], days: 7 }),
    ).rejects.toThrow(/AI_SERVICE/);
    await prisma.platformUser.delete({ where: { id: human.id } });
  });
});

describe('no interactive login', () => {
  it('the login route refuses the identity outright — it holds no password', async () => {
    await clearLimit(limits.loginPerAccount(email));
    await clearLimit(limits.loginPerIp('unknown'));
    const res = await login(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'anything-at-all' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('holds no password hash to be reset into one by accident', async () => {
    const row = await prisma.platformUser.findUnique({
      where: { id: identityId },
      select: { passwordHash: true },
    });
    expect(row?.passwordHash).toBeNull();
  });
});

describe('invisible to the tenant, by absence rather than by filter', () => {
  it('holds no workspace membership and no workspace user row', async () => {
    expect(await prisma.workspaceMembership.count({ where: { platformUserId: identityId } })).toBe(0);
    // Every tenant-facing list — users, org chart, member management, search —
    // reads `User` scoped by tenantId. No row means nothing to filter out.
    for (const tenantId of [fx.a.tenantId, fx.b.tenantId]) {
      expect(await prisma.user.count({ where: { tenantId, email } })).toBe(0);
    }
  });

  it('does not appear in the workspace user directory the admin actually sees', async () => {
    const res = await identity(
      new Request(`http://localhost/api/v1/workspaces/${fx.a.slug}/identity/accounts`, {
        headers: { cookie: fx.a.cookie },
      }),
      { params: Promise.resolve({ workspaceSlug: fx.a.slug, action: 'accounts' }) },
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(email);
  });
});

describe('auditing', () => {
  it('writes a protected platform audit row for every request', async () => {
    const before = (await auditRows(fx.a.tenantId)).length;
    await call(listLeads, '/api/v1/leads', { tenantId: fx.a.tenantId, initiator: 'nightly-insights-job' });
    await call(listLeads, '/api/v1/leads', { tenantId: fx.a.tenantId, initiator: 'nightly-insights-job' });
    const after = await auditRows(fx.a.tenantId);
    expect(after.length).toBe(before + 2);

    const latest = after[0];
    expect(latest.tenantId).toBe(fx.a.tenantId);
    expect(latest.actorUserId).toBe(identityId);
    expect(latest.objectType).toBe('leads');
    expect(latest.requestId).toBeTruthy();
    const meta = latest.metadata as Record<string, unknown>;
    expect(meta.action).toBe('VIEW');
    expect(meta.path).toBe('/api/v1/leads');
    expect(meta.credentialId).toBe(credentialId);
    expect(meta.declaredInitiator).toBe('nightly-insights-job');
  });

  it('records refused requests too, so probing is visible', async () => {
    const before = (await auditRows(fx.a.tenantId)).length;
    const res = await call(listAccounts, '/api/v1/accounts', { tenantId: fx.a.tenantId });
    expect(res.status).toBe(403);

    const after = await auditRows(fx.a.tenantId);
    expect(after.length).toBe(before + 1);
    expect((after[0].metadata as Record<string, unknown>).status).toBe(403);
  });

  it('never writes the credential secret into the audit trail', async () => {
    const serialised = JSON.stringify(await auditRows(fx.a.tenantId));
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain('keyHash');
  });

  it('audits the second workspace under that workspace, not the first', async () => {
    await call(listLeads, '/api/v1/leads', { tenantId: fx.b.tenantId });
    const rows = await auditRows(fx.b.tenantId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenantId === fx.b.tenantId)).toBe(true);
  });
});
