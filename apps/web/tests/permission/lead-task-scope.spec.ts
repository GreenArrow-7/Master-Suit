/**
 * A lead's Tasks tab lists what the viewer's own Tasks page would list. It
 * listed every open task on the lead to anyone who could open the lead: tasks
 * owned outside the viewer's `tasks:VIEW` scope, and to roles holding no `tasks`
 * grant at all — title, type and due date, each with a Complete button that
 * `PATCH /tasks/{id}` refuses since #146. A Task is read under `tasks`, not
 * `leads` (services/leads/nextFollowUp.ts). The tab's count and the "Open tasks"
 * figure are both counted from this list.
 *
 * Checked on the page server component: the tasks it hands the client.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { prisma } from '@/lib/db';
import LeadPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import LeadDetail from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/LeadDetail';
import { PATCH as patchTask } from '@/app/api/v1/tasks/[id]/route';
import { grantPermissions, seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { patch } from '../helpers/request';

let h: Hierarchy;
let typeId: string;
let stageId: string;
const dueAt = new Date(Date.now() + 86_400_000);

const lead = async (ownerId: string) =>
  (
    await prisma.lead.create({
      data: {
        tenantId: h.tenantId,
        reference: `LT-${randomBytes(4).toString('hex')}`,
        fullName: 'Handed-over lead',
        stageId,
        ownerId,
      },
    })
  ).id;
const task = async (ownerId: string | null, leadId: string) =>
  (await prisma.task.create({ data: { tenantId: h.tenantId, typeId, ownerId, leadId, title: 'Chase', dueAt } })).id;

/** The task ids the lead page hands its client component. */
async function tasksShown(as: { cookie: string }, leadId: string): Promise<string[]> {
  cookieJar.value = as.cookie;
  const page = (await LeadPage({ params: Promise.resolve({ id: leadId }) })) as ReactElement<{
    children: ReactElement[];
  }>;
  const detail = page.props.children.find((child) => child?.type === LeadDetail) as ReactElement<{
    lead: { tasks: { id: string }[] };
  }>;
  return detail.props.lead.tasks.map((t) => t.id).sort();
}

beforeAll(async () => {
  h = await seedHierarchy();
  const roleOf = async (userId: string) =>
    (await prisma.user.findFirstOrThrow({ where: { tenantId: h.tenantId, id: userId }, select: { roleId: true } }))
      .roleId;
  // The fixture's roles hold only `leads`. The branch manager is left without a
  // `tasks` grant, as the seeded Marketing Manager is.
  await grantPermissions(h.tenantId, await roleOf(h.repA1.id), [['tasks', 'VIEW']], 'OWN');
  await grantPermissions(h.tenantId, await roleOf(h.teamManagerA.id), [['tasks', 'VIEW']], 'TEAM');
  await grantPermissions(h.tenantId, await roleOf(h.director.id), [['tasks', 'VIEW']], 'ORGANIZATION');
  typeId = (await prisma.taskType.create({ data: { tenantId: h.tenantId, key: 'call', name: 'Call' } })).id;
  stageId = (await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: h.repA1.leadId } })).stageId;
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe("a lead's Tasks tab", () => {
  it('shows an agent their own tasks on a lead, not those its previous owner left there, and each one completes', async () => {
    // Reassigned from repA2: nothing moves the open tasks with the lead.
    const handedOver = await lead(h.repA1.id);
    await task(h.repA2.id, handedOver);
    await task(null, handedOver);
    const mine = await task(h.repA1.id, handedOver);

    const shown = await tasksShown(h.repA1, handedOver);
    expect(shown).toEqual([mine]);
    for (const id of shown) {
      expect((await patch(patchTask, `/api/v1/tasks/${id}`, { status: 'COMPLETED' }, h.repA1.cookie)).status).toBe(200);
    }
  });

  it('shows a team manager their team’s tasks, not another team’s; a task with no owner only at organisation scope', async () => {
    const l = await lead(h.repA1.id);
    const team = await task(h.repA2.id, l);
    const otherTeam = await task(h.repB1.id, l);
    const nobodys = await task(null, l);

    expect(await tasksShown(h.teamManagerA, l)).toEqual([team]);
    expect(await tasksShown(h.director, l)).toEqual([team, otherTeam, nobodys].sort());
  });

  it('shows no tasks to a role that may open the lead but holds no tasks grant, not even its own', async () => {
    const l = await lead(h.repA1.id);
    await task(h.repA1.id, l);
    await task(h.branchManager.id, l);

    expect(await tasksShown(h.branchManager, l)).toEqual([]);
  });
});
