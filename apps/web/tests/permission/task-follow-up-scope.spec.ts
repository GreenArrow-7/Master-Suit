import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { PATCH as patchFollowUp } from '@/app/api/v1/follow-ups/[id]/route';
import { DELETE as deleteTask, PATCH as patchTask } from '@/app/api/v1/tasks/[id]/route';
import { grantPermissions, seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { del, patch } from '../helpers/request';

/**
 * A task or follow-up by id is reached under the rule its list applies. The task
 * routes checked nothing about the task: anyone holding `leads:EDIT`, an agent
 * at OWN scope included, could change, complete or take any task in the
 * workspace, and `tasks:DELETE` delete it. The follow-up PATCH let anyone at
 * TEAM scope or wider change any follow-up in it.
 */
let h: Hierarchy;
let typeId: string;
const MISSING = `c${'0'.repeat(24)}`;
const dueAt = new Date(Date.now() + 86_400_000);
const taskUrl = (id: string) => `/api/v1/tasks/${id}`;
const followUpUrl = (id: string) => `/api/v1/follow-ups/${id}`;

const task = async (ownerId: string | null, leadId: string | null = null) =>
  (await prisma.task.create({ data: { tenantId: h.tenantId, typeId, ownerId, leadId, title: 'Chase', dueAt } })).id;
const followUp = async (ownerId: string, leadId: string) =>
  (await prisma.followUpTask.create({ data: { tenantId: h.tenantId, ownerId, leadId, title: 'Chase', dueAt } })).id;

beforeAll(async () => {
  h = await seedHierarchy();
  const roleOf = async (userId: string) =>
    (await prisma.user.findFirstOrThrow({ where: { tenantId: h.tenantId, id: userId }, select: { roleId: true } }))
      .roleId;
  // The fixture's roles hold only `leads`; a Task is read under `tasks`.
  const tasks = [
    ['tasks', 'VIEW'],
    ['tasks', 'DELETE'],
  ] as const;
  await grantPermissions(h.tenantId, await roleOf(h.repA1.id), tasks, 'OWN');
  await grantPermissions(h.tenantId, await roleOf(h.teamManagerA.id), tasks, 'TEAM');
  await grantPermissions(h.tenantId, await roleOf(h.director.id), [['tasks', 'VIEW']], 'ORGANIZATION');
  typeId = (await prisma.taskType.create({ data: { tenantId: h.tenantId, key: 'call', name: 'Call' } })).id;
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe('a task by id', () => {
  it('refuses an own-scope agent a teammate’s task exactly as a missing one, and leaves it untouched', async () => {
    const theirs = await task(h.repA2.id, h.repA2.leadId);
    const takeIt = { title: 'Mine now', status: 'COMPLETED', ownerId: h.repA1.id };
    const refused = await patch(patchTask, taskUrl(theirs), takeIt, h.repA1.cookie);
    const missing = await patch(patchTask, taskUrl(MISSING), takeIt, h.repA1.cookie);
    expect(refused.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(refused.body.detail).toBe(missing.body.detail);
    expect((await del(deleteTask, taskUrl(theirs), h.repA1.cookie)).status).toBe(404);

    const untouched = await prisma.task.findFirstOrThrow({ where: { tenantId: h.tenantId, id: theirs } });
    expect(untouched).toMatchObject({ title: 'Chase', status: 'OPEN', ownerId: h.repA2.id, deletedAt: null });
  });

  it('an own-scope agent changes and deletes their own', async () => {
    const mine = await task(h.repA1.id, h.repA1.leadId);
    expect((await patch(patchTask, taskUrl(mine), { status: 'COMPLETED' }, h.repA1.cookie)).status).toBe(200);
    expect((await del(deleteTask, taskUrl(mine), h.repA1.cookie)).status).toBe(200);
  });

  it('a team manager reaches their team’s tasks, not another team’s', async () => {
    const elsewhere = await task(h.repB1.id, h.repB1.leadId);
    const manager = h.teamManagerA.cookie;
    expect((await patch(patchTask, taskUrl(elsewhere), { title: 'Edited' }, manager)).status).toBe(404);
    expect((await del(deleteTask, taskUrl(elsewhere), manager)).status).toBe(404);
    const untouched = await prisma.task.findFirstOrThrow({ where: { tenantId: h.tenantId, id: elsewhere } });
    expect(untouched).toMatchObject({ title: 'Chase', deletedAt: null });

    const inTeam = await task(h.repA2.id, h.repA2.leadId);
    expect((await patch(patchTask, taskUrl(inTeam), { title: 'Coached' }, manager)).status).toBe(200);
    expect((await del(deleteTask, taskUrl(inTeam), manager)).status).toBe(200);
  });

  it('a task with no owner is reached only at organization scope', async () => {
    const nobodys = await task(null);
    const takeIt = (as: { id: string; cookie: string }) =>
      patch(patchTask, taskUrl(nobodys), { ownerId: as.id }, as.cookie);
    expect((await takeIt(h.repA1)).status).toBe(404);
    expect((await takeIt(h.teamManagerA)).status).toBe(404);
    expect((await takeIt(h.director)).status).toBe(200);
  });
});

describe('a follow-up by id', () => {
  it('a team manager reaches their team’s follow-ups, not another team’s', async () => {
    const elsewhere = await followUp(h.repB1.id, h.repB1.leadId);
    const manager = h.teamManagerA.cookie;
    const refused = await patch(patchFollowUp, followUpUrl(elsewhere), { status: 'COMPLETED' }, manager);
    const missing = await patch(patchFollowUp, followUpUrl(MISSING), { status: 'COMPLETED' }, manager);
    expect(refused.status).toBe(404);
    expect(refused.body.detail).toBe(missing.body.detail);
    const untouched = await prisma.followUpTask.findFirstOrThrow({ where: { tenantId: h.tenantId, id: elsewhere } });
    expect(untouched).toMatchObject({ status: 'OPEN', completedAt: null });

    const inTeam = await followUp(h.repA1.id, h.repA1.leadId);
    expect((await patch(patchFollowUp, followUpUrl(inTeam), { status: 'COMPLETED' }, manager)).status).toBe(200);
  });

  it('an own-scope agent still reaches only their own', async () => {
    const theirs = await followUp(h.repA2.id, h.repA2.leadId);
    const mine = await followUp(h.repA1.id, h.repA1.leadId);
    expect((await patch(patchFollowUp, followUpUrl(theirs), { title: 'Mine' }, h.repA1.cookie)).status).toBe(404);
    expect((await patch(patchFollowUp, followUpUrl(mine), { title: 'Mine' }, h.repA1.cookie)).status).toBe(200);
  });
});
