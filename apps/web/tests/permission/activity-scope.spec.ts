import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as logActivity } from '@/app/api/v1/activities/route';
import { DELETE as deleteActivity, PATCH as patchActivity } from '@/app/api/v1/activities/[id]/route';
import { seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { del, patch, post } from '../helpers/request';

/**
 * Logging an activity is work on a lead, so it follows the lead's write rule.
 * The activity routes checked `leads:EDIT` and nothing else: an agent at OWN
 * scope could log on — and stamp `lastActivityAt` of — any lead in the
 * workspace by its id, and a team manager could change any activity in it.
 */
let h: Hierarchy;
let typeId: string;
const log = (leadId: string, cookie: string) =>
  post(logActivity, '/api/v1/activities', { typeId, leadId, notes: 'Called' }, cookie);
const stamp = (leadId: string) =>
  prisma.lead
    .findFirstOrThrow({ where: { tenantId: h.tenantId, id: leadId }, select: { lastActivityAt: true } })
    .then((lead) => lead.lastActivityAt);

beforeAll(async () => {
  h = await seedHierarchy();
  typeId = (await prisma.activityType.create({ data: { tenantId: h.tenantId, key: 'note', name: 'Note' } })).id;
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe('logging an activity', () => {
  it('an own-scope agent logs on their own lead', async () => {
    expect((await log(h.repA1.leadId, h.repA1.cookie)).status).toBe(200);
    expect(await stamp(h.repA1.leadId)).not.toBeNull();
  });

  it('refuses a teammate’s lead exactly as a lead that does not exist, and leaves it untouched', async () => {
    const theirs = await log(h.repA2.leadId, h.repA1.cookie);
    const missing = await log(`c${'0'.repeat(24)}`, h.repA1.cookie);
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(theirs.body.detail).toBe(missing.body.detail);
    expect(await prisma.activity.count({ where: { tenantId: h.tenantId, leadId: h.repA2.leadId } })).toBe(0);
    expect(await stamp(h.repA2.leadId)).toBeNull();
  });
});

describe('changing an activity', () => {
  it('a team manager reaches activities on their team’s leads, not the rest of the workspace', async () => {
    const inTeam = await log(h.repA1.leadId, h.repA1.cookie);
    const elsewhere = await log(h.repB1.leadId, h.repB1.cookie);
    const url = (id: string) => `/api/v1/activities/${id}`;
    const manager = h.teamManagerA.cookie;

    expect((await patch(patchActivity, url(elsewhere.body.id), { outcome: 'Edited' }, manager)).status).toBe(404);
    expect((await del(deleteActivity, url(elsewhere.body.id), manager)).status).toBe(404);
    const untouched = await prisma.activity.findFirstOrThrow({
      where: { tenantId: h.tenantId, id: elsewhere.body.id },
    });
    expect(untouched.outcome).toBeNull();

    expect((await patch(patchActivity, url(inTeam.body.id), { outcome: 'Coached' }, manager)).status).toBe(200);
  });
});
