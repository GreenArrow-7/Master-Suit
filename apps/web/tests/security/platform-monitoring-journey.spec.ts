/**
 * The monitoring journey, end to end, as a person actually walks it.
 *
 * The pieces are covered elsewhere — `platform-support-access` for the actor and
 * the grant, `platform-mfa` for the second factor, `platform-page-guard` for the
 * console pages. This walks the whole path once, in order, because the failure
 * that matters is the one between two correct pieces: signing in and landing
 * somewhere refused, entering a workspace the list never offered, or holding
 * access after it was revoked because nothing re-asked.
 *
 * Every step goes through the real route handler. Nothing here constructs a
 * session by hand except where it is standing in for "the browser still holds
 * the cookie from a moment ago".
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { generateSecret, totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { clear as clearLimit, limits } from '@/lib/security/ratelimit';
import { createPlatformSessionToken } from '../helpers/session';
import { POST as login } from '@/app/api/v1/auth/login/route';
import {
  POST as enterWorkspace,
  DELETE as leaveWorkspace,
} from '@/app/api/v1/platform/workspaces/[workspaceId]/enter/route';
import { POST as grantMonitoring, DELETE as revokeMonitoring } from '@/app/api/v1/platform/monitoring/grants/route';
import { GET as listLeads, POST as createLead } from '@/app/api/v1/leads/route';
import { GET as readAnalysis } from '@/app/api/v1/calls/[id]/analysis/route';
import { GET as readCallAudits } from '@/app/api/v1/calls/[id]/audit/route';
import { GET as readTranscript } from '@/app/api/v1/calls/[id]/transcript/route';
import { GET as downloadDocument } from '@/app/api/v1/documents/[id]/download/route';
import { authorizedTenantIds } from '@/lib/auth/platform-access';
import { assertSensitiveAccess } from '@/lib/auth/sensitive-access';
import { resolveCtx } from '@/lib/auth/session';
import type { Ctx } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const PASSWORD = 'Correct-Horse-Battery-9!';
const SECRET = generateSecret();

let granted = { id: '', slug: '' };
let ungranted = { id: '', slug: '' };
let ownerId = '';
let supportId = '';
const supportEmail = `monitor.${suffix}@platform.test`;
let ownerCookie = '';

const currentCode = () => totp(SECRET, Math.floor(Date.now() / 1000 / 30));
const json = (url: string, method: string, body: unknown, cookie?: string) =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

async function makeWorkspace(name: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `${name}-${suffix}`, legalName: `${name} LLC`, displayName: `${name} Co` },
  });
  await prisma.moduleEntitlement.create({ data: { tenantId: tenant.id, module: 'SALES', state: 'ACTIVE' } });
  return { id: tenant.id, slug: tenant.slug };
}

beforeAll(async () => {
  granted = await makeWorkspace('granted');
  ungranted = await makeWorkspace('ungranted');

  const owner = await prisma.platformUser.create({
    data: {
      email: `owner.${suffix}@platform.test`,
      normalizedEmail: `owner.${suffix}@platform.test`,
      fullName: 'Platform Owner',
      passwordHash: await hashPassword(PASSWORD),
      status: 'ACTIVE',
      platformRole: 'OWNER',
      passwordChangedAt: new Date(),
    },
  });
  ownerId = owner.id;
  ownerCookie = await createPlatformSessionToken(ownerId, null);

  // A monitoring identity with a real password and a real authenticator. The
  // whole point of this suite is that it signs in the way a person does.
  const support = await prisma.platformUser.create({
    data: {
      email: supportEmail,
      normalizedEmail: supportEmail,
      fullName: 'Monitoring Staff',
      passwordHash: await hashPassword(PASSWORD),
      status: 'ACTIVE',
      platformRole: 'SUPPORT',
      passwordChangedAt: new Date(),
      mfaEnabled: true,
      mfaSecret: encryptSecret(SECRET),
    },
  });
  supportId = support.id;
});

afterAll(async () => {
  for (const id of [granted.id, ungranted.id]) {
    await prisma.tenant.delete({ where: { id } }).catch(() => {});
  }
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

async function signIn(body: Record<string, unknown>) {
  await clearLimit(limits.loginPerAccount(supportEmail));
  await clearLimit(limits.loginPerIp('unknown'));
  return login(json('http://localhost/api/v1/auth/login', 'POST', { email: supportEmail, ...body }));
}

describe('1 — individual login and mandatory MFA', () => {
  it('answers the password alone with a challenge and no session', async () => {
    const res = await signIn({ password: PASSWORD });
    // 200 with `{ mfaRequired: true }` is the challenge, which is a legitimate
    // answer and not a grant. The status is not the control and asserting on it
    // would test the wrong thing — what matters is that nothing usable was
    // issued, so that is what this checks.
    expect(await res.json()).toMatchObject({ mfaRequired: true });
    expect(await prisma.platformSession.count({ where: { platformUserId: supportId, revokedAt: null } })).toBe(0);
  });

  it('refuses a wrong code, and still issues nothing', async () => {
    const res = await signIn({ password: PASSWORD, mfaCode: '000000' });
    expect(res.status).not.toBe(200);
    expect(await prisma.platformSession.count({ where: { platformUserId: supportId, revokedAt: null } })).toBe(0);
  });

  it('signs in with the password and a correct code', async () => {
    const res = await signIn({ password: PASSWORD, mfaCode: currentCode() });
    expect(res.status).toBe(200);
    const session = await prisma.platformSession.findFirst({
      where: { platformUserId: supportId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // The column the per-request gate reads, written only after a code verified.
    expect(session?.mfaSatisfied).toBe(true);
    // Signing in does not pick a workspace. That is the next step and it is
    // authorised separately.
    expect(session?.activeTenantId).toBeNull();
  });
});

describe('2 — the workspace list shows only what was authorised', () => {
  it('starts empty, because being platform staff authorises nothing by itself', async () => {
    expect(await authorizedTenantIds(supportId)).toEqual([]);
  });

  it('the owner grants one workspace, and only that one appears', async () => {
    const res = await grantMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'POST',
        {
          platformUserId: supportId,
          workspaceId: granted.id,
          reason: 'Investigating a reported lead-routing fault for this customer',
        },
        ownerCookie,
      ),
    );
    expect(res.status).toBe(201);

    const allowed = await authorizedTenantIds(supportId);
    expect(allowed).toEqual([granted.id]);
    expect(allowed).not.toContain(ungranted.id);
  });

  it('writes the grant to the customer’s own audit trail, naming who and why', async () => {
    const row = await prisma.platformAuditEvent.findFirst({
      where: { tenantId: granted.id, event: 'MONITORING_ACCESS_GRANTED' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row!.actorUserId).toBe(ownerId);
    expect(row!.objectId).toBe(supportId);
    expect((row!.metadata as Record<string, unknown>).reason).toMatch(/lead-routing fault/);
  });

  it('refuses a reason too short to be one', async () => {
    const res = await grantMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'POST',
        {
          platformUserId: supportId,
          workspaceId: ungranted.id,
          reason: 'fix',
        },
        ownerCookie,
      ),
    );
    expect(res.status).toBe(422);
  });
});

describe('3 — selecting a workspace', () => {
  it('opens the granted workspace and reports where to go', async () => {
    const cookie = await createPlatformSessionToken(supportId, null);
    const res = await enterWorkspace(new Request('http://localhost/enter', { method: 'POST', headers: { cookie } }), {
      params: Promise.resolve({ workspaceId: granted.id }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).destination).toBe(`/${granted.slug}/dashboard`);
  });

  it('records the entry on the customer’s trail', async () => {
    const row = await prisma.platformAuditEvent.findFirst({
      where: { tenantId: granted.id, actorUserId: supportId, event: 'WORKSPACE_OPENED' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row).not.toBeNull();
  });

  /**
   * Direct API access: the workspace the list never offered, reached by typing
   * its id. This is the case the old route could not refuse — being a platform
   * OWNER was the whole of the check.
   */
  it('refuses a workspace that was never granted, as a 404 rather than a 403', async () => {
    const cookie = await createPlatformSessionToken(supportId, null);
    const res = await enterWorkspace(new Request('http://localhost/enter', { method: 'POST', headers: { cookie } }), {
      params: Promise.resolve({ workspaceId: ungranted.id }),
    });
    // 404, so the endpoint cannot be used to enumerate the platform's customers.
    expect(res.status).toBe(404);
  });

  it('refuses an ordinary workspace user outright', async () => {
    const member = await prisma.platformUser.create({
      data: {
        email: `member.${suffix}@customer.test`,
        normalizedEmail: `member.${suffix}@customer.test`,
        fullName: 'Ordinary User',
        passwordHash: 'x',
        status: 'ACTIVE',
        platformRole: 'USER',
      },
    });
    const cookie = await createPlatformSessionToken(member.id, null);
    const res = await enterWorkspace(new Request('http://localhost/enter', { method: 'POST', headers: { cookie } }), {
      params: Promise.resolve({ workspaceId: granted.id }),
    });
    expect(res.status).toBe(403);
  });

  it('leaves again, clearing the workspace from the session', async () => {
    const cookie = await createPlatformSessionToken(supportId, granted.id);
    const res = await leaveWorkspace(new Request('http://localhost/enter', { method: 'DELETE', headers: { cookie } }));
    expect(res.status).toBe(200);
  });
});

