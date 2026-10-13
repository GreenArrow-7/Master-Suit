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
import type { VisibilityScope } from '@prisma/client';
import { prisma } from '@/lib/db';
import { POST as mergePost } from '@/app/api/v1/leads/[id]/merge/route';
import { POST as restorePost } from '@/app/api/v1/leads/[id]/restore/route';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import MergeLeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/merge/page';
import { createWorkspaceUser, grantPermissions, seedHierarchy, type Grants, type Hierarchy } from '../helpers/fixtures';
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

/** A person in the hierarchy's workspace with these lead grants, each at its scope, on `teamId`'s team. */
async function person(key: string, grants: [Grants, VisibilityScope][], teamId?: string) {
  const role = await prisma.role.create({
    data: { tenantId: h.tenantId, key: `${key}-${stamp}`, name: key, rank: 70, defaultScope: 'OWN' },
  });
  for (const [pairs, scope] of grants) await grantPermissions(h.tenantId, role.id, pairs, scope);
  const user = await createWorkspaceUser({
    tenantId: h.tenantId,
    roleId: role.id,
    email: `${key}-${stamp}@hierarchy.test`,
    fullName: key,
  });
  if (teamId) await prisma.userTeam.create({ data: { tenantId: h.tenantId, userId: user.id, teamId } });
  return { id: user.id, cookie: await createSessionToken(h.tenantId, user.id) };
}
const teamOf = async (userId: string) =>
  (await prisma.userTeam.findFirstOrThrow({ where: { tenantId: h.tenantId, userId } })).teamId;

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

  it('leaves a second client profile, a second referral and a referral between the two behind, and audits what moved', async () => {
    const t = h.tenantId;
    const kept = await lead(h.repA1.id);
    const other = await lead(h.repA1.id);
    const third = await lead(h.repA1.id);
    // The kept lead was closed out before as a duplicate of the other: it does not become one of itself.
    await prisma.lead.update({ where: { tenantId: t, id: kept.id }, data: { duplicateOfId: other.id } });
    // One live client profile per lead, and one referral naming a lead as referred (partial unique indexes).
    const keptProfile = await prisma.clientProfile.create({ data: { tenantId: t, leadId: kept.id } });
    const otherProfile = await prisma.clientProfile.create({ data: { tenantId: t, leadId: other.id } });
    const code = await prisma.referralCode.create({
      data: { tenantId: t, code: `RC-${stamp}`, issuedById: h.repA1.id, leadId: third.id },
    });
    const referral = (data: { referredLeadId: string; referrerLeadId?: string }) =>
      prisma.referral.create({ data: { tenantId: t, codeId: code.id, ...data } });
    const keptReferred = await referral({ referredLeadId: kept.id });
    const keptReferredOther = await referral({ referredLeadId: other.id, referrerLeadId: kept.id });
    const otherReferredThird = await referral({ referredLeadId: third.id, referrerLeadId: other.id });
    const communication = await prisma.communication.create({
      data: { tenantId: t, leadId: other.id, channel: 'EMAIL', direction: 'INBOUND', toAddress: 'sales@merge.test' },
    });
    const conversation = await prisma.conversation.create({
      data: { tenantId: t, leadId: other.id, channel: 'WHATSAPP', externalId: `wa-${stamp}` },
    });
    const assignment = await prisma.leadAssignmentHistory.create({
      data: { tenantId: t, leadId: other.id, toOwnerId: h.repA1.id },
    });
    const started = new Date();

    const res = await merge(h.repA1.cookie, kept.id, other.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const byId = (id: string) => ({ where: { tenantId: t, id } });
    expect((await prisma.clientProfile.findFirstOrThrow(byId(keptProfile.id))).leadId).toBe(kept.id);
    expect((await prisma.clientProfile.findFirstOrThrow(byId(otherProfile.id))).leadId).toBe(other.id);
    expect((await prisma.referral.findFirstOrThrow(byId(keptReferred.id))).referredLeadId).toBe(kept.id);
    // Kept referring kept would mean nothing: that referral stays with the merged lead.
    expect(await prisma.referral.findFirstOrThrow(byId(keptReferredOther.id))).toMatchObject({
      referredLeadId: other.id,
      referrerLeadId: kept.id,
    });
    expect((await prisma.referral.findFirstOrThrow(byId(otherReferredThird.id))).referrerLeadId).toBe(kept.id);
    expect((await prisma.communication.findFirstOrThrow(byId(communication.id))).leadId).toBe(kept.id);
    expect((await prisma.conversation.findFirstOrThrow(byId(conversation.id))).leadId).toBe(kept.id);
    expect((await prisma.leadAssignmentHistory.findFirstOrThrow(byId(assignment.id))).leadId).toBe(kept.id);
    expect((await prisma.lead.findFirstOrThrow(byId(kept.id))).duplicateOfId).toBeNull();

    // The audit names every record that moved, so a wrong merge can be taken apart by hand.
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: t, recordId: kept.id, fieldKey: 'mergedFrom', occurredAt: { gte: started } },
    });
    expect(log.metadata).toMatchObject({
      moved: {
        communication: [communication.id],
        conversation: [conversation.id],
        leadAssignmentHistory: [assignment.id],
        referral: [otherReferredThird.id],
      },
    });
  });

  it('keeps one of each shared record, takes the other’s number as the main one, and a lead merged twice names the last', async () => {
    const t = h.tenantId;
    const keptPhone = number();
    const otherPhone = number();
    const first = await lead(h.repA1.id);
    const kept = await lead(h.repA1.id, { phone: keptPhone, phoneNormalized: keptPhone });
    const other = await lead(h.repA1.id, { phone: otherPhone, phoneNormalized: otherPhone, phoneIsWhatsapp: true });
    for (const id of [kept.id, other.id]) {
      await prisma.leadProject.create({ data: { tenantId: t, leadId: id, projectId } });
      await prisma.leadCustomFieldValue.create({
        data: { tenantId: t, leadId: id, definitionId, valueText: id === kept.id ? 'Kept' : 'Other' },
      });
    }
    // The first lead went into the other one before.
    expect((await merge(h.repA1.cookie, other.id, first.id)).status).toBe(200);

    const res = await merge(h.repA1.cookie, kept.id, other.id, ['phone']);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await prisma.lead.findFirstOrThrow({
      where: { tenantId: t, id: kept.id },
      include: { phones: true },
    });
    expect(after).toMatchObject({ phone: otherPhone, phoneNormalized: otherPhone, phoneIsWhatsapp: true });
    // Its own main number is now another number, named for where it came from; the new main is not repeated.
    expect(after.phones.map((p) => [p.normalized, p.label])).toEqual([[keptPhone, `Main number of ${kept.reference}`]]);
    expect(await prisma.leadProject.count({ where: { tenantId: t, leadId: kept.id } })).toBe(1);
    const values = await prisma.leadCustomFieldValue.findMany({ where: { tenantId: t, leadId: kept.id } });
    expect(values.map((v) => v.valueText)).toEqual(['Kept']);

    cookieJar.value = h.repA1.cookie;
    const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: first.id }) }));
    expect(text).toContain('was merged into');
    expect(text).toContain(kept.reference);
  });

  it('needs what an owner change needs when different people own the leads, and the claim rule for an unassigned one', async () => {
    const mine = await lead(h.repA1.id);
    // repA1 works this one as its second owner; repA2 owns it.
    const shared = await lead(h.repA2.id, { secondaryOwnerId: h.repA1.id });
    const pool = await lead(h.repA1.id, { ownerId: null });
    expect((await merge(h.repA1.cookie, mine.id, shared.id)).status).toBe(403);
    expect((await merge(h.repA1.cookie, shared.id, mine.id)).status).toBe(403);
    // A rep may not claim from the pool, so a merge does not either.
    expect((await merge(h.repA1.cookie, mine.id, pool.id)).status).toBe(404);
    expect((await merge(h.repA1.cookie, pool.id, mine.id)).status).toBe(404);

    // Edits the team's leads, may not reassign them.
    const editor = await person(
      'team-editor',
      [
        [[['leads', 'VIEW']], 'ORGANIZATION'],
        [[['leads', 'EDIT']], 'TEAM'],
      ],
      await teamOf(h.repA1.id),
    );
    const theirs = await lead(h.repA2.id);
    expect((await merge(editor.cookie, mine.id, theirs.id)).status).toBe(403);
    const rows = await prisma.lead.findMany({
      where: { tenantId: h.tenantId, id: { in: [shared.id, pool.id, theirs.id] } },
      select: { isMerged: true },
    });
    expect(rows.every((row) => !row.isMerged)).toBe(true);
    // Two leads one person owns: no owner changes.
    expect((await merge(editor.cookie, mine.id, (await lead(h.repA1.id)).id)).status).toBe(200);

    // The team manager may assign within the team and claim from the pool.
    expect((await merge(h.teamManagerA.cookie, mine.id, pool.id)).status).toBe(200);
    expect((await merge(h.teamManagerA.cookie, mine.id, shared.id)).status).toBe(200);
  });

  it('the lead page offers a merge only where the viewer could make it', async () => {
    const editor = await person(
      'notice-editor',
      [
        [[['leads', 'VIEW']], 'ORGANIZATION'],
        [[['leads', 'EDIT']], 'TEAM'],
      ],
      await teamOf(h.repA1.id),
    );
    const shared = number();
    const same = { phone: shared, phoneNormalized: shared };
    // Team 2's: they see it, they do not edit it.
    const outside = await lead(h.repB1.id, same);
    const inside = await lead(h.repA1.id, same);
    const twin = await lead(h.repA1.id, same);
    const otherOwner = await lead(h.repA2.id, same);
    cookieJar.value = editor.cookie;

    const outsideText = await pageText(LeadDetailPage({ params: Promise.resolve({ id: outside.id }) }));
    expect(outsideText).toContain(outside.reference);
    expect(outsideText).not.toContain('/merge?with=');

    const insideText = await pageText(LeadDetailPage({ params: Promise.resolve({ id: inside.id }) }));
    expect(insideText).toContain(`/leads/${inside.id}/merge?with=${twin.id}`);
    // A merge would hand this one to another owner, which the role may not do.
    expect(insideText).not.toContain(`merge?with=${otherOwner.id}`);
    expect(insideText).not.toContain(`merge?with=${outside.id}`);
  });

  it('the compare screen opens only for two leads the viewer may merge', async () => {
    const mine = await lead(h.repA1.id, { email: `mine-${stamp}@merge.test` });
    const mineToo = await lead(h.repA1.id);
    const theirs = await lead(h.repA2.id, { email: `theirs-${stamp}@merge.test` });
    const coOwned = await lead(h.repA2.id, { secondaryOwnerId: h.repA1.id });
    const open = (id: string, other: string) =>
      MergeLeadsPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ with: other }) });
    // next.config.ts's experimental.authInterrupts, which forbidden() needs.
    vi.stubEnv('__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS', 'true');

    cookieJar.value = h.repA1.cookie;
    const text = await pageText(open(mine.id, mineToo.id));
    expect(text).toContain(mineToo.reference);
    expect(text).toContain(`mine-${stamp}@merge.test`);
    await expect(open(mine.id, theirs.id)).rejects.toThrow(/;404$/);
    await expect(open(theirs.id, mine.id)).rejects.toThrow(/;404$/);
    // Theirs to a second owner: the merge would hand it over, which a rep may not do.
    await expect(open(mine.id, coOwned.id)).rejects.toThrow(/;403$/);

    const viewer = await person('compare-viewer', [[[['leads', 'VIEW']], 'ORGANIZATION']]);
    cookieJar.value = viewer.cookie;
    await expect(open(mine.id, mineToo.id)).rejects.toThrow(/;403$/);
    vi.unstubAllEnvs();
  });

  it('a role that sees contact details masked keeps the kept lead’s and fills in none of them', async () => {
    const masked = await person('masked', [
      [
        [
          ['leads', 'VIEW'],
          ['leads', 'EDIT'],
        ],
        'OWN',
      ],
    ]);
    const keptPhone = number();
    const otherPhone = number();
    const kept = await lead(masked.id, {
      phone: keptPhone,
      phoneNormalized: keptPhone,
      email: `masked-kept-${stamp}@merge.test`,
    });
    const other = await lead(masked.id, {
      phone: otherPhone,
      phoneNormalized: otherPhone,
      email: `masked-other-${stamp}@merge.test`,
      whatsappNumber: otherPhone,
      secondaryEmail: `masked-second-${stamp}@merge.test`,
      company: 'Masked Co',
    });
    const res = await merge(masked.cookie, kept.id, other.id, ['phone', 'email', 'company']);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: kept.id } })).toMatchObject({
      phone: keptPhone,
      email: `masked-kept-${stamp}@merge.test`,
      whatsappNumber: null,
      secondaryEmail: null,
      company: 'Masked Co',
    });
  });

  it('a merged lead is not restored as a deleted one (the grid’s Undo route)', async () => {
    const restorer = await person('restorer', [
      [
        [
          ['leads', 'VIEW'],
          ['leads', 'EDIT'],
          ['leads', 'DELETE'],
        ],
        'ORGANIZATION',
      ],
    ]);
    const kept = await lead(restorer.id);
    const other = await lead(restorer.id);
    expect((await merge(restorer.cookie, kept.id, other.id)).status).toBe(200);
    const res = await post(restorePost, `/api/v1/leads/${other.id}/restore`, {}, restorer.cookie, { id: other.id });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(
      await prisma.lead.findFirst({
        where: { tenantId: h.tenantId, id: other.id, isMerged: true, deletedAt: { not: null } },
        select: { id: true },
      }),
    ).toEqual({ id: other.id });
  });
});
