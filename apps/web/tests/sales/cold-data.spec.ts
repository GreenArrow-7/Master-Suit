import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as importData } from '@/app/api/v1/cold-data/import/route';
import { PATCH as workRecord } from '@/app/api/v1/cold-data/[id]/route';
import { POST as convert } from '@/app/api/v1/cold-data/[id]/convert/route';
import { POST as assignList } from '@/app/api/v1/cold-data/assign/route';
import { GET as getLead } from '@/app/api/v1/leads/[id]/route';
import { get, patch, post } from '../helpers/request';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';

/**
 * Cold data (Lead Eagle plan, gap 5): a list lands as contacts, not leads; an
 * agent works what is assigned to them; a worked contact becomes a lead — or a
 * fresh touch on the lead that already holds its number.
 */
let fixture: Fixture;
let tenantId: string;
let roleId: string;
let agent: { id: string; cookie: string };
const LIST = 'Expo Feb';

const record = (phone: string) => prisma.dataRecord.findFirstOrThrow({ where: { tenantId, phone } });
const newAgent = async (tag: string) => {
  const user = await createWorkspaceUser({
    tenantId,
    roleId,
    email: `${tag}@cold-${tenantId}.test`,
    fullName: `Cold ${tag}`,
  });
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
};

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const role = await prisma.role.create({
    data: { tenantId, key: 'agent-cold', name: 'Agent', rank: 50, defaultScope: 'OWN' },
  });
  roleId = role.id;
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
  agent = await newAgent('agent');
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
    expect(res.body).toMatchObject({ created: true, visible: true });
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
    // The admin's lead: the agent's screen must not open it, and the flag says so.
    expect(res.body).toEqual({ leadId: existing.id, created: false, visible: false });
    expect(await prisma.lead.count({ where: { tenantId, phoneNormalized: '+971507770002' } })).toBe(1);
    expect((await get(getLead, `/api/v1/leads/${existing.id}`, agent.cookie)).status).toBe(404);
  });
});

/** `visible` must follow the lead page's own rule, so Make lead never opens a 404. */
describe('Make lead says whether the agent can open the lead', () => {
  const LIST3 = 'Expo Apr';
  const fresh = (fullName: string, phone: string, ownerId: string | null) =>
    prisma.dataRecord.create({ data: { tenantId, fullName, phone, batch: LIST3, ownerId } });
  const convertAs = async (id: string, cookie: string) =>
    (await post(convert, `/api/v1/cold-data/${id}/convert`, {}, cookie, { id })).body;

  it('opens a match on the agent’s own lead', async () => {
    const own = await prisma.lead.findFirstOrThrow({ where: { tenantId, phoneNormalized: '+971507770001' } });
    const { id } = await fresh('Expo One again', '0507770001', agent.id);
    expect(await convertAs(id, agent.cookie)).toEqual({ leadId: own.id, created: false, visible: true });
  });

  it('does not open an unassigned lead for an agent who cannot claim', async () => {
    const existing = await prisma.lead.update({
      where: { tenantId, id: fixture.a.leadIds[0]! },
      data: { ownerId: null },
    });
    const { id } = await fresh('Expo Two again', '0507770002', agent.id);
    expect(await convertAs(id, agent.cookie)).toEqual({ leadId: existing.id, created: false, visible: false });
  });

  it('opens any lead for organisation-wide access', async () => {
    const own = await prisma.lead.findFirstOrThrow({ where: { tenantId, phoneNormalized: '+971507770001' } });
    const { id } = await fresh('Expo One, admin', '0507770001', null);
    expect(await convertAs(id, fixture.a.cookie)).toEqual({ leadId: own.id, created: false, visible: true });
  });
});

