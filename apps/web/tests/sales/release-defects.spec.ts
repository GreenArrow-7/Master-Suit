/**
 * The four release-candidate defects closed before handover.
 *
 * Each one is a way the next-follow-up work could have shipped and then behaved
 * badly in a customer's workspace, so each gets a test that fails if the guard
 * is removed rather than a note saying it was considered.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { compileFilterTree, referencedFields, WITHDRAWN_FIELDS, type FilterNode } from '@/lib/api/filterTree';
import { updateRecordField, loadRecord } from '@/services/automation/records';
import { isProtectedField, protectedFields, ProtectedFieldError } from '@/services/automation/writableFields';
import { emptyFollowUpLabel, type ObligationAccess } from '@/services/leads/nextFollowUp';
import { buildActor, buildCtx } from '../helpers/ctx';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

let fixture: Fixture;
let leadId = '';
const suffix = randomBytes(3).toString('hex');

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const stage = await prisma.leadStage.findFirstOrThrow({
    where: { tenantId: fixture.a.tenantId },
    select: { id: true },
  });
  const lead = await prisma.lead.create({
    data: {
      tenantId: fixture.a.tenantId,
      reference: `RCD-${suffix}`,
      fullName: 'Automation target',
      stageId: stage.id,
    },
    select: { id: true },
  });
  leadId = lead.id;
}, 120_000);

afterAll(async () => {
  await fixture?.cleanup();
});

// ───────────────────────────────────────────────────────────────────────────

describe('automation may not write the derived follow-up date', () => {
  it('an ordinary permitted update still works', async () => {
    await updateRecordField(fixture.a.tenantId, 'LEAD', leadId, 'priority', 'HIGH');
    const after = await loadRecord(fixture.a.tenantId, 'LEAD', leadId);
    expect(after.priority).toBe('HIGH');
  });

  it('a second ordinary field still works, so the guard is not blanket', async () => {
    await updateRecordField(fixture.a.tenantId, 'LEAD', leadId, 'company', 'Gulf Stone');
    const after = await loadRecord(fixture.a.tenantId, 'LEAD', leadId);
    expect(after.company).toBe('Gulf Stone');
  });

  it('tagging still works — it goes through the same boundary', async () => {
    const { addTag } = await import('@/services/automation/records');
    await addTag(fixture.a.tenantId, 'LEAD', leadId, `rc-${suffix}`);
    const after = await loadRecord(fixture.a.tenantId, 'LEAD', leadId);
    expect(after.tags).toContain(`rc-${suffix}`);
  });

  it('refuses nextFollowUpAt, and writes nothing', async () => {
    const before = await loadRecord(fixture.a.tenantId, 'LEAD', leadId);
    await expect(
      updateRecordField(fixture.a.tenantId, 'LEAD', leadId, 'nextFollowUpAt', new Date('2030-01-01')),
    ).rejects.toBeInstanceOf(ProtectedFieldError);

    const after = await loadRecord(fixture.a.tenantId, 'LEAD', leadId);
    expect(after.nextFollowUpAt).toEqual(before.nextFollowUpAt);
  });

  it('the refusal explains where the date actually comes from', async () => {
    await expect(updateRecordField(fixture.a.tenantId, 'LEAD', leadId, 'nextFollowUpAt', new Date())).rejects.toThrow(
      /derived from the open tasks and follow-ups/,
    );
  });

  it('refuses identity and audit columns on every object type', () => {
    for (const objectType of ['LEAD', 'OPPORTUNITY', 'ACCOUNT', 'CONTACT'] as const) {
      for (const field of ['id', 'tenantId', 'createdAt', 'updatedAt', 'deletedAt']) {
        expect(isProtectedField(objectType, field), `${objectType}.${field}`).toBe(true);
      }
    }
  });

  it('protects nextFollowUpAt on LEAD only', () => {
    expect(isProtectedField('LEAD', 'nextFollowUpAt')).toBe(true);
    expect(isProtectedField('ACCOUNT', 'nextFollowUpAt')).toBe(false);
  });

  it('does not protect the business fields the release deliberately left open', () => {
    // Recorded as a known gap rather than closed: blocking these would remove a
    // capability a customer may already be using. If that decision is revisited
    // this test is the thing that has to change, deliberately.
    for (const field of ['score', 'grade', 'slaState', 'slaDueAt', 'lastActivityAt']) {
      expect(protectedFields('LEAD')).not.toContain(field);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('an empty follow-up cell describes the viewer, not the lead', () => {
  const access = (unrestricted: boolean): ObligationAccess => ({
    task: unrestricted ? { kind: 'all' } : { kind: 'ids', ids: ['u1'] },
    followUp: unrestricted ? { kind: 'all' } : { kind: 'ids', ids: ['u1'] },
    unrestricted,
  });

  it('a personal view says the action is not assigned to you', () => {
    expect(emptyFollowUpLabel(access(false), 'personal')).toBe('No action assigned to you');
  });

  it('a limited team view says the same about the team', () => {
    expect(emptyFollowUpLabel(access(false), 'scope', 'someone-else')).toBe('No action assigned to your team');
  });

  it("a rep's team view says 'you', because their team is themselves", () => {
    // `scope` and `personal` resolve to the same owner set for a rep, so
    // "nothing assigned to your team" would be both confusing and wrong.
    expect(emptyFollowUpLabel(access(false), 'scope', 'u1')).toBe('No action assigned to you');
  });

  it('only a viewer who sees every obligation is told nothing is scheduled', () => {
    expect(emptyFollowUpLabel(access(true), 'scope')).toBe('No action scheduled');
    expect(emptyFollowUpLabel(access(true), 'personal')).toBe('No action scheduled');
  });

  it('no label claims work exists elsewhere', () => {
    // The withdrawn behaviour read the unrestricted cache as a boolean and
    // rendered "Not yours", which told every viewer whether a colleague had
    // work on each lead on screen. No label may imply that again.
    const all = [
      emptyFollowUpLabel(access(false), 'personal'),
      emptyFollowUpLabel(access(false), 'scope', 'someone-else'),
      emptyFollowUpLabel(access(false), 'scope', 'u1'),
      emptyFollowUpLabel(access(true), 'scope'),
    ];
    for (const label of all) {
      expect(label.toLowerCase()).not.toMatch(/someone|somebody|else|not yours|assigned to another/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('saved views built on the withdrawn filter', () => {
  const ctx = buildCtx(buildActor({ id: 'u1', tenantId: 't1' }));
  const overdueLeaf: FilterNode = { field: 'nextFollowUpAt', cmp: 'relative', value: 'overdue' } as FilterNode;

  it('the field is gone from the filter map', () => {
    expect(() => compileFilterTree('LEAD', overdueLeaf, ctx)).toThrow();
  });

  it('the refusal explains the withdrawal rather than reading as a typo', () => {
    expect(() => compileFilterTree('LEAD', overdueLeaf, ctx)).toThrow(/withdrawn/i);
    expect(WITHDRAWN_FIELDS['LEAD.nextFollowUpAt']).toMatch(/Overdue or No Next Action/);
  });

  it('is still detectable in a saved tree, so a screen can react to it', () => {
    const tree: FilterNode = { op: 'AND', children: [overdueLeaf] } as FilterNode;
    expect(referencedFields(tree)).toContain('nextFollowUpAt');
  });

  it('a filter on a field that never existed still reports unknown, not withdrawn', () => {
    const bogus: FilterNode = { field: 'notAColumn', cmp: 'eq', value: 'x' } as FilterNode;
    expect(() => compileFilterTree('LEAD', bogus, ctx)).toThrow(/Cannot filter on/);
  });

  it('an unrelated saved filter still compiles', () => {
    const ok: FilterNode = { field: 'slaState', cmp: 'eq', value: 'BREACHED' } as FilterNode;
    expect(compileFilterTree('LEAD', ok, ctx)).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('the follow-up column reaches a phone', () => {
  it('is not hidden on mobile', async () => {
    const { resolveColumns } = await import('@/lib/grid/columns');
    const followUp = resolveColumns('LEAD', null).find((c) => c.key === 'nextFollowUpAt');
    expect(followUp, 'the follow-up column is in the default LEAD set').toBeDefined();
    expect(followUp?.hideMobile ?? false, 'a rep checks this on a phone between appointments').toBe(false);
  });
});
