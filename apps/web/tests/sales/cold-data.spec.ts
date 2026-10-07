import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as importData } from '@/app/api/v1/cold-data/import/route';
import { PATCH as workRecord } from '@/app/api/v1/cold-data/[id]/route';
import { POST as convert } from '@/app/api/v1/cold-data/[id]/convert/route';
import { POST as assignList } from '@/app/api/v1/cold-data/assign/route';
import { patch, post } from '../helpers/request';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';

/**
 * Cold data (Lead Eagle plan, gap 5): a list lands as contacts, not leads; an
 * agent works what is assigned to them; a worked contact becomes a lead — or a
 * fresh touch on the lead that already holds its number.
 */
let fixture: Fixture;
let tenantId: string;
let agent: { id: string; cookie: string };
const LIST = 'Expo Feb';

const record = (phone: string) => prisma.dataRecord.findFirstOrThrow({ where: { tenantId, phone } });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const role = await prisma.role.create({
    data: { tenantId, key: 'agent-cold', name: 'Agent', rank: 50, defaultScope: 'OWN' },
  });
  await grantPermissions(
    tenantId,
    role.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['leads', 'CREATE'],
    ],
    'OWN',
  );
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `agent@cold-${tenantId}.test`,
    fullName: 'Cold Agent',
  });
  agent = { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('cold data', () => {
  it('imports a spreadsheet as a list of contacts, not leads, and reports bad rows', async () => {
    const leadsBefore = await prisma.lead.count({ where: { tenantId } });
    const res = await post(
      importData,
      '/api/v1/cold-data/import',
      {
        fileName: `${LIST}.xlsx`,
        rows: [
          { line: 2, values: { fullName: 'Expo One', phone: '050 777 0001', company: 'Acme' } },
          { line: 3, values: { fullName: 'Expo Two', phone: '0507770002' } },
          { line: 4, values: { fullName: '', phone: '0507770003' } },
        ],
      },
      fixture.a.cookie,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 2, batch: LIST });
    expect(res.body.failed.map((f: { line: number }) => f.line)).toEqual([4]);
    expect(await prisma.lead.count({ where: { tenantId } })).toBe(leadsBefore);
    expect((await record('050 777 0001')).phoneNormalized).toBe('+971507770001');
  });

  it('lets an agent work only what is assigned to them', async () => {
    const { id } = await record('050 777 0001');
    const url = `/api/v1/cold-data/${id}`;
    expect((await patch(workRecord, url, { status: 'INTERESTED' }, agent.cookie, { id })).status).toBe(404);

    const assigned = await post(
      assignList,
      '/api/v1/cold-data/assign',
      { batch: LIST, ownerId: agent.id },
      fixture.a.cookie,
    );
    expect(assigned.body.assigned).toBe(2);
    expect((await patch(workRecord, url, { status: 'INTERESTED' }, agent.cookie, { id })).status).toBe(200);
    // Handing a record on is ASSIGN, which the agent does not hold.
    expect((await patch(workRecord, url, { ownerId: fixture.a.userId }, agent.cookie, { id })).status).toBe(403);
  });

  it('converts a worked contact into a lead owned by the agent, and keeps the record', async () => {
    const { id } = await record('050 777 0001');
    const res = await post(convert, `/api/v1/cold-data/${id}/convert`, {}, agent.cookie, { id });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: res.body.leadId } });
    expect(lead).toMatchObject({
      fullName: 'Expo One',
      ownerId: agent.id,
      source: 'IMPORT',
      sourceDetail: `data:${LIST}`,
    });
    expect(await record('050 777 0001')).toMatchObject({ status: 'CONVERTED', convertedLeadId: lead.id });
    expect((await post(convert, `/api/v1/cold-data/${id}/convert`, {}, agent.cookie, { id })).status).toBe(404);
  });

  it('turns a contact already in the pipeline into a touch on that lead, not a second lead', async () => {
    const existing = await prisma.lead.update({
      where: { tenantId, id: fixture.a.leadIds[0]! },
      data: { phone: '0507770002', phoneNormalized: '+971507770002' },
    });
    const { id } = await record('0507770002');
    const res = await post(convert, `/api/v1/cold-data/${id}/convert`, {}, agent.cookie, { id });
    expect(res.body).toEqual({ leadId: existing.id, created: false });
    expect(await prisma.lead.count({ where: { tenantId, phoneNormalized: '+971507770002' } })).toBe(1);
  });
});
