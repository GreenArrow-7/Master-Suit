/**
 * Deriving `Lead.nextFollowUpAt`, and who is allowed to read it.
 *
 * Every fixture here is built with a **known wrong** stored value wherever the
 * stored value matters. The prototype on `claude/nextfollowup-wip` had already
 * backfilled the shared validation database once, and a suite that asserts
 * "the column is right" against a database somebody already corrected proves
 * nothing about the code under test. So the column is deliberately poisoned
 * first, and the assertion is that the *code* fixes it.
 *
 * Authorization is exercised through `resolveCtx` and real session cookies, so
 * the permissions, team memberships and managed-user sets are the ones Postgres
 * holds — not a hand-built map. `tests/helpers/ctx.ts` says as much in its own
 * header, and scope is exactly the thing it warns against faking.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Ctx } from '@/lib/security/rbac';
import { prisma, withTx } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { invalidateActors } from '@/lib/auth/actorCache';
import {
  OPEN_STATUSES,
  obligationAccess,
  obligationWhere,
  scopedNextFollowUp,
  stateOf,
  lockLeads,
  recomputeNextFollowUp,
  byScopedFollowUp,
} from '@/services/leads/nextFollowUp';
import { reportDrift, repairDrift } from '@/services/leads/nextFollowUpReconcile';
import { chasingQueue } from '@/services/leadership/rollups';
import { seedHierarchy, grantPermissions, type Hierarchy } from '../helpers/fixtures';
import { post, patch } from '../helpers/request';
import { POST as createTask } from '@/app/api/v1/tasks/route';
import { PATCH as patchTask } from '@/app/api/v1/tasks/[id]/route';
import { POST as createFollowUp } from '@/app/api/v1/follow-ups/route';
import { PATCH as patchFollowUp } from '@/app/api/v1/follow-ups/[id]/route';

let h: Hierarchy;
let stageOpenId = '';
let stageWonId = '';
let taskTypeId = '';
const suffix = randomBytes(4).toString('hex');

const T = () => h.tenantId;

/** A Ctx built the way a request builds one: real cookie, real rows. */
async function ctxFor(cookie: string): Promise<Ctx> {
  return resolveCtx(new Request('http://localhost/test', { headers: { cookie } }), `t-${suffix}`);
}

async function makeLead(name: string, stageId = stageOpenId, ownerId: string | null = null): Promise<string> {
  const lead = await prisma.lead.create({
    data: {
      tenantId: T(),
      reference: `NFU-${suffix}-${randomBytes(3).toString('hex')}`,
      fullName: name,
      stageId,
      ownerId,
    },
    select: { id: true },
  });
  return lead.id;
}

/** Poison the stored column, so a passing assertion means the code wrote it. */
async function poison(leadId: string, value: Date | null = new Date('1999-01-01T00:00:00Z')) {
  await prisma.lead.update({ where: { tenantId: T(), id: leadId }, data: { nextFollowUpAt: value } });
}

async function storedValue(leadId: string): Promise<Date | null> {
  const row = await prisma.lead.findFirstOrThrow({
    where: { tenantId: T(), id: leadId },
    select: { nextFollowUpAt: true },
  });
  return row.nextFollowUpAt;
}

async function task(leadId: string | null, ownerId: string, dueAt: Date, status = 'OPEN') {
  return prisma.task.create({
    data: {
      tenantId: T(),
      typeId: taskTypeId,
      title: 'Call back',
      leadId,
      ownerId,
      dueAt,
      status: status as 'OPEN',
    },
    select: { id: true },
  });
}

async function followUp(leadId: string | null, ownerId: string, dueAt: Date, status = 'OPEN') {
  return prisma.followUpTask.create({
    data: { tenantId: T(), leadId, ownerId, title: 'Follow up', dueAt, status: status as 'OPEN' },
    select: { id: true },
  });
}

/** Recompute through the service, the way a writer does. */
async function recompute(leadId: string) {
  return withTx(T(), async (tx) => {
    await lockLeads(tx, T(), [leadId]);
    return recomputeNextFollowUp(tx, T(), leadId);
  });
}

const at = (id: string) => ({ path: `/api/v1/x/${id}`, params: { id } });