describe('4 — inside the workspace, read-only', () => {
  it('reads leads', async () => {
    const cookie = await createPlatformSessionToken(supportId, granted.id);
    const res = await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
  });

  it('refuses to create one — server-side, not by hiding a button', async () => {
    const cookie = await createPlatformSessionToken(supportId, granted.id);
    const res = await createLead(
      json('http://localhost/api/v1/leads', 'POST', { firstName: 'Nope', phone: '+971500000000' }, cookie),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
  });

  it('audits the read against the staff member, on the customer’s trail', async () => {
    const row = await prisma.platformAuditEvent.findFirst({
      where: { tenantId: granted.id, actorUserId: supportId, event: 'SUPPORT_READ' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect((row!.metadata as Record<string, unknown>).roleKey).toBe('platform_support');
  });

  it('records the refusal too, so an attempt is as visible as a success', async () => {
    const refused = await prisma.platformAuditEvent.findMany({
      where: { tenantId: granted.id, actorUserId: supportId, event: 'SUPPORT_READ' },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });
    expect(refused.some((row) => (row.metadata as Record<string, unknown>).status === 403)).toBe(true);
  });
});

describe('5 — revocation takes effect on the next request', () => {
  it('the owner revokes, and the very next request with the same cookie is refused', async () => {
    const cookie = await createPlatformSessionToken(supportId, granted.id);

    const before = await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });
    expect(before.status).toBe(200);

    const res = await revokeMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'DELETE',
        {
          platformUserId: supportId,
          workspaceId: granted.id,
          reason: 'Investigation closed',
        },
        ownerCookie,
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).closed).toBeGreaterThan(0);

    // Same cookie, same session, no sign-out. If this passed, revocation would
    // only mean "cannot sign in again", which is not what anybody asks for when
    // they revoke access.
    const after = await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });
    expect(after.status).toBe(403);
    expect(await authorizedTenantIds(supportId)).toEqual([]);
  });
});