/** One record handed to an agent from its row; the list hand-over still works. */
describe('handing one record to an agent', () => {
  const LIST2 = 'Expo Mar';
  let other: { id: string; cookie: string };
  let left: { id: string };
  let three: { id: string };
  let four: { id: string };
  const hand = (id: string, ownerId: string | null, cookie = fixture.a.cookie) =>
    patch(workRecord, `/api/v1/cold-data/${id}`, { ownerId }, cookie, { id });
  const work = (id: string, cookie: string) =>
    patch(workRecord, `/api/v1/cold-data/${id}`, { status: 'INTERESTED' }, cookie, { id });

  beforeAll(async () => {
    three = await prisma.dataRecord.create({
      data: { tenantId, fullName: 'Expo Three', phone: '0507770004', batch: LIST2 },
    });
    four = await prisma.dataRecord.create({
      data: { tenantId, fullName: 'Expo Four', phone: '0507770005', batch: LIST2 },
    });
    other = await newAgent('other');
    left = await newAgent('left');
    await prisma.user.update({ where: { tenantId, id: left.id }, data: { status: 'DEACTIVATED' } });
  });

  it('hands one record to an active member', async () => {
    expect((await hand(three.id, agent.id)).status).toBe(200);
    expect((await record('0507770004')).ownerId).toBe(agent.id);
    expect((await work(three.id, agent.cookie)).status).toBe(200);
    expect((await work(four.id, agent.cookie)).status).toBe(404);
  });

  it('refuses a member who has left or belongs to another workspace', async () => {
    const gone = await hand(three.id, left.id);
    expect(gone.status).toBe(404);
    expect(gone.body.detail).toMatch(/User/);
    expect((await hand(three.id, fixture.b.userId)).status).toBe(404);
    expect((await record('0507770004')).ownerId).toBe(agent.id);
  });

  it('hands it on, then back to nobody', async () => {
    expect((await hand(three.id, other.id)).status).toBe(200);
    expect((await record('0507770004')).ownerId).toBe(other.id);
    expect((await work(three.id, agent.cookie)).status).toBe(404);
    expect((await hand(three.id, null)).status).toBe(200);
    expect((await record('0507770004')).ownerId).toBeNull();
    expect(await prisma.dataRecord.count({ where: { tenantId, batch: LIST2, ownerId: { not: null } } })).toBe(0);
  });

  it('leaves a converted record with its lead', async () => {
    const { id } = await record('050 777 0001');
    expect((await hand(id, other.id)).status).toBe(404);
    expect((await record('050 777 0001')).ownerId).toBe(agent.id);
  });

  it('a list hand-over still moves every unconverted record', async () => {
    const res = await post(
      assignList,
      '/api/v1/cold-data/assign',
      { batch: LIST2, ownerId: agent.id },
      fixture.a.cookie,
    );
    expect(res.body.assigned).toBe(2);
    expect((await record('0507770004')).ownerId).toBe(agent.id);
    expect((await record('0507770005')).ownerId).toBe(agent.id);
  });
});

/**
 * A list hand-over by someone below organisation-wide lead access moves the
 * records they work (coldDataScope), not the whole list: a team lead's "assign
 * list" moved every agent's records in it, and their unassigned ones.
 */
describe('a list hand-over below organisation-wide access', () => {
  it('moves only the assigner’s own records of the list', async () => {
    const LIST5 = 'Expo Jun';
    const role = await prisma.role.create({
      data: { tenantId, key: 'team-lead-cold', name: 'Cold Team Lead', rank: 40, defaultScope: 'TEAM' },
    });
    await grantPermissions(
      tenantId,
      role.id,
      [
        ['leads', 'VIEW'],
        ['leads', 'ASSIGN'],
      ],
      'TEAM',
    );
    const lead = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `team-lead@cold-${tenantId}.test`,
      fullName: 'Cold Team Lead',
    });
    // The agent is in the team lead's team: a hand-over goes only to someone the
    // assigner's own scope reaches.
    const team = await prisma.team.create({ data: { tenantId, name: 'Cold calling', code: 'COLD' } });
    await prisma.userTeam.createMany({
      data: [lead.id, agent.id].map((userId) => ({ tenantId, userId, teamId: team.id })),
    });
    const add = (fullName: string, ownerId: string | null) =>
      prisma.dataRecord.create({ data: { tenantId, fullName, batch: LIST5, ownerId }, select: { id: true } });
    const own = await add('Team lead’s own', lead.id);
    const colleagues = await add('Someone else’s', fixture.a.userId);
    const loose = await add('Nobody’s yet', null);

    const res = await post(
      assignList,
      '/api/v1/cold-data/assign',
      { batch: LIST5, ownerId: agent.id },
      await createSessionToken(tenantId, lead.id),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.assigned).toBe(1);
    const owners = await prisma.dataRecord.findMany({
      where: { tenantId, id: { in: [own.id, colleagues.id, loose.id] } },
      select: { id: true, ownerId: true },
    });
    expect(Object.fromEntries(owners.map((row) => [row.id, row.ownerId]))).toEqual({
      [own.id]: agent.id,
      [colleagues.id]: fixture.a.userId,
      [loose.id]: null,
    });
  });
});

/**
 * Cold data follows the lead scope (Lead Eagle audit, M5-05): TEAM, BRANCH and
 * REGION are the caller's resolved owners, as leads, calls and the work lists
 * read them; an unassigned record is ORGANIZATION's to hand out. `coldDataScope`
 * was own-or-all, so a team lead worked, handed on and converted only their own
 * records while the lead list beside it showed the team's.
 */
