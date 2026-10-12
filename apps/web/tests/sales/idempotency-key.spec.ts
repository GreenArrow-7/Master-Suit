import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as createLead } from '@/app/api/v1/leads/route';
import { PATCH as updateLead } from '@/app/api/v1/leads/[id]/route';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * `Idempotency-Key` on POST and PATCH (docs/03-API.md §2): a retry carrying the
 * key gets the first answer back, stored for 24 hours, and does nothing again.
 * Held by `route()`, so every /api/v1 write has it, per workspace and route.
 * A REST client posting leads (audit row M6-08) retried into a 409 before.
 */
let fixture: Fixture;
const phone = (n: number) => `+97155${String(Date.now()).slice(-6)}${n}`;

const send = async (
  handler: typeof createLead,
  method: 'POST' | 'PATCH',
  path: string,
  cookie: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
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
    { params: Promise.resolve({ id: path.split('/')[4] ?? '' }) },
  );
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('Idempotency-Key', () => {
  it('answers a retried POST with the first response and creates nothing more', async () => {
    const body = { fullName: 'Idem Buyer', phone: phone(1), source: 'API' };
    const first = await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body, 'lead-retry-1');
    expect(first.status).toBe(200);
    const again = await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body, 'lead-retry-1');
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.lead.count({ where: { tenantId: fixture.a.tenantId, fullName: 'Idem Buyer' } })).toBe(1);
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

  it('changes nothing without the header: a second POST of a known number is still a duplicate', async () => {
    const body = { fullName: 'Idem Plain', phone: phone(5), source: 'API' };
    expect((await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body)).status).toBe(200);
    expect((await send(createLead, 'POST', '/api/v1/leads', fixture.a.cookie, body)).status).toBe(409);
  });
});
