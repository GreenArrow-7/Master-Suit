import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { updateOpportunity } from '@/services/opportunities/updateOpportunity';
import type { Ctx } from '@/lib/security/rbac';

/**
 * Closing an opportunity, after the fix that makes the status move the stage.
 *
 * The bug these cases pin down was found on a screen recording: a deal marked
 * WON through the product still showed "Qualification · 10%" in its stage bar,
 * with no expected close. `updateOpportunity` set `status` and
 * `actualCloseDate` and left `stageId`/`probability` untouched, so every deal
 * closed through the UI sat mid-funnel forever — in the detail header, in the
 * pipeline board, and in every report that groups by stage. The seed's WON
 * rows masked it by writing stage and status together.
 */

const suffix = randomBytes(4).toString('hex');
const state = {
  tenantId: '',
  actorId: '',
  pipelineId: '',
  stages: {} as Record<string, string>, // key -> id
};

/**
 * The service's own gates run for real: `assertRecordVisible` reads the scope
 * from `actor.permissions`, so the fixture grants ORGANIZATION on the module
 * rather than stubbing the check away.
 */
const ctx = () =>
  ({
    tenantId: state.tenantId,
    actor: { id: state.actorId, permissions: new Map([['opportunities:EDIT', 'ORGANIZATION']]) },
  }) as unknown as Ctx;

async function makeOpportunity(stageKey: string, status: 'OPEN' | 'WON' | 'LOST' = 'OPEN') {
  return prisma.opportunity.create({
    data: {
      tenantId: state.tenantId,
      reference: `OP-${randomBytes(4).toString('hex')}`,
      name: `Deal ${randomBytes(3).toString('hex')}`,
      pipelineId: state.pipelineId,
      stageId: state.stages[stageKey]!,
      probability: 10,
      status,
    },
  });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `oppclose-${suffix}`, legalName: `oppclose ${suffix} LLC`, displayName: `oppclose ${suffix}` },
  });
  state.tenantId = tenant.id;

  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: `agent-${suffix}`, name: 'Agent', rank: 50 },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `closer-${suffix}@example.test`,
      fullName: 'Closer',
      roleId: role.id,
      status: 'ACTIVE',
    },
  });
  state.actorId = user.id;

  const pipeline = await prisma.pipeline.create({
    data: { tenantId: tenant.id, key: `p-${suffix}`, name: 'Default' },
  });
  state.pipelineId = pipeline.id;

  const stages = [
    { key: 'qualification', name: 'Qualification', category: 'OPEN', position: 0, probability: 10 },
    { key: 'proposal', name: 'Proposal', category: 'OPEN', position: 1, probability: 50 },
    { key: 'won', name: 'Closed Won', category: 'CONVERSION', position: 2, probability: 100 },
    { key: 'lost', name: 'Closed Lost', category: 'TERMINAL_NEGATIVE', position: 3, probability: 0 },
  ] as const;
  for (const s of stages) {
    const row = await prisma.pipelineStage.create({
      data: { tenantId: tenant.id, pipelineId: pipeline.id, ...s },
    });
    state.stages[s.key] = row.id;
  }
});

afterAll(async () => {
  await withPlatformTx(async (tx) => {
    if (state.tenantId) await tx.tenant.delete({ where: { id: state.tenantId } });
  });
});

describe('marking an opportunity WON', () => {
  it('moves it to the pipeline’s CONVERSION stage at 100%, with history and a close date', async () => {
    const opp = await makeOpportunity('qualification');

    const after = await updateOpportunity(ctx(), opp.id, { status: 'WON' });

    // The video bug, exactly: status WON with the stage bar still at
    // Qualification · 10%. All four of these were wrong before the fix.
    expect(after.stageId).toBe(state.stages.won);
    expect(after.probability).toBe(100);
    expect(after.status).toBe('WON');
    expect(after.actualCloseDate).not.toBeNull();

    const history = await prisma.opportunityStageHistory.findFirst({
      where: { tenantId: state.tenantId, opportunityId: opp.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(history?.toStageId).toBe(state.stages.won);
  });

  it('clears a stale loss reason when a LOST deal is corrected to WON', async () => {
    const opp = await makeOpportunity('qualification');
    const reason = await prisma.lossReason.create({
      data: { tenantId: state.tenantId, name: 'Priced too high' },
    });
    await updateOpportunity(ctx(), opp.id, { status: 'LOST', lossReasonId: reason.id });

    const after = await updateOpportunity(ctx(), opp.id, { status: 'WON' });
    expect(after.lossReasonId).toBeNull();
    expect(after.stageId).toBe(state.stages.won);
  });

  it('respects an explicit stage chosen in the same request', async () => {
    // A caller that names both knows what it wants; the implied terminal stage
    // must not override an explicit choice.
    const opp = await makeOpportunity('qualification');
    const after = await updateOpportunity(ctx(), opp.id, { status: 'WON', stageId: state.stages.proposal });
    expect(after.stageId).toBe(state.stages.proposal);
    // Probability still snaps to 100: "won at 50% likely" is wrong in any stage.
    expect(after.probability).toBe(100);
  });
});

describe('marking an opportunity LOST', () => {
  it('moves it to the TERMINAL_NEGATIVE stage at 0%', async () => {
    const opp = await makeOpportunity('proposal');
    const after = await updateOpportunity(ctx(), opp.id, { status: 'LOST' });
    expect(after.stageId).toBe(state.stages.lost);
    expect(after.probability).toBe(0);
    expect(after.actualCloseDate).not.toBeNull();
  });
});

describe('reopening', () => {
  it('clears the close date a close set', async () => {
    const opp = await makeOpportunity('qualification');
    await updateOpportunity(ctx(), opp.id, { status: 'WON' });

    const reopened = await updateOpportunity(ctx(), opp.id, { status: 'OPEN' });
    // A live deal with an "actual close" date reads as already over in every
    // list that renders the column.
    expect(reopened.actualCloseDate).toBeNull();
    expect(reopened.status).toBe('OPEN');
  });
});

describe('a pipeline with no terminal stage', () => {
  it('still closes, keeping the stage but snapping probability', async () => {
    const bare = await prisma.pipeline.create({
      data: { tenantId: state.tenantId, key: `bare-${suffix}`, name: 'Bare' },
    });
    const only = await prisma.pipelineStage.create({
      data: {
        tenantId: state.tenantId,
        pipelineId: bare.id,
        key: 'solo',
        name: 'Solo',
        category: 'OPEN',
        position: 0,
        probability: 30,
      },
    });
    const opp = await prisma.opportunity.create({
      data: {
        tenantId: state.tenantId,
        reference: `OP-${randomBytes(4).toString('hex')}`,
        name: 'Bare pipeline deal',
        pipelineId: bare.id,
        stageId: only.id,
        probability: 30,
      },
    });

    const after = await updateOpportunity(ctx(), opp.id, { status: 'WON' });
    // No CONVERSION stage to move to — the close must not fail, and the
    // probability must not stay at 30 on a deal the header calls WON.
    expect(after.stageId).toBe(only.id);
    expect(after.probability).toBe(100);
    expect(after.status).toBe('WON');
  });
});