describe('cold data follows the lead scope', () => {
  const LIST6 = 'Expo Jul';
  let lead: { id: string; cookie: string };
  let mate: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let own: { id: string };
  let mates: { id: string };
  let theirs: { id: string };
  let loose: { id: string };
  const work = (id: string, cookie: string) =>
    patch(workRecord, `/api/v1/cold-data/${id}`, { status: 'NOT_REACHABLE' }, cookie, { id });
  const hand = (id: string, ownerId: string | null, cookie: string) =>
    patch(workRecord, `/api/v1/cold-data/${id}`, { ownerId }, cookie, { id });
  const ownerOf = async (id: string) =>
    (await prisma.dataRecord.findFirstOrThrow({ where: { tenantId, id }, select: { ownerId: true } })).ownerId;

  beforeAll(async () => {
    const role = await prisma.role.create({
      data: { tenantId, key: 'team-lead-scope', name: 'Scoped Team Lead', rank: 40, defaultScope: 'TEAM' },
    });
    await grantPermissions(
      tenantId,
      role.id,
      [
        ['leads', 'VIEW'],
        ['leads', 'EDIT'],
        ['leads', 'CREATE'],
        ['leads', 'ASSIGN'],
      ],
      'TEAM',
    );
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `scoped-lead@cold-${tenantId}.test`,
      fullName: 'Scoped Team Lead',
    });
    lead = { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
    mate = await newAgent('mate');
    outsider = await newAgent('outsider');
    const team = await prisma.team.create({ data: { tenantId, name: 'Scoped calling', code: 'SCOPED' } });
    await prisma.userTeam.createMany({
      data: [lead.id, mate.id].map((userId) => ({ tenantId, userId, teamId: team.id })),
    });
    const add = (fullName: string, phone: string, ownerId: string | null) =>
      prisma.dataRecord.create({ data: { tenantId, fullName, phone, batch: LIST6, ownerId }, select: { id: true } });
    own = await add('Team lead’s own', '0507770101', lead.id);
    mates = await add('Teammate’s', '0507770102', mate.id);
    theirs = await add('Outsider’s', '0507770103', outsider.id);
    loose = await add('Nobody’s', '0507770104', null);
  });

  it('a team lead works the team’s records; an outsider’s and an unassigned one answer as missing', async () => {
    expect((await work(mates.id, lead.cookie)).status).toBe(200);
    expect((await work(own.id, lead.cookie)).status).toBe(200);
    const other = await work(theirs.id, lead.cookie);
    expect(other.status).toBe(404);
    expect(other.body.detail).toMatch(/not found/i);
    expect((await work(loose.id, lead.cookie)).status).toBe(404);
    // An agent at OWN scope still works only their own.
    expect((await work(mates.id, outsider.cookie)).status).toBe(404);
    expect((await work(theirs.id, outsider.cookie)).status).toBe(200);
  });

  it('hands one of the team’s records on within the team, and not an outsider’s or to one', async () => {
    expect((await hand(mates.id, lead.id, lead.cookie)).status).toBe(200);
    expect(await ownerOf(mates.id)).toBe(lead.id);
    expect((await hand(theirs.id, lead.id, lead.cookie)).status).toBe(404);
    expect(await ownerOf(theirs.id)).toBe(outsider.id);
    expect((await hand(mates.id, outsider.id, lead.cookie)).status).toBe(404);
    expect((await hand(mates.id, mate.id, lead.cookie)).status).toBe(200);
    expect(await ownerOf(mates.id)).toBe(mate.id);
  });

  it('a list hand-over moves the team’s records and leaves the rest', async () => {
    const res = await post(assignList, '/api/v1/cold-data/assign', { batch: LIST6, ownerId: mate.id }, lead.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.assigned).toBe(2);
    expect(await ownerOf(own.id)).toBe(mate.id);
    expect(await ownerOf(mates.id)).toBe(mate.id);
    expect(await ownerOf(theirs.id)).toBe(outsider.id);
    expect(await ownerOf(loose.id)).toBeNull();
  });

  it('converts a teammate’s record into the teammate’s lead, and not an outsider’s', async () => {
    const res = await post(convert, `/api/v1/cold-data/${mates.id}/convert`, {}, lead.cookie, { id: mates.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ created: true, visible: true });
    expect((await prisma.lead.findFirstOrThrow({ where: { tenantId, id: res.body.leadId } })).ownerId).toBe(mate.id);
    expect(
      (await post(convert, `/api/v1/cold-data/${theirs.id}/convert`, {}, lead.cookie, { id: theirs.id })).status,
    ).toBe(404);
    expect(await prisma.lead.count({ where: { tenantId, phoneNormalized: '+971507770103' } })).toBe(0);
  });
});
