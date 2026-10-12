import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as logActivity } from '@/app/api/v1/activities/route';
import { POST as createLead } from '@/app/api/v1/leads/route';
import { PATCH as editSource } from '@/app/api/v1/lead-sources/route';
import { GET as readScoring, PUT as saveScoring } from '@/app/api/v1/lead-scoring/route';
import { ensureLeadSources } from '@/services/leads/leadSources';
import { takeEnquiry } from '@/services/leads/intake';
import { runScoreDecay } from '@/services/leads/scoring';
import { grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { get, patch, post, put as send } from '../helpers/request';

/**
 * Lead scoring (Lead Eagle audit row M4-11): a lead starts at its source's
 * points, a logged activity adds its type's `scoreDelta`, and the nightly decay
 * takes the workspace's rule's points for every period without activity. Each
 * change is a LeadScoreHistory row and an audit row. The arithmetic itself is
 * pinned in tests/unit/lead-scoring.spec.ts.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
let callTypeId: string;
let noteTypeId: string;
let walkInId: string;
let websiteId: string;

const DAY = 86_400_000;
const lead = (id: string) => prisma.lead.findFirstOrThrow({ where: { tenantId, id } });
const history = (leadId: string) =>
  prisma.leadScoreHistory.findMany({ where: { tenantId, leadId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  const { roleId } = await prisma.user.findFirstOrThrow({
    where: { tenantId, id: fixture.a.userId },
    select: { roleId: true },
  });
  await grantPermissions(tenantId, roleId, [
    ['settings', 'VIEW'],
    ['settings', 'MANAGE_CONFIGURATION'],
  ]);
  // The provisioning defaults (provisionLeadWork): an outbound call is worth 3, a note nothing.
  callTypeId = (
    await prisma.activityType.create({ data: { tenantId, key: 'call_out', name: 'Outbound call', scoreDelta: 3 } })
  ).id;
  noteTypeId = (await prisma.activityType.create({ data: { tenantId, key: 'note', name: 'Lead note' } })).id;
  await ensureLeadSources(prisma, tenantId);
  const entries = await prisma.leadSource.findMany({ where: { tenantId } });
  walkInId = entries.find((e) => e.key === 'walk_in')!.id;
  websiteId = entries.find((e) => e.key === 'website')!.id;
});

const put = (body: Record<string, unknown>) => send(saveScoring, '/api/v1/lead-scoring', body, admin);

afterAll(async () => {
  await fixture.cleanup();
});

describe('a logged activity moves the score by its type (M4-11)', () => {
  it('an outbound call raises the bar by 3, with a history row and an audit row', async () => {
    const id = fixture.a.leadIds[0]!;
    await prisma.lead.update({ where: { tenantId, id }, data: { score: 10 } });

    const res = await post(
      logActivity,
      '/api/v1/activities',
      { typeId: callTypeId, leadId: id, outcome: 'Spoke' },
      admin,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect((await lead(id)).score).toBe(13);
    expect(await history(id)).toEqual([expect.objectContaining({ delta: 3, scoreAfter: 13, ruleId: null })]);
    expect((await history(id))[0]!.reason).toContain('Outbound call');
    const audited = await prisma.auditLog.findFirst({
      where: { tenantId, recordId: id, objectType: 'lead', fieldKey: 'score' },
    });
    expect(audited).toMatchObject({ previousValue: 10, newValue: 13 });
  });

  it('a type worth nothing leaves the score and writes no history', async () => {
    const id = fixture.a.leadIds[1]!;
    await prisma.lead.update({ where: { tenantId, id }, data: { score: 40 } });
    const res = await post(logActivity, '/api/v1/activities', { typeId: noteTypeId, leadId: id, notes: 'x' }, admin);
    expect(res.status).toBe(200);
    expect((await lead(id)).score).toBe(40);
    expect(await history(id)).toEqual([]);
  });

  it('stops at 100', async () => {
    const id = fixture.a.leadIds[2]!;
    await prisma.lead.update({ where: { tenantId, id }, data: { score: 99 } });
    await post(logActivity, '/api/v1/activities', { typeId: callTypeId, leadId: id }, admin);
    expect((await lead(id)).score).toBe(100);
    expect(await history(id)).toEqual([expect.objectContaining({ delta: 1, scoreAfter: 100 })]);
  });
});

describe("a new lead starts at its source's points (M4-11)", () => {
  it('the Sources screen sets the points; a lead from that entry, or a sub-source worth none, starts there', async () => {
    expect((await patch(editSource, `/api/v1/lead-sources?id=${walkInId}`, { weight: 20 }, admin)).status).toBe(200);
    expect((await patch(editSource, `/api/v1/lead-sources?id=${websiteId}`, { weight: 15 }, admin)).status).toBe(200);
    expect((await patch(editSource, `/api/v1/lead-sources?id=${websiteId}`, { weight: 101 }, admin)).status).toBe(422);
    const sub = await prisma.leadSource.create({
      data: { tenantId, parentId: websiteId, key: `website_spring_${Date.now()}`, name: 'Spring' },
    });

    const walkIn = await post(createLead, '/api/v1/leads', { fullName: 'Walked In', sourceId: walkInId }, admin);
    expect(walkIn.status, JSON.stringify(walkIn.body)).toBe(200);
    expect((await lead(walkIn.body.id)).score).toBe(20);
    const spring = await post(createLead, '/api/v1/leads', { fullName: 'Spring Form', sourceId: sub.id }, admin);
    expect((await lead(spring.body.id)).score).toBe(15);
    const none = await post(createLead, '/api/v1/leads', { fullName: 'No Source' }, admin);
    expect((await lead(none.body.id)).score).toBe(0);
  });

  it('an enquiry from a connected source starts at its entry too', async () => {
    const result = await takeEnquiry(
      tenantId,
      {
        fullName: 'Portal Walk',
        email: null,
        phones: [`05${Date.now() % 100_000_000}`],
        message: null,
        reference: null,
        details: [],
      },
      { label: 'Walk-in', source: 'MANUAL', sourceDetail: 'walk_in', sourceId: walkInId },
    );
    expect(result).toMatchObject({ created: true });
    expect((await lead((result as { leadId: string }).leadId)).score).toBe(20);
  });
});

describe('the nightly decay (M4-11)', () => {
  it('is off until the workspace sets a rule, which the scoring API reads and writes', async () => {
    expect((await get(readScoring, '/api/v1/lead-scoring', admin)).body).toEqual({ decay: null });
    const idle = fixture.a.leadIds[3]!;
    await prisma.lead.update({
      where: { tenantId, id: idle },
      data: { score: 30, lastActivityAt: new Date(Date.now() - 30 * DAY) },
    });
    await runScoreDecay(new Date(), [tenantId]);
    expect((await lead(idle)).score).toBe(30);

    const saved = await put({ decayDays: 7, decayAmount: 5, isActive: true });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await put({ decayDays: 0, decayAmount: 5, isActive: true })).status).toBe(422);
    expect((await get(readScoring, '/api/v1/lead-scoring', admin)).body).toEqual({
      decay: { decayDays: 7, decayAmount: 5, isActive: true },
    });
  });

  it('takes the points once per idle period, never below 0, and leaves worked, closed and other leads alone', async () => {
    const now = new Date();
    const [, , , idle, fresh] = fixture.a.leadIds as [string, string, string, string, string];
    await prisma.lead.update({
      where: { tenantId, id: fresh },
      data: { score: 30, lastActivityAt: new Date(now.getTime() - 2 * DAY) },
    });
    const low = (
      await prisma.lead.create({
        data: {
          tenantId,
          reference: `LOW-${Date.now()}`,
          fullName: 'Low Score',
          stageId: fixture.a.stageId,
          score: 3,
          lastActivityAt: new Date(now.getTime() - 9 * DAY),
        },
      })
    ).id;
    const closed = (
      await prisma.lead.create({
        data: {
          tenantId,
          reference: `ARCH-${Date.now()}`,
          fullName: 'Archived',
          stageId: fixture.a.stageId,
          status: 'ARCHIVED',
          score: 30,
          lastActivityAt: new Date(now.getTime() - 30 * DAY),
        },
      })
    ).id;
    const other = fixture.b.leadIds[0]!;
    await prisma.lead.update({
      where: { tenantId: fixture.b.tenantId, id: other },
      data: { score: 30, lastActivityAt: new Date(now.getTime() - 30 * DAY) },
    });

    await runScoreDecay(now, [tenantId, fixture.b.tenantId]);
    expect((await lead(idle)).score).toBe(25);
    expect((await lead(low)).score).toBe(0);
    expect((await lead(fresh)).score).toBe(30);
    expect((await lead(closed)).score).toBe(30);
    expect((await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.b.tenantId, id: other } })).score).toBe(30);
    const rule = await prisma.scoringRule.findFirstOrThrow({ where: { tenantId, triggerType: 'DECAY' } });
    expect(await history(idle)).toEqual([expect.objectContaining({ delta: -5, scoreAfter: 25, ruleId: rule.id })]);
    expect(
      await prisma.auditLog.findFirst({ where: { tenantId, recordId: idle, fieldKey: 'score', actorUserId: null } }),
    ).toMatchObject({ previousValue: 30, newValue: 25 });

    // A second run that night, a retry, changes nothing; a week later takes the next step.
    await runScoreDecay(new Date(now.getTime() + 60_000), [tenantId]);
    expect((await lead(idle)).score).toBe(25);
    await runScoreDecay(new Date(now.getTime() + 7 * DAY), [tenantId]);
    expect((await lead(idle)).score).toBe(20);

    // Switched off: nothing more.
    await put({ decayDays: 7, decayAmount: 5, isActive: false });
    await runScoreDecay(new Date(now.getTime() + 21 * DAY), [tenantId]);
    expect((await lead(idle)).score).toBe(20);
  });

  it('runs from the maintenance queue every night', async () => {
    const { MAINTENANCE_JOBS } = await import('@/workers/maintenance');
    expect(Object.keys(MAINTENANCE_JOBS)).toContain('lead-score-decay');
  });
});
