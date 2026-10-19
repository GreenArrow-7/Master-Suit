import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as createLead } from '@/app/api/v1/leads/route';
import { PATCH as updateLead } from '@/app/api/v1/leads/[id]/route';
import { POST as selfAction } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route';
import { POST as adminAction } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/[action]/route';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createPlatformSessionToken, createSessionToken } from '../helpers/session';

/**
 * `Idempotency-Key` on POST and PATCH (docs/03-API.md §2): a retry carrying the
 * key gets the first answer back, stored for 24 hours, and does nothing again.
 * Held by `route()`, so every /api/v1 write has it, per workspace and route.
 * A REST client posting leads (audit row M6-08) retried into a 409 before.
 *
 * Except where the answer is a credential handed out once (a temporary
 * password, an authenticator's seed, recovery codes) or the body carries a
 * password: those are never kept, so the header is ignored there.
 */
let fixture: Fixture;
const phone = (n: number) => `+97155${String(Date.now()).slice(-6)}${n}`;

type Handler = (req: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

const send = async (
  handler: Handler,
  method: 'POST' | 'PATCH',
  path: string,
  cookie: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
  params: Record<string, string> = { id: path.split('/')[4] ?? '' },
) => {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );
  return { status: res.status, body: await res.json() };
};

/** A workspace whose administrator resets passwords, and whose member enrols an authenticator. */
const creds = { tenantId: '', slug: '', adminCookie: '', memberCookie: '', memberId: '' };
const PASSWORD = 'IdemPassword1!';
const colleagueEmail = `colleague-${randomBytes(3).toString('hex')}@idem.test`;

beforeAll(async () => {
  fixture = await seedTwoTenants();

  const suffix = randomBytes(4).toString('hex');
  creds.slug = `idem-creds-${suffix}`;
  const tenant = await prisma.tenant.create({
    data: { slug: creds.slug, legalName: `${creds.slug} LLC`, displayName: creds.slug, status: 'ACTIVE' },
  });
  creds.tenantId = tenant.id;
  const adminRole = await prisma.role.create({
    data: { tenantId: tenant.id, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenant.id, adminRole.id, [['users', 'MANAGE_USERS']]);
  const memberRole = await prisma.role.create({
    data: { tenantId: tenant.id, key: `member-${suffix}`, name: 'Member', rank: 60, defaultScope: 'OWN' },
  });
  const admin = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: adminRole.id,
    email: `admin@${creds.slug}.test`,
    fullName: 'Idem Admin',
  });
  creds.adminCookie = await createSessionToken(tenant.id, admin.id);
  const member = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: memberRole.id,
    email: `member@${creds.slug}.test`,
    fullName: 'Idem Member',
    password: PASSWORD,
  });
  creds.memberId = member.id;
  creds.memberCookie = await createPlatformSessionToken(member.platformUserId, tenant.id, {
    mfaSatisfied: false,
    purpose: 'FULL',
  });
});

afterAll(async () => {
  await fixture.cleanup();
  await prisma.tenant.delete({ where: { id: creds.tenantId } }).catch(() => {});
  await prisma.platformUser
    .deleteMany({ where: { email: { in: [`admin@${creds.slug}.test`, `member@${creds.slug}.test`, colleagueEmail] } } })
    .catch(() => {});
});

