// The lead page is a server component that reads the session cookie through
// next/headers; the routes take it from the request, so this only feeds pages.
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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as mergePost } from '@/app/api/v1/leads/[id]/merge/route';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import { createWorkspaceUser, grantPermissions, seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { pageText } from '../helpers/render';
import { post } from '../helpers/request';

/**
 * Merging two leads (Lead Eagle audit row M4-31): everything the other lead
 * holds moves to the kept one in one transaction, its numbers without
 * repeats; the kept lead takes the values chosen on the compare screen, its
 * next follow-up and score are worked out again, and the other lead stays as a
 * merged record whose page names the kept one. Both leads must be in the
 * caller's EDIT scope (404 otherwise), and both are audited.
 */
let h: Hierarchy;
let stageId = '';
let typeId = '';
let taskTypeId = '';
let projectId = '';
let definitionId = '';
const stamp = Date.now();
let seq = 0;
const number = () => `+9715${String(stamp + (seq += 1)).slice(-8)}`;

const merge = (cookie: string, keptId: string, otherId: string, take: string[] = []) =>
  post(mergePost, `/api/v1/leads/${keptId}/merge`, { otherId, take }, cookie, { id: keptId });

async function lead(ownerId: string, data: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.lead.create({
    data: {
      tenantId: h.tenantId,
      reference: `MG-${stamp}-${seq}`,
      fullName: `Merge lead ${seq}`,
      stageId,
      ownerId,
      ...data,
    },
  });
}

beforeAll(async () => {
  h = await seedHierarchy();
  ({ stageId } = await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: h.repA1.leadId } }));
  typeId = (await prisma.activityType.create({ data: { tenantId: h.tenantId, key: `note-${stamp}`, name: 'Note' } }))
    .id;
  taskTypeId = (
    await prisma.taskType.create({ data: { tenantId: h.tenantId, key: `call-${stamp}`, name: 'Call back' } })
  ).id;
  projectId = (
    await prisma.project.create({ data: { tenantId: h.tenantId, name: 'Marina Heights', code: `MH-${stamp}` } })
  ).id;
  definitionId = (
    await prisma.leadCustomFieldDefinition.create({
      data: { tenantId: h.tenantId, key: 'visa', label: 'Visa', type: 'TEXT' },
    })
  ).id;
});
afterAll(async () => {
  await h.cleanup();
});