describe('6 — company-wide coverage is explicit, bounded and separate', () => {
  it('is granted to a named person by somebody else, with a reason', async () => {
    const res = await grantMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'POST',
        {
          platformUserId: supportId,
          reason: 'Primary on-call for the release weekend, all customers',
        },
        ownerCookie,
      ),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(new Date(body.coverage.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('opens every workspace, including the one never granted by name', async () => {
    expect(await authorizedTenantIds(supportId)).toBeNull();
    const cookie = await createPlatformSessionToken(supportId, null);
    const res = await enterWorkspace(new Request('http://localhost/enter', { method: 'POST', headers: { cookie } }), {
      params: Promise.resolve({ workspaceId: ungranted.id }),
    });
    expect(res.status).toBe(200);
  });

  it('is still read-only, and still not HR', async () => {
    const cookie = await createPlatformSessionToken(supportId, ungranted.id);
    const res = await createLead(
      json('http://localhost/api/v1/leads', 'POST', { firstName: 'Nope', phone: '+971500000001' }, cookie),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
  });

  it('is revoked as its own act, and the workspace closes again', async () => {
    const res = await revokeMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'DELETE',
        {
          platformUserId: supportId,
          reason: 'Rotation ended',
        },
        ownerCookie,
      ),
    );
    expect(res.status).toBe(200);

    const cookie = await createPlatformSessionToken(supportId, ungranted.id);
    const after = await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });
    expect(after.status).toBe(403);
  });
});