beforeAll(async () => {
  h = await seedHierarchy();
  const [open, won] = await Promise.all([
    prisma.leadStage.findFirstOrThrow({ where: { tenantId: T() }, select: { id: true } }),
    prisma.leadStage.create({
      data: { tenantId: T(), key: `won-${suffix}`, name: 'Won', position: 9, category: 'CONVERSION' },
    }),
  ]);
  stageOpenId = open.id;
  stageWonId = won.id;
  const type = await prisma.taskType.create({
    data: { tenantId: T(), key: `call-${suffix}`, name: 'Call', isActive: true },
  });
  taskTypeId = type.id;

  /**
   * `seedHierarchy` grants the `leads` module only, so every role starts with
   * `tasks:VIEW = NONE`. That is itself one of the cases under test, so the
   * grants below are added deliberately and named:
   *
   *   repA1 / repA2 / repSubTeam …  tasks:VIEW = OWN
   *   teamManagerA               …  tasks:VIEW = TEAM
   *   director                   …  tasks:VIEW = ORGANIZATION
   *   branchManager              …  no tasks grant at all — the Marketing
   *                                 Manager shape: every lead, no tasks.
   */
  const roleOf = async (userId: string) =>
    (await prisma.user.findFirstOrThrow({ where: { tenantId: T(), id: userId }, select: { roleId: true } })).roleId;

  await grantPermissions(T(), await roleOf(h.repA1.id), [['tasks', 'VIEW']], 'OWN');
  await grantPermissions(T(), await roleOf(h.teamManagerA.id), [['tasks', 'VIEW']], 'TEAM');
  await grantPermissions(T(), await roleOf(h.director.id), [['tasks', 'VIEW']], 'ORGANIZATION');
  await invalidateActors(T());
}, 180_000);

afterAll(async () => {
  await h?.cleanup();
});

// ───────────────────────────────────────────────────────────────────────────

describe('what counts as open', () => {
  it('OPEN, IN_PROGRESS and RESCHEDULED all contribute', async () => {
    for (const status of OPEN_STATUSES) {
      const leadId = await makeLead(`open-${status}`);
      await poison(leadId);
      const due = new Date('2026-10-01T09:00:00Z');
      await task(leadId, h.repA1.id, due, status);
      expect(await recompute(leadId), `status ${status} should contribute`).toEqual(due);
    }
  });

  it('COMPLETED and CANCELLED do not, and clear a stale value', async () => {
    for (const status of ['COMPLETED', 'CANCELLED']) {
      const leadId = await makeLead(`closed-${status}`);
      await poison(leadId);
      await task(leadId, h.repA1.id, new Date('2026-10-01T09:00:00Z'), status);
      expect(await recompute(leadId), `status ${status} should not contribute`).toBeNull();
    }
  });

  it('a soft-deleted obligation does not contribute', async () => {
    const leadId = await makeLead('soft-deleted');
    const t = await task(leadId, h.repA1.id, new Date('2026-10-01T09:00:00Z'));
    expect(await recompute(leadId)).not.toBeNull();

    await prisma.task.update({ where: { tenantId: T(), id: t.id }, data: { deletedAt: new Date() } });
    expect(await recompute(leadId)).toBeNull();
  });

  it('restoring a soft-deleted obligation brings it back', async () => {
    const leadId = await makeLead('restored');
    const due = new Date('2026-10-02T09:00:00Z');
    const t = await task(leadId, h.repA1.id, due);
    await prisma.task.update({ where: { tenantId: T(), id: t.id }, data: { deletedAt: new Date() } });
    expect(await recompute(leadId)).toBeNull();

    await prisma.task.update({ where: { tenantId: T(), id: t.id }, data: { deletedAt: null } });
    expect(await recompute(leadId)).toEqual(due);
  });

  it('the earliest of the two stores wins, whichever store it is in', async () => {
    const leadId = await makeLead('two-stores');
    const early = new Date('2026-10-01T09:00:00Z');
    const late = new Date('2026-11-01T09:00:00Z');

    await task(leadId, h.repA1.id, late);
    await followUp(leadId, h.repA1.id, early);
    expect(await recompute(leadId)).toEqual(early);
  });

  it('a lead whose only obligation is a FollowUpTask still has a date', async () => {
    // Narrowing the derivation to `Task` would silently set this to null and
    // remove real work from every overdue screen. This is the test that fails
    // if anyone does it before the three conditions in the spec are met.
    const leadId = await makeLead('follow-up-only');
    const due = new Date('2026-10-03T09:00:00Z');
    await followUp(leadId, h.repA1.id, due);
    expect(await recompute(leadId)).toEqual(due);
  });

  it('an obligation attached to no lead changes nothing', async () => {
    const leadId = await makeLead('unattached');
    await task(null, h.repA1.id, new Date('2026-10-01T09:00:00Z'));
    expect(await recompute(leadId)).toBeNull();
  });
});