describe('POST /api/v1/leads/{id}/merge', () => {
  it('moves the other lead’s work, numbers and values onto the kept lead, and keeps it resolvable', async () => {
    const started = new Date();
    const keptPhone = number();
    const otherPhone = number();
    const extraPhone = number();
    const kept = await lead(h.repA1.id, {
      fullName: 'Sara Kept',
      phone: keptPhone,
      phoneNormalized: keptPhone,
      score: 10,
      customData: { budget: '1M' },
    });
    const other = await lead(h.repA1.id, {
      fullName: 'Sara Other',
      phone: otherPhone,
      phoneNormalized: otherPhone,
      email: `sara-${stamp}@merge.test`,
      company: 'Other Co',
      score: 30,
      tags: ['vip'],
      customData: { visa: 'Golden' },
    });
    const t = h.tenantId;
    // Its other numbers: the kept lead's main one (stays behind), and a new one (moves).
    await prisma.leadPhone.createMany({
      data: [
        { tenantId: t, leadId: other.id, raw: keptPhone, normalized: keptPhone },
        { tenantId: t, leadId: other.id, raw: extraPhone, normalized: extraPhone, label: 'Office' },
      ],
    });
    const soon = new Date(Date.now() + 2 * 3_600_000);
    const later = new Date(Date.now() + 86_400_000);
    const children = {
      activity: await prisma.activity.create({ data: { tenantId: t, typeId, leadId: other.id, notes: 'Called' } }),
      task: await prisma.task.create({
        data: {
          tenantId: t,
          typeId: taskTypeId,
          title: 'Call back',
          dueAt: later,
          leadId: other.id,
          ownerId: h.repA1.id,
        },
      }),
      followUp: await prisma.followUpTask.create({
        data: { tenantId: t, ownerId: h.repA1.id, title: 'Send brochure', dueAt: soon, leadId: other.id },
      }),
      document: await prisma.document.create({
        data: {
          tenantId: t,
          leadId: other.id,
          name: 'passport.pdf',
          storageKey: `k-${stamp}`,
          storageBucket: 'docs',
          mimeType: 'application/pdf',
          sizeBytes: 10,
        },
      }),
      stage: await prisma.leadStageHistory.create({ data: { tenantId: t, leadId: other.id, toStageId: stageId } }),
      call: await prisma.call.create({ data: { tenantId: t, callerId: h.repA1.id, leadId: other.id } }),
      requirement: await prisma.clientRequirement.create({ data: { tenantId: t, leadId: other.id, purpose: 'BUY' } }),
      value: await prisma.leadCustomFieldValue.create({
        data: { tenantId: t, leadId: other.id, definitionId, valueText: 'Golden' },
      }),
    };
    await prisma.leadProject.create({ data: { tenantId: t, leadId: other.id, projectId } });
    // A third lead closed out as a duplicate of the other now names the kept one.
    const third = await lead(h.repA1.id, { status: 'DUPLICATE', duplicateOfId: other.id });

    const res = await merge(h.repA1.cookie, kept.id, other.id, ['email', 'company']);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: kept.id, reference: kept.reference, merged: other.reference });

    const after = await prisma.lead.findFirstOrThrow({ where: { tenantId: t, id: kept.id } });
    // The values chosen, and the kept lead's own where none was.
    expect(after).toMatchObject({
      fullName: 'Sara Kept',
      phone: keptPhone,
      email: `sara-${stamp}@merge.test`,
      company: 'Other Co',
      tags: ['vip'],
      score: 30,
    });
    expect(after.customData).toEqual({ budget: '1M', visa: 'Golden' });
    // Its next follow-up is the earliest of both leads' open work.
    expect(after.nextFollowUpAt?.toISOString()).toBe(soon.toISOString());

    // Every number once: the other's main and its new number; never the kept main again.
    const phones = await prisma.leadPhone.findMany({ where: { tenantId: t, leadId: kept.id } });
    expect(phones.map((p) => p.normalized).sort()).toEqual([otherPhone, extraPhone].sort());

    for (const [name, row] of Object.entries(children)) {
      const model = (prisma as unknown as Record<string, { findFirst: (a: object) => Promise<{ leadId: string }> }>)[
        name === 'followUp'
          ? 'followUpTask'
          : name === 'stage'
            ? 'leadStageHistory'
            : name === 'requirement'
              ? 'clientRequirement'
              : name === 'value'
                ? 'leadCustomFieldValue'
                : name
      ]!;
      const moved = await model.findFirst({ where: { tenantId: t, id: row.id } });
      expect(moved.leadId, name).toBe(kept.id);
    }
    expect(await prisma.leadProject.count({ where: { tenantId: t, leadId: kept.id, projectId } })).toBe(1);
    expect(
      (
        await prisma.leadScoreHistory.findFirst({
          where: { tenantId: t, leadId: kept.id },
          orderBy: { createdAt: 'desc' },
        })
      )?.reason,
    ).toContain(other.reference);

    // The other lead stays, merged and out of every list, with its reference.
    const gone = await prisma.lead.findFirstOrThrow({
      where: { tenantId: t, id: other.id, deletedAt: { not: null } },
      select: { isMerged: true, duplicateOfId: true, reference: true },
    });
    expect(gone).toEqual({ isMerged: true, duplicateOfId: kept.id, reference: other.reference });
    expect(
      (await prisma.lead.findFirstOrThrow({ where: { tenantId: t, id: third.id }, select: { duplicateOfId: true } }))
        .duplicateOfId,
    ).toBe(kept.id);

    // Audited on both leads.
    const audited = await prisma.auditLog.findMany({
      where: { tenantId: t, objectType: 'lead', recordId: { in: [kept.id, other.id] }, occurredAt: { gte: started } },
      select: { recordId: true },
    });
    expect(new Set(audited.map((row) => row.recordId))).toEqual(new Set([kept.id, other.id]));

    // Its old page names the lead it went into.
    cookieJar.value = h.repA1.cookie;
    const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: other.id }) }));
    expect(text).toContain('was merged into');
    expect(text).toContain(kept.reference);
    // And the kept lead's timeline carries the other's activity.
    const keptText = await pageText(LeadDetailPage({ params: Promise.resolve({ id: kept.id }) }));
    expect(keptText).toContain('Called');

    // A merged lead cannot be merged again.
    expect((await merge(h.repA1.cookie, kept.id, other.id)).status).toBe(404);
  });

  it('the lead page warns of a duplicate and links the compare screen', async () => {
    const shared = number();
    const a = await lead(h.repA1.id, { phone: shared, phoneNormalized: shared });
    const b = await lead(h.repA1.id, { phone: shared, phoneNormalized: shared });
    // Another rep's copy is not offered: a merge needs both leads in scope.
    const theirs = await lead(h.repA2.id, { phone: shared, phoneNormalized: shared });
    cookieJar.value = h.repA1.cookie;
    const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: a.id }) }));
    expect(text).toContain(b.reference);
    expect(text).toContain(`/leads/${a.id}/merge?with=${b.id}`);
    expect(text).not.toContain(theirs.reference);
  });

  it('answers 404 when either lead is outside the caller’s EDIT scope, and changes nothing', async () => {
    const mine = await lead(h.repA1.id);
    const theirs = await lead(h.repA2.id, { company: 'Theirs' });
    expect((await merge(h.repA1.cookie, mine.id, theirs.id, ['company'])).status).toBe(404);
    expect((await merge(h.repA1.cookie, theirs.id, mine.id)).status).toBe(404);
    const rows = await prisma.lead.findMany({
      where: { tenantId: h.tenantId, id: { in: [mine.id, theirs.id] } },
      select: { isMerged: true, company: true },
    });
    expect(rows.every((row) => !row.isMerged)).toBe(true);
    expect(rows.map((row) => row.company ?? '').sort()).toEqual(['', 'Theirs']);
    // Their team manager reaches both, and merges them.
    expect((await merge(h.teamManagerA.cookie, mine.id, theirs.id)).status).toBe(200);
  });

  it('refuses a lead merged into itself, and a role without leads:EDIT', async () => {
    const one = await lead(h.repA1.id);
    expect((await merge(h.repA1.cookie, one.id, one.id)).status).toBe(422);

    const role = await prisma.role.create({
      data: { tenantId: h.tenantId, key: `viewer-${stamp}`, name: 'Viewer', rank: 70, defaultScope: 'ORGANIZATION' },
    });
    await grantPermissions(h.tenantId, role.id, [['leads', 'VIEW']]);
    const viewer = await createWorkspaceUser({
      tenantId: h.tenantId,
      roleId: role.id,
      email: `viewer-${stamp}@hierarchy.test`,
      fullName: 'Viewer',
    });
    const cookie = await createSessionToken(h.tenantId, viewer.id);
    const two = await lead(h.repA1.id);
    expect((await merge(cookie, one.id, two.id)).status).toBe(403);
  });
});