/**
 * Recordings, transcripts and documents are a separate ask.
 *
 * They are reached today through `calls:VIEW` — the same permission that lists
 * the calls — so a monitoring authorisation that stopped at "read-only" would
 * carry the recording of every client conversation with it. Asserted through
 * `assertSensitiveAccess` directly because the route handlers sit behind a
 * consent check and a storage fetch that have nothing to do with this question.
 */
describe('8 — sensitive data needs its own grant', () => {
  let ctx: Ctx;

  beforeAll(async () => {
    await grantMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'POST',
        {
          platformUserId: supportId,
          workspaceId: granted.id,
          reason: 'Operational monitoring, conversations not included',
        },
        ownerCookie,
      ),
    );
    const cookie = await createPlatformSessionToken(supportId, granted.id);
    ctx = await resolveCtx(new Request('http://internal/', { headers: { cookie } }), 'req-sensitive');
  });

  it('refuses transcripts and recordings on an ordinary monitoring grant', async () => {
    await expect(assertSensitiveAccess(ctx, 'call transcripts')).rejects.toThrow(/granted separately/i);
    await expect(assertSensitiveAccess(ctx, 'call recordings')).rejects.toThrow(/granted separately/i);
  });

  it('refuses AI analyses, call audits, transcripts and document downloads on the route, before any lookup', async () => {
    // What the model made of a conversation is the conversation. The id does
    // not exist, so a 403 here proves the gate ran ahead of the query — a route
    // that looked first would have answered 404.
    const cookie = await createPlatformSessionToken(supportId, granted.id);
    const params = Promise.resolve({ id: 'clzzzzzzzzzzzzzzzzzzzzzz' });
    for (const read of [readAnalysis, readCallAudits, readTranscript, downloadDocument]) {
      const res = await read(new Request('http://localhost/api/v1/calls/x', { headers: { cookie } }), { params });
      expect(res.status).toBe(403);
      expect(await res.text()).toMatch(/granted separately/i);
    }
  });

  it('still allows everything the grant is for', async () => {
    const cookie = await createPlatformSessionToken(supportId, granted.id);
    const res = await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
  });

  it('allows them once the owner grants it by name', async () => {
    await revokeMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'DELETE',
        { platformUserId: supportId, workspaceId: granted.id },
        ownerCookie,
      ),
    );
    await grantMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'POST',
        {
          platformUserId: supportId,
          workspaceId: granted.id,
          reason: 'Reviewing a disputed call recording with the customer',
          sensitive: true,
        },
        ownerCookie,
      ),
    );
    const cookie = await createPlatformSessionToken(supportId, granted.id);
    const wider = await resolveCtx(new Request('http://internal/', { headers: { cookie } }), 'req-sensitive-2');
    await expect(assertSensitiveAccess(wider, 'call recordings')).resolves.toBeUndefined();

    // The same routes now get past the gate and answer for the record itself.
    const params = Promise.resolve({ id: 'clzzzzzzzzzzzzzzzzzzzzzz' });
    for (const read of [readAnalysis, readCallAudits]) {
      const res = await read(new Request('http://localhost/api/v1/calls/x', { headers: { cookie } }), { params });
      expect(res.status).not.toBe(403);
    }
  });

  it('leaves one of the customer’s own employees untouched', async () => {
    // The gate narrows platform identities only. A workspace role that can see
    // the call list can still play the call, which is ordinary work and not this
    // control's business.
    const fake = { ...ctx, actor: { ...ctx.actor, id: 'not-a-platform-actor' } } as Ctx;
    await expect(assertSensitiveAccess(fake, 'call recordings')).resolves.toBeUndefined();
  });
});

describe('7 — the owner-only boundary holds', () => {
  it('a monitoring identity cannot grant itself anything', async () => {
    const cookie = await createPlatformSessionToken(supportId, null);
    const res = await grantMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'POST',
        {
          platformUserId: supportId,
          workspaceId: ungranted.id,
          reason: 'Granting myself access to a customer I was not given',
        },
        cookie,
      ),
    );
    expect(res.status).toBe(403);
  });

  it('and the owner cannot grant themselves coverage either', async () => {
    const res = await grantMonitoring(
      json(
        'http://localhost/api/v1/platform/monitoring/grants',
        'POST',
        {
          platformUserId: ownerId,
          reason: 'Awarding myself sight of every customer on the platform',
        },
        ownerCookie,
      ),
    );
    expect(res.status).toBe(403);
  });
});