describe('the due-time boundary', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('exactly now is scheduled, not overdue', () => {
    expect(stateOf(new Date(now), now)).toBe('scheduled');
  });

  it('one millisecond earlier is overdue', () => {
    expect(stateOf(new Date(now.getTime() - 1), now)).toBe('overdue');
  });

  it('nothing owed is unscheduled, which is neither', () => {
    expect(stateOf(null, now)).toBe('unscheduled');
  });

  it('the row filter agrees with stateOf at the boundary', async () => {
    const leadId = await makeLead('boundary');
    await followUp(leadId, h.repA1.id, new Date(now));
    const ctx = await ctxFor(h.director.cookie);
    const access = await obligationAccess(ctx, 'scope');

    const overdue = await prisma.lead.count({
      where: { tenantId: T(), id: leadId, ...obligationWhere(access, 'overdue', now) },
    });
    const scheduled = await prisma.lead.count({
      where: { tenantId: T(), id: leadId, ...obligationWhere(access, 'scheduled', now) },
    });
    expect(overdue).toBe(0);
    expect(scheduled).toBe(1);
  });
});

describe('the three states are exclusive and exhaustive', () => {
  it('every lead matches exactly one of them', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const ctx = await ctxFor(h.director.cookie);
    const access = await obligationAccess(ctx, 'scope');

    const late = await makeLead('state-late');
    await followUp(late, h.repA1.id, new Date('2026-09-01T00:00:00Z'));
    const soon = await makeLead('state-soon');
    await followUp(soon, h.repA1.id, new Date('2026-12-01T00:00:00Z'));
    const none = await makeLead('state-none');

    for (const [leadId, expected] of [
      [late, 'overdue'],
      [soon, 'scheduled'],
      [none, 'unscheduled'],
    ] as const) {
      const matched: string[] = [];
      for (const state of ['overdue', 'scheduled', 'unscheduled'] as const) {
        const n = await prisma.lead.count({
          where: { tenantId: T(), id: leadId, ...obligationWhere(access, state, now) },
        });
        if (n === 1) matched.push(state);
      }
      expect(matched, `lead ${expected}`).toEqual([expected]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('the write path recomputes, through the real routes', () => {
  it('creating a task sets the date', async () => {
    const leadId = await makeLead('route-create-task');
    await poison(leadId);
    const due = new Date('2026-10-05T09:00:00Z');

    const res = await post(
      createTask,
      '/api/v1/tasks',
      { typeId: taskTypeId, title: 'Ring back', leadId, dueAt: due.toISOString() },
      h.repA1.cookie,
    );
    expect(res.status).toBe(200);
    expect(await storedValue(leadId)).toEqual(due);
  });

  it('creating a follow-up sets the date', async () => {
    const leadId = await makeLead('route-create-fu');
    await poison(leadId);
    const due = new Date('2026-10-06T09:00:00Z');

    const res = await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'Follow up', dueAt: due.toISOString() },
      h.repA1.cookie,
    );
    expect(res.status).toBe(200);
    expect(await storedValue(leadId)).toEqual(due);
  });

  it('a second, earlier obligation moves the date back', async () => {
    const leadId = await makeLead('earlier');
    await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'Later', dueAt: '2026-11-01T09:00:00Z' },
      h.repA1.cookie,
    );
    await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'Sooner', dueAt: '2026-10-01T09:00:00Z' },
      h.repA1.cookie,
    );
    expect(await storedValue(leadId)).toEqual(new Date('2026-10-01T09:00:00Z'));
  });

  it('rescheduling moves the date in both directions', async () => {
    const leadId = await makeLead('reschedule');
    const created = await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'Move me', dueAt: '2026-10-10T09:00:00Z' },
      h.repA1.cookie,
    );
    const id = created.body.data?.id ?? created.body.id;

    await patch(patchFollowUp, at(id).path, { dueAt: '2026-12-01T09:00:00Z' }, h.repA1.cookie, at(id).params);
    expect(await storedValue(leadId)).toEqual(new Date('2026-12-01T09:00:00Z'));

    await patch(patchFollowUp, at(id).path, { dueAt: '2026-09-01T09:00:00Z' }, h.repA1.cookie, at(id).params);
    expect(await storedValue(leadId)).toEqual(new Date('2026-09-01T09:00:00Z'));
  });

  it('a reschedule stamps RESCHEDULED and the obligation still counts', async () => {
    const leadId = await makeLead('reschedule-status');
    const created = await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'Move me', dueAt: '2026-10-10T09:00:00Z' },
      h.repA1.cookie,
    );
    const id = created.body.data?.id ?? created.body.id;
    await patch(patchFollowUp, at(id).path, { dueAt: '2026-10-20T09:00:00Z' }, h.repA1.cookie, at(id).params);

    const row = await prisma.followUpTask.findFirstOrThrow({ where: { tenantId: T(), id } });
    expect(row.status).toBe('RESCHEDULED');
    expect(await storedValue(leadId)).toEqual(new Date('2026-10-20T09:00:00Z'));
  });

  it('completing the only obligation clears the date', async () => {
    const leadId = await makeLead('complete');
    const created = await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'Done soon', dueAt: '2026-10-10T09:00:00Z' },
      h.repA1.cookie,
    );
    const id = created.body.data?.id ?? created.body.id;

    await patch(patchFollowUp, at(id).path, { status: 'COMPLETED' }, h.repA1.cookie, at(id).params);
    expect(await storedValue(leadId)).toBeNull();
  });

  it('completing one of two falls back to the other', async () => {
    const leadId = await makeLead('complete-one');
    const first = await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'Early', dueAt: '2026-10-01T09:00:00Z' },
      h.repA1.cookie,
    );
    await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'Late', dueAt: '2026-11-01T09:00:00Z' },
      h.repA1.cookie,
    );
    const id = first.body.data?.id ?? first.body.id;

    await patch(patchFollowUp, at(id).path, { status: 'COMPLETED' }, h.repA1.cookie, at(id).params);
    expect(await storedValue(leadId)).toEqual(new Date('2026-11-01T09:00:00Z'));
  });

  it('cancelling clears it, and reopening brings it back', async () => {
    const leadId = await makeLead('cancel-reopen');
    const created = await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'On and off', dueAt: '2026-10-15T09:00:00Z' },
      h.repA1.cookie,
    );
    const id = created.body.data?.id ?? created.body.id;

    await patch(patchFollowUp, at(id).path, { status: 'CANCELLED' }, h.repA1.cookie, at(id).params);
    expect(await storedValue(leadId)).toBeNull();

    await patch(patchFollowUp, at(id).path, { status: 'OPEN' }, h.repA1.cookie, at(id).params);
    expect(await storedValue(leadId)).toEqual(new Date('2026-10-15T09:00:00Z'));
  });

  it('moving a task between leads updates both aggregates', async () => {
    const from = await makeLead('move-from');
    const to = await makeLead('move-to');
    const due = new Date('2026-10-18T09:00:00Z');

    const created = await post(
      createTask,
      '/api/v1/tasks',
      { typeId: taskTypeId, title: 'Moving', leadId: from, dueAt: due.toISOString() },
      h.teamManagerA.cookie,
    );
    const id = created.body.data?.id ?? created.body.id;
    expect(await storedValue(from)).toEqual(due);

    const moved = await patch(patchTask, at(id).path, { leadId: to }, h.teamManagerA.cookie, at(id).params);
    expect(moved.status).toBe(200);
    expect(await storedValue(from)).toBeNull();
    expect(await storedValue(to)).toEqual(due);
  });

  it('detaching a task from its lead clears that lead', async () => {
    const from = await makeLead('detach');
    const created = await post(
      createTask,
      '/api/v1/tasks',
      { typeId: taskTypeId, title: 'Detach me', leadId: from, dueAt: '2026-10-19T09:00:00Z' },
      h.teamManagerA.cookie,
    );
    const id = created.body.data?.id ?? created.body.id;

    await patch(patchTask, at(id).path, { leadId: null }, h.teamManagerA.cookie, at(id).params);
    expect(await storedValue(from)).toBeNull();
  });

  it('reassigning an obligation leaves the lead-wide value alone', async () => {
    // The stored column aggregates every owner, so who owns the work does not
    // change when it is due. The *scoped* value changes, which is the next group.
    const leadId = await makeLead('reassign');
    const due = new Date('2026-10-21T09:00:00Z');
    const created = await post(
      createTask,
      '/api/v1/tasks',
      { typeId: taskTypeId, title: 'Hand over', leadId, dueAt: due.toISOString() },
      h.teamManagerA.cookie,
    );
    const id = created.body.data?.id ?? created.body.id;

    await patch(patchTask, at(id).path, { ownerId: h.repA2.id }, h.teamManagerA.cookie, at(id).params);
    expect(await storedValue(leadId)).toEqual(due);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('authorization: an aggregate never exceeds what the viewer may see', () => {
  let leadId = '';
  const repDue = new Date('2026-10-25T09:00:00Z');
  const otherDue = new Date('2026-10-24T09:00:00Z');

  beforeAll(async () => {
    // One lead carrying two obligations: the rep's, and an earlier one owned by
    // somebody in a different branch entirely.
    leadId = await makeLead('shared', stageOpenId, h.repA1.id);
    await task(leadId, h.repA1.id, repDue);
    await task(leadId, h.repOtherRegion.id, otherDue);
    await recompute(leadId);
  });

  it('the stored column holds the earliest of all of them', async () => {
    expect(await storedValue(leadId)).toEqual(otherDue);
  });

  it('a rep sees their own obligation, not the earlier one they cannot open', async () => {
    const ctx = await ctxFor(h.repA1.cookie);
    const due = await scopedNextFollowUp(T(), [leadId], await obligationAccess(ctx, 'scope'));
    expect(due.get(leadId)).toEqual(repDue);
  });

  it("a rep's personal and scope views agree, because their reach is themselves", async () => {
    const ctx = await ctxFor(h.repA1.cookie);
    const personal = await scopedNextFollowUp(T(), [leadId], await obligationAccess(ctx, 'personal'));
    const scope = await scopedNextFollowUp(T(), [leadId], await obligationAccess(ctx, 'scope'));
    expect(personal.get(leadId)).toEqual(scope.get(leadId));
  });

  it('a director at ORGANIZATION reach sees the earliest', async () => {
    const ctx = await ctxFor(h.director.cookie);
    const due = await scopedNextFollowUp(T(), [leadId], await obligationAccess(ctx, 'scope'));
    expect(due.get(leadId)).toEqual(otherDue);
  });

  it('a viewer with no tasks grant sees no task-derived date at all', async () => {
    // The Marketing Manager shape: every lead, no `tasks` permission. The lead
    // is visible; when its obligations are due is not.
    const ctx = await ctxFor(h.branchManager.cookie);
    const access = await obligationAccess(ctx, 'scope');
    expect(access.task).toEqual({ kind: 'none' });

    const due = await scopedNextFollowUp(T(), [leadId], access);
    expect(due.get(leadId)).toBeUndefined();
  });

  it('the branch manager can still see the lead itself', async () => {
    // Proving the previous test is about obligation visibility and not about
    // having lost sight of the lead.
    const ctx = await ctxFor(h.branchManager.cookie);
    const visible = await prisma.lead.count({ where: { tenantId: T(), id: leadId } });
    expect(visible).toBe(1);
    expect(ctx.actor.id).toBe(h.branchManager.id);
  });

  it('the overdue filter never returns a lead on somebody else’s obligation', async () => {
    // The defect the split exists for: an agent selecting "Overdue" and getting
    // a row whose own follow-up is in the future.
    const now = new Date('2026-10-24T12:00:00Z'); // after `otherDue`, before `repDue`
    const ctx = await ctxFor(h.repA1.cookie);
    const access = await obligationAccess(ctx, 'scope');

    const rows = await prisma.lead.count({
      where: { tenantId: T(), id: leadId, ...obligationWhere(access, 'overdue', now) },
    });
    expect(rows).toBe(0);

    const asDirector = await obligationAccess(await ctxFor(h.director.cookie), 'scope');
    const seen = await prisma.lead.count({
      where: { tenantId: T(), id: leadId, ...obligationWhere(asDirector, 'overdue', now) },
    });
    expect(seen).toBe(1);
  });

  it('a follow-up is governed by leads, not tasks', async () => {
    // `api/v1/follow-ups` authorises under `leads`, so a viewer with no tasks
    // grant still sees follow-ups they own. Asserted because the two stores
    // being governed by different modules is surprising and load-bearing.
    const own = await makeLead('fu-governed');
    await followUp(own, h.branchManager.id, new Date('2026-10-26T09:00:00Z'));
    const ctx = await ctxFor(h.branchManager.cookie);
    const due = await scopedNextFollowUp(T(), [own], await obligationAccess(ctx, 'scope'));
    expect(due.get(own)).toEqual(new Date('2026-10-26T09:00:00Z'));
  });

  it('one workspace never sees another’s obligations', async () => {
    const other = await seedHierarchy();
    try {
      const ctx = await ctxFor(h.director.cookie);
      const due = await scopedNextFollowUp(T(), [other.repA1.leadId], await obligationAccess(ctx, 'scope'));
      expect(due.size).toBe(0);
    } finally {
      await other.cleanup();
    }
  });
});

describe('team reach', () => {
  it('a team manager sees an obligation owned by their report', async () => {
    const leadId = await makeLead('team-reach');
    const due = new Date('2026-10-27T09:00:00Z');
    await task(leadId, h.repA2.id, due);

    const manager = await scopedNextFollowUp(
      T(),
      [leadId],
      await obligationAccess(await ctxFor(h.teamManagerA.cookie), 'scope'),
    );
    expect(manager.get(leadId)).toEqual(due);

    // …and their personal view does not, because it is not their work.
    const personal = await scopedNextFollowUp(
      T(),
      [leadId],
      await obligationAccess(await ctxFor(h.teamManagerA.cookie), 'personal'),
    );
    expect(personal.get(leadId)).toBeUndefined();
  });

  it('a team manager does not see another branch’s obligation', async () => {
    const leadId = await makeLead('other-branch');
    await task(leadId, h.repOtherRegion.id, new Date('2026-10-28T09:00:00Z'));

    const due = await scopedNextFollowUp(
      T(),
      [leadId],
      await obligationAccess(await ctxFor(h.teamManagerA.cookie), 'scope'),
    );
    expect(due.get(leadId)).toBeUndefined();
  });

  it('team reach descends into sub-teams', async () => {
    const leadId = await makeLead('sub-team');
    const due = new Date('2026-10-29T09:00:00Z');
    await task(leadId, h.repSubTeam.id, due);

    const manager = await scopedNextFollowUp(
      T(),
      [leadId],
      await obligationAccess(await ctxFor(h.teamManagerA.cookie), 'scope'),
    );
    expect(manager.get(leadId)).toEqual(due);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('a screen agrees with itself', () => {
  it('the count, the filter and the rendered dates come from one definition', async () => {
    const now = new Date('2026-11-15T12:00:00Z');
    const ctx = await ctxFor(h.teamManagerA.cookie);
    const access = await obligationAccess(ctx, 'scope');

    const late = await makeLead('agree-late');
    await task(late, h.repA2.id, new Date('2026-11-01T09:00:00Z'));
    const soon = await makeLead('agree-soon');
    await task(soon, h.repA2.id, new Date('2026-12-01T09:00:00Z'));

    const where = { tenantId: T(), id: { in: [late, soon] }, ...obligationWhere(access, 'overdue', now) };
    const count = await prisma.lead.count({ where });
    const rows = await prisma.lead.findMany({ where, select: { id: true } });
    const due = await scopedNextFollowUp(
      T(),
      rows.map((r) => r.id),
      access,
    );

    expect(count).toBe(rows.length);
    expect(rows.map((r) => r.id)).toEqual([late]);
    // Every row the filter returned renders a date that is genuinely overdue.
    for (const r of rows) expect(stateOf(due.get(r.id) ?? null, now)).toBe('overdue');
  });

  it('unscheduled sorts last in both directions, and ties break on id', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const due = new Map([
      ['a', new Date('2026-10-02T00:00:00Z')],
      ['b', new Date('2026-10-01T00:00:00Z')],
      ['c', new Date('2026-10-01T00:00:00Z')],
    ]);
    expect(byScopedFollowUp(rows, due, 'asc').map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(byScopedFollowUp(rows, due, 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the chasing queue reports the viewer’s own date, and skips closed leads', async () => {
    const now = new Date('2026-11-15T12:00:00Z');
    const live = await makeLead('chase-live', stageOpenId, h.repA2.id);
    await task(live, h.repA2.id, new Date('2026-11-05T09:00:00Z'));
    const won = await makeLead('chase-won', stageWonId, h.repA2.id);
    await task(won, h.repA2.id, new Date('2026-11-05T09:00:00Z'));
    await recompute(live);
    await recompute(won);

    const access = await obligationAccess(await ctxFor(h.teamManagerA.cookie), 'scope');
    const queue = await chasingQueue(T(), [h.repA2.id], access, now, 50);
    const ids = queue.map((r) => r.leadId);

    expect(ids).toContain(live);
    expect(ids).not.toContain(won);
    expect(queue.find((r) => r.leadId === live)?.nextFollowUpAt).toEqual(new Date('2026-11-05T09:00:00Z'));
  });

  it('the chasing queue still surfaces a neglected lead with nothing scheduled', async () => {
    const now = new Date('2026-11-15T12:00:00Z');
    const neglected = await makeLead('chase-none', stageOpenId, h.repA2.id);
    await prisma.lead.update({
      where: { tenantId: T(), id: neglected },
      data: { slaState: 'BREACHED', lastActivityAt: new Date('2026-10-01T00:00:00Z') },
    });

    const access = await obligationAccess(await ctxFor(h.director.cookie), 'scope');
    const queue = await chasingQueue(T(), [h.repA2.id], access, now, 50);
    const row = queue.find((r) => r.leadId === neglected);

    expect(row, 'a breached lead with no obligation is the neglect case').toBeDefined();
    expect(row?.nextFollowUpAt).toBeNull();
    expect(row?.overdueDays).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('concurrency, on separate connections', () => {
  it('two creations at once leave the earlier date', async () => {
    const leadId = await makeLead('race-create');
    const early = new Date('2026-10-01T09:00:00Z');
    const late = new Date('2026-11-01T09:00:00Z');

    // `Promise.all` over `withTx` gives each its own connection and its own
    // transaction, so these genuinely contend for the lead's row lock.
    await Promise.all([
      withTx(T(), async (tx) => {
        await lockLeads(tx, T(), [leadId]);
        await tx.followUpTask.create({
          data: { tenantId: T(), leadId, ownerId: h.repA1.id, title: 'A', dueAt: late },
        });
        await recomputeNextFollowUp(tx, T(), leadId);
      }),
      withTx(T(), async (tx) => {
        await lockLeads(tx, T(), [leadId]);
        await tx.task.create({
          data: { tenantId: T(), typeId: taskTypeId, leadId, ownerId: h.repA1.id, title: 'B', dueAt: early },
        });
        await recomputeNextFollowUp(tx, T(), leadId);
      }),
    ]);

    expect(await storedValue(leadId)).toEqual(early);
  });

  it('completion racing creation ends on the survivor, not on whoever committed last', async () => {
    const leadId = await makeLead('race-complete');
    const existing = new Date('2026-10-01T09:00:00Z');
    const added = new Date('2026-10-15T09:00:00Z');
    const first = await followUp(leadId, h.repA1.id, existing);
    await recompute(leadId);

    await Promise.all([
      withTx(T(), async (tx) => {
        await lockLeads(tx, T(), [leadId]);
        await tx.followUpTask.update({
          where: { tenantId: T(), id: first.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await recomputeNextFollowUp(tx, T(), leadId);
      }),
      withTx(T(), async (tx) => {
        await lockLeads(tx, T(), [leadId]);
        await tx.followUpTask.create({
          data: { tenantId: T(), leadId, ownerId: h.repA1.id, title: 'New', dueAt: added },
        });
        await recomputeNextFollowUp(tx, T(), leadId);
      }),
    ]);

    // Whichever order they ran in, one obligation is open and it is `added`.
    expect(await storedValue(leadId)).toEqual(added);
  });

  it('rescheduling racing completion leaves the column matching the rows', async () => {
    const leadId = await makeLead('race-reschedule');
    const a = await followUp(leadId, h.repA1.id, new Date('2026-10-01T09:00:00Z'));
    const b = await followUp(leadId, h.repA1.id, new Date('2026-10-10T09:00:00Z'));
    await recompute(leadId);

    await Promise.all([
      withTx(T(), async (tx) => {
        await lockLeads(tx, T(), [leadId]);
        await tx.followUpTask.update({
          where: { tenantId: T(), id: a.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await recomputeNextFollowUp(tx, T(), leadId);
      }),
      withTx(T(), async (tx) => {
        await lockLeads(tx, T(), [leadId]);
        await tx.followUpTask.update({
          where: { tenantId: T(), id: b.id },
          data: { dueAt: new Date('2026-09-20T09:00:00Z'), status: 'RESCHEDULED' },
        });
        await recomputeNextFollowUp(tx, T(), leadId);
      }),
    ]);

    // The invariant, not a guessed winner: the column equals a fresh derivation.
    const stored = await storedValue(leadId);
    expect(stored).toEqual(await recompute(leadId));
    expect(stored).toEqual(new Date('2026-09-20T09:00:00Z'));
  });

  it('two moves between the same pair of leads do not deadlock', async () => {
    const left = await makeLead('move-left');
    const right = await makeLead('move-right');
    const one = await task(left, h.repA1.id, new Date('2026-10-01T09:00:00Z'));
    const two = await task(right, h.repA1.id, new Date('2026-10-02T09:00:00Z'));
    await recompute(left);
    await recompute(right);

    // Opposite directions at once. Both lock ascending, so one waits for the
    // other rather than each holding what the other needs.
    const results = await Promise.all([
      withTx(T(), async (tx) => {
        await lockLeads(tx, T(), [left, right]);
        await tx.task.update({ where: { tenantId: T(), id: one.id }, data: { leadId: right } });
        await recomputeNextFollowUp(tx, T(), left);
        await recomputeNextFollowUp(tx, T(), right);
      }).catch((e) => e),
      withTx(T(), async (tx) => {
        await lockLeads(tx, T(), [right, left]);
        await tx.task.update({ where: { tenantId: T(), id: two.id }, data: { leadId: left } });
        await recomputeNextFollowUp(tx, T(), right);
        await recomputeNextFollowUp(tx, T(), left);
      }).catch((e) => e),
    ]);

    for (const r of results) expect(r, 'neither transaction should deadlock').not.toBeInstanceOf(Error);
    // Both columns agree with a fresh derivation, whatever order they landed in.
    expect(await storedValue(left)).toEqual(await recompute(left));
    expect(await storedValue(right)).toEqual(await recompute(right));
  });

  it('reconciliation racing an application write leaves no drift', async () => {
    const leadId = await makeLead('race-reconcile');
    await followUp(leadId, h.repA1.id, new Date('2026-10-01T09:00:00Z'));
    await poison(leadId); // the repair has something to find

    await Promise.all([
      repairDrift(T(), { apply: true }),
      withTx(T(), async (tx) => {
        await lockLeads(tx, T(), [leadId]);
        await tx.followUpTask.create({
          data: {
            tenantId: T(),
            leadId,
            ownerId: h.repA1.id,
            title: 'Concurrent',
            dueAt: new Date('2026-09-01T09:00:00Z'),
          },
        });
        await recomputeNextFollowUp(tx, T(), leadId);
      }),
    ]);

    // The repair re-derives under the lock rather than writing what it measured,
    // so the concurrent obligation cannot be lost whichever order they ran in.
    expect(await storedValue(leadId)).toEqual(new Date('2026-09-01T09:00:00Z'));
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('reconciliation, against deliberately wrong values', () => {
  it('reports missing, stale and unexpected apart from one another', async () => {
    const missing = await makeLead('recon-missing');
    await followUp(missing, h.repA1.id, new Date('2026-10-01T09:00:00Z'));
    await poison(missing, null);

    const stale = await makeLead('recon-stale');
    await followUp(stale, h.repA1.id, new Date('2026-10-02T09:00:00Z'));
    await poison(stale, new Date('1999-01-01T00:00:00Z'));

    const unexpected = await makeLead('recon-unexpected');
    await poison(unexpected, new Date('1999-01-01T00:00:00Z'));

    const correct = await makeLead('recon-correct');
    await followUp(correct, h.repA1.id, new Date('2026-10-03T09:00:00Z'));
    await recompute(correct);

    const report = await reportDrift(T());
    const byLead = new Map(report.samples.map((s) => [s.leadId, s.kind]));

    expect(report.missing).toBeGreaterThanOrEqual(1);
    expect(report.stale).toBeGreaterThanOrEqual(1);
    expect(report.unexpected).toBeGreaterThanOrEqual(1);
    // The correct one is not in the disagreement sample at all.
    expect(byLead.get(correct)).toBeUndefined();
    expect(report.undatedObligations).toBe(0);
  });

  it('a dry run writes nothing', async () => {
    const leadId = await makeLead('recon-dry');
    await followUp(leadId, h.repA1.id, new Date('2026-10-04T09:00:00Z'));
    const wrong = new Date('1999-01-01T00:00:00Z');
    await poison(leadId, wrong);

    const result = await repairDrift(T(), { apply: false });
    expect(result.repaired).toBe(0);
    expect(result.considered).toBeGreaterThan(0);
    expect(await storedValue(leadId)).toEqual(wrong);
  });

  it('applying fixes it, and a second run finds nothing left', async () => {
    const leadId = await makeLead('recon-apply');
    const due = new Date('2026-10-05T09:00:00Z');
    await followUp(leadId, h.repA1.id, due);
    await poison(leadId);

    await repairDrift(T(), { apply: true });
    expect(await storedValue(leadId)).toEqual(due);

    const after = await reportDrift(T());
    expect(after.missing + after.stale + after.unexpected).toBe(0);

    // Idempotent: running it again changes nothing and reports nothing.
    const second = await repairDrift(T(), { apply: true });
    expect(second.considered).toBe(0);
    expect(await storedValue(leadId)).toEqual(due);
  });

  it('counts open rows in each store separately', async () => {
    const report = await reportDrift(T());
    expect(report.openTasks).toBeGreaterThan(0);
    expect(report.openFollowUps).toBeGreaterThan(0);
    // Both stores are live; neither has been narrowed away.
    expect(report.leads).toBeGreaterThan(0);
  });
});
