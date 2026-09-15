/**
 * The audit trail is a precondition of the read, not a side effect of it.
 *
 * Every other control here bounds *what* a monitoring identity may see. This
 * one bounds what happens when the record of that seeing cannot be written: the
 * data must not be served. A read that succeeds while its audit row fails is
 * exactly the outcome the whole design exists to prevent, and "we log the audit
 * failure and serve the customer's records anyway" is the comfortable default
 * that has to be actively refused.
 *
 * Asserted by making the write fail, rather than by reading the source and
 * believing the `await`.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { openGrant } from '@/lib/auth/platform-access';
import { createPlatformSessionToken } from '../helpers/session';
import { GET as listLeads } from '@/app/api/v1/leads/route';

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let supportId = '';
const SECRET_LEAD_NAME = `Zephyrine-${suffix}`;
const SECRET_LEAD_PHONE = `+9715${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `auditint-${suffix}`, legalName: 'AI LLC', displayName: 'AuditInt Co' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const stage = await prisma.leadStage.create({
    data: { tenantId, name: 'New', key: `new-${suffix}`, category: 'OPEN', position: 1 },
  });
  /**
   * A fixture with a value nothing else in the database could produce, so
   * "the response did not contain customer data" is a claim about this record
   * and not about a substring that happens to be absent.
   */
  await prisma.lead.create({
    data: {
      tenantId,
      reference: `L-${suffix}`,
      fullName: SECRET_LEAD_NAME,
      phone: SECRET_LEAD_PHONE,
      stageId: stage.id,
    },
  });

  const support = await prisma.platformUser.create({
    data: {
      email: `auditint.${suffix}@platform.test`,
      normalizedEmail: `auditint.${suffix}@platform.test`,
      fullName: 'Audit Integrity Staff',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'SUPPORT',
    },
  });
  supportId = support.id;
  await openGrant({
    platformUserId: supportId,
    tenantId,
    kind: 'READ',
    reason: 'Audit-integrity coverage for the monitoring console',
  });
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

const asMonitor = async () => ({
  cookie: await createPlatformSessionToken(supportId, tenantId),
});

describe('a protected read cannot outlive its audit row', () => {
  it('serves the record when the audit write succeeds — the control case', async () => {
    const { cookie } = await asMonitor();
    const res = await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    // The fixture really is reachable, so the refusal below is the audit
    // failing and not the lead being invisible for some other reason.
    expect(JSON.stringify(await res.json())).toContain(SECRET_LEAD_NAME);
  });

  it('refuses, and returns no customer data, when the audit row cannot be written', async () => {
    const { cookie } = await asMonitor();
    vi.spyOn(prisma.platformAuditEvent, 'create').mockRejectedValue(new Error('audit store unavailable'));

    const res = await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie } }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.text();
    expect(body).not.toContain(SECRET_LEAD_NAME);
    expect(body).not.toContain(SECRET_LEAD_PHONE);
  });
});

describe('what the audit row is allowed to contain', () => {
  it('records the request, not the records', async () => {
    const { cookie } = await asMonitor();
    await listLeads(new Request('http://localhost/api/v1/leads?q=' + SECRET_LEAD_NAME, { headers: { cookie } }), {
      params: Promise.resolve({}),
    });

    const rows = await prisma.platformAuditEvent.findMany({
      where: { tenantId, actorUserId: supportId, event: 'SUPPORT_READ' },
      orderBy: { occurredAt: 'desc' },
      take: 5,
    });
    expect(rows.length).toBeGreaterThan(0);

    const serialised = JSON.stringify(rows);
    // The point of the trail is that a read happened, by whom, against what —
    // never a second copy of the customer's data in the one table nobody prunes.
    expect(serialised).not.toContain(SECRET_LEAD_PHONE);

    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual([
      'action',
      'credentialPurpose',
      'method',
      'mode',
      'path',
      'roleKey',
      'status',
    ]);
    expect(meta.mode).toBe('monitoring');
    // Which of the identity's passwords opened the session — the purpose, never the credential.
    expect(meta.credentialPurpose).toBe('PLATFORM_ADMIN');
  });

  it('attributes the row to server-side identity, never to anything the caller sent', async () => {
    const { cookie } = await asMonitor();
    await listLeads(
      new Request('http://localhost/api/v1/leads', {
        headers: {
          cookie,
          // A caller asserting somebody else's identity. None of this may reach
          // the row: the actor comes from the resolved session.
          'x-initiated-by': 'someone-elses-name',
          'x-actor-id': 'platform:not-me',
          'x-request-id': 'forged-request-id',
        },
      }),
      { params: Promise.resolve({}) },
    );

    const row = await prisma.platformAuditEvent.findFirst({
      where: { tenantId, actorUserId: supportId, event: 'SUPPORT_READ' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row!.actorUserId).toBe(supportId);
    const meta = row!.metadata as Record<string, unknown>;
    // `declaredInitiator` is a machine-path field and is explicitly unverified;
    // it must not appear on a staff row at all.
    expect(meta.declaredInitiator).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain('someone-elses-name');
    expect(JSON.stringify(meta)).not.toContain('platform:not-me');
  });

  it('never writes a credential field into the trail', async () => {
    const rows = await prisma.platformAuditEvent.findMany({ where: { tenantId }, take: 50 });
    const serialised = JSON.stringify(rows);
    for (const key of ['passwordHash', 'mfaSecret', 'mfaRecoveryCodes', 'tokenHash', 'keyHash']) {
      expect(serialised).not.toContain(key);
    }
  });
});