describe('Idempotency-Key', () => {
  it('answers a retried POST with the first response and creates nothing more', async () => {
    const body = { fullName: 'Idem Buyer', phone: phone(1), source: 'API' };
    const first = await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body, 'lead-retry-1');
    expect(first.status).toBe(200);
    const audited = () => prisma.auditLog.count({ where: { tenantId: fixture.a.tenantId, recordId: first.body.id } });
    const trail = await audited();
    const again = await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body, 'lead-retry-1');
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.lead.count({ where: { tenantId: fixture.a.tenantId, fullName: 'Idem Buyer' } })).toBe(1);
    // Nothing ran the second time, so nothing more was audited either.
    expect(await audited()).toBe(trail);
  });

  it('refuses the same key for a different request, and does not run it', async () => {
    const body = { fullName: 'Idem Other', phone: phone(2), source: 'API' };
    expect((await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body, 'lead-retry-2')).status).toBe(200);
    const changed = await send(
      createLead,
      'POST',
      '/api/v1/leads',
      fixture.a.cookie,
      { ...body, fullName: 'Idem Changed', phone: phone(3) },
      'lead-retry-2',
    );
    expect(changed.status).toBe(409);
    expect(await prisma.lead.count({ where: { tenantId: fixture.a.tenantId, fullName: 'Idem Changed' } })).toBe(0);
  });

  it('refuses the same key from another person in the workspace', async () => {
    const role = await prisma.user.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, id: fixture.a.userId },
      select: { roleId: true },
    });
    const colleague = await createWorkspaceUser({
      tenantId: fixture.a.tenantId,
      roleId: role.roleId,
      email: colleagueEmail,
      fullName: 'Idem Colleague',
    });
    const cookie = await createSessionToken(fixture.a.tenantId, colleague.id);
    const body = { fullName: 'Idem Shared', phone: phone(6), source: 'API' };
    expect((await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body, 'lead-retry-6')).status).toBe(200);
    expect((await send(createLead, 'POST', '/api/v1/leads', cookie, body, 'lead-retry-6')).status).toBe(409);
  });

  it('keeps only a success: a refused first attempt, corrected under the same key, runs', async () => {
    const refused = await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, { source: 'API' }, 'fix-me');
    expect(refused.status).toBe(422);
    const fixed = await send(
      createLead,
      'POST',
      '/api/v1/leads',
      fixture.a.cookie,
      { fullName: 'Idem Fixed', phone: phone(7), source: 'API' },
      'fix-me',
    );
    expect(fixed.status).toBe(200);
    expect(await prisma.lead.count({ where: { tenantId: fixture.a.tenantId, fullName: 'Idem Fixed' } })).toBe(1);
  });

  it('refuses a key longer than 255 characters', async () => {
    const body = { fullName: 'Idem Long', phone: phone(8), source: 'API' };
    const res = await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body, 'k'.repeat(256));
    expect(res.status).toBe(422);
    expect(await prisma.lead.count({ where: { tenantId: fixture.a.tenantId, fullName: 'Idem Long' } })).toBe(0);
  });

  it('is kept per workspace: another workspace’s key of the same name is its own request', async () => {
    const body = { fullName: 'Idem Neighbour', phone: phone(4), source: 'API' };
    expect((await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body, 'shared-key')).status).toBe(200);
    expect((await send(createLead, 'POST', '/api/v1/leads', fixture.b.cookie, body, 'shared-key')).status).toBe(200);
    expect(await prisma.lead.count({ where: { tenantId: fixture.b.tenantId, fullName: 'Idem Neighbour' } })).toBe(1);
  });

  it('answers a retried PATCH from the record of the first, without writing again', async () => {
    const leadId = fixture.a.leadIds[0]!;
    const path = `/api/v1/leads/${leadId}`;
    const first = await send(updateLead, 'PATCH', path, fixture.a.cookie, { company: 'First Co' }, 'patch-retry');
    expect(first.status).toBe(200);
    // Somebody else changes it in between; the retry must not put it back.
    await prisma.lead.update({
      where: { tenantId: fixture.a.tenantId, id: leadId },
      data: { company: 'Changed Since' },
    });
    const again = await send(updateLead, 'PATCH', path, fixture.a.cookie, { company: 'First Co' }, 'patch-retry');
    expect(again.status).toBe(200);
    expect(again.body.company).toBe('First Co');
    expect((await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: leadId } })).company).toBe(
      'Changed Since',
    );
  });

  it('keeps no key for a body that never arrived, so the resend under it runs', async () => {
    // The outbox's PATCH, cut off by a page reload while route() authenticated:
    // the body stream errors when it is finally read.
    const leadId = fixture.a.leadIds[1]!;
    const path = `/api/v1/leads/${leadId}`;
    const cut = await updateLead(
      new Request(`http://localhost${path}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: fixture.a.cookie, 'idempotency-key': 'cut-off' },
        body: new ReadableStream({ start: (controller) => controller.error(new Error('aborted')) }),
        duplex: 'half',
      } as RequestInit),
      { params: Promise.resolve({ id: leadId }) },
    );
    expect(cut.status).toBe(422);
    expect(
      await prisma.idempotentRequest.count({ where: { tenantId: fixture.a.tenantId, requestKey: 'cut-off' } }),
    ).toBe(0);

    const resent = await send(updateLead, 'PATCH', path, fixture.a.cookie, { company: 'Arrived Co' }, 'cut-off');
    expect(resent.status).toBe(200);
    expect((await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: leadId } })).company).toBe(
      'Arrived Co',
    );
  });

  it('refuses a body that is not JSON instead of running it as an empty change', async () => {
    const leadId = fixture.a.leadIds[1]!;
    const res = await updateLead(
      new Request(`http://localhost/api/v1/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: fixture.a.cookie, 'idempotency-key': 'not-json' },
        body: '{"company": "Half',
      }),
      { params: Promise.resolve({ id: leadId }) },
    );
    expect(res.status).toBe(422);
    expect(
      await prisma.idempotentRequest.count({ where: { tenantId: fixture.a.tenantId, requestKey: 'not-json' } }),
    ).toBe(0);
  });

  it('changes nothing without the header: a second POST of a known number is still a duplicate', async () => {
    const body = { fullName: 'Idem Plain', phone: phone(5), source: 'API' };
    expect((await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body)).status).toBe(200);
    expect((await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body)).status).toBe(409);
  });

  it('never keeps a self-service answer: an authenticator’s seed is not stored for a replay', async () => {
    const path = `/api/v1/workspaces/${creds.slug}/identity/self/two-factor-begin`;
    const params = { workspaceSlug: creds.slug, action: 'two-factor-begin' };
    const body = { currentPassword: PASSWORD };
    const first = await send(selfAction, 'POST', path, creds.memberCookie, body, 'enrol-1', params);
    expect(first.status).toBe(200);
    expect(first.body.secret).toBeTruthy();
    const again = await send(selfAction, 'POST', path, creds.memberCookie, body, 'enrol-1', params);
    expect(again.status).toBe(200);
    // Run again rather than replayed, and nothing kept: neither the seed nor a hash of the password.
    expect(again.body.secret).not.toBe(first.body.secret);
    expect(await prisma.idempotentRequest.count({ where: { tenantId: creds.tenantId } })).toBe(0);
  });

  it('never keeps an administrator’s password reset: the temporary password is not stored', async () => {
    const path = `/api/v1/workspaces/${creds.slug}/identity/password-reset`;
    const params = { workspaceSlug: creds.slug, action: 'password-reset' };
    const body = { userId: creds.memberId };
    const first = await send(adminAction, 'POST', path, creds.adminCookie, body, 'reset-1', params);
    expect(first.status).toBe(200);
    expect(first.body.temporaryPassword).toBeTruthy();
    const again = await send(adminAction, 'POST', path, creds.adminCookie, body, 'reset-1', params);
    expect(again.status).toBe(200);
    expect(again.body.temporaryPassword).not.toBe(first.body.temporaryPassword);
    expect(await prisma.idempotentRequest.count({ where: { tenantId: creds.tenantId } })).toBe(0);
  });
});
