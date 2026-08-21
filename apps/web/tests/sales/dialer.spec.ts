import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { advance, endSession, resumeOrStart, sweepStaleClaims } from '@/services/dialer/session';
import { loadQueue, queueStats } from '@/services/dialer/queue';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * The acceptance criterion is the test plan: "dialer state survives a page
 * refresh; no call is lost or double-dialled."
 *
 * Everything below is one of those two, or the queue rules that keep them true.
 */
let fixture: Fixture;
let campaignId: string;

const AGENT_A = 'agent-a';
const AGENT_B = 'agent-b';

async function makeLead(name: string, phone: string, over: Record<string, unknown> = {}) {
  return prisma.lead.create({
    data: {
      tenantId: fixture.a.tenantId,
      reference: `LD-${Math.random().toString(36).slice(2, 10)}`,
      fullName: name,
      phone,
      phoneNormalized: phone,
      stageId: fixture.a.stageId,
      ...over,
    },
    select: { id: true },
  });
}

async function seedQueue(count: number) {
  await prisma.campaignContact.deleteMany({ where: { tenantId: fixture.a.tenantId, campaignId } });
  await prisma.dialerSession.deleteMany({ where: { tenantId: fixture.a.tenantId, campaignId } });

  for (let i = 0; i < count; i++) {
    const phone = `+9715000000${String(i).padStart(2, '0')}`;
    const lead = await makeLead(`Caller ${i}`, phone);
    await prisma.campaignContact.create({
      data: {
        tenantId: fixture.a.tenantId,
        campaignId,
        leadId: lead.id,
        displayName: `Caller ${i}`,
        phone,
        phoneNormalized: phone,
        position: i,
      },
    });
  }
}

beforeAll(async () => {
  fixture = await seedTwoTenants();

  const campaign = await prisma.campaign.create({
    data: {
      tenantId: fixture.a.tenantId,
      name: 'Dialer test campaign',
      code: `DT-${Math.random().toString(36).slice(2, 8)}`,
      campaignType: 'CALLING',
      status: 'RUNNING',
    },
    select: { id: true },
  });
  campaignId = campaign.id;

  await prisma.organizationSetting.upsert({
    where: { tenantId: fixture.a.tenantId },
    create: { tenantId: fixture.a.tenantId, dialerCooldownSeconds: 300, dialerMaxAttempts: 3 },
    update: { dialerCooldownSeconds: 300, dialerMaxAttempts: 3 },
  });
});

beforeEach(async () => {
  await seedQueue(5);
});

afterAll(async () => {
  const tenants = [fixture.a.tenantId, fixture.b.tenantId];
  await prisma.dialerSession.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.campaignContact.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.campaign.deleteMany({ where: { tenantId: { in: tenants } } });
  await fixture.cleanup();
});

// ── "Dialer state survives a page refresh" ───────────────────────────────────
describe('the dialer survives a refresh', () => {
  it('hands back the same session and the same contact', async () => {
    const first = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    expect(first.contact).not.toBeNull();

    // Exactly what the screen does on load. If this started a second session or
    // claimed a second contact, an agent refreshing mid-call would abandon
    // whoever they were speaking to.
    const second = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);

    expect(second.session.id).toBe(first.session.id);
    expect(second.contact?.id).toBe(first.contact?.id);
    expect(second.session.dialed).toBe(first.session.dialed);
  });

  it('keeps the counters across the refresh, because they are columns', async () => {
    const started = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    await advance({
      tenantId: fixture.a.tenantId,
      userId: AGENT_A,
      sessionId: started.session.id,
      action: 'next',
      outcome: 'CONNECTED',
    });

    const resumed = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    expect(resumed.session.dialed).toBe(1);
    expect(resumed.session.connected).toBe(1);
  });

  it('refuses a second campaign rather than silently switching', async () => {
    await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);

    const other = await prisma.campaign.create({
      data: {
        tenantId: fixture.a.tenantId,
        name: 'Second campaign',
        code: `DT2-${Math.random().toString(36).slice(2, 8)}`,
        campaignType: 'CALLING',
      },
      select: { id: true },
    });

    // Switching would abandon whoever the agent was mid-call with.
    await expect(resumeOrStart(fixture.a.tenantId, AGENT_A, other.id)).rejects.toMatchObject({ status: 409 });
    await prisma.campaign.deleteMany({ where: { id: other.id, tenantId: fixture.a.tenantId } });
  });
});

// ── "No call is lost or double-dialled" ──────────────────────────────────────
describe('no contact is handed to two agents', () => {
  it('gives two agents starting at once two different people', async () => {
    const [a, b] = await Promise.all([
      resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId),
      resumeOrStart(fixture.a.tenantId, AGENT_B, campaignId),
    ]);

    expect(a.contact).not.toBeNull();
    expect(b.contact).not.toBeNull();
    // The whole reason the claim is `FOR UPDATE SKIP LOCKED`.
    expect(a.contact!.id).not.toBe(b.contact!.id);
  });

  it('gives two agents advancing at the same instant two different people', async () => {
    const a = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    const b = await resumeOrStart(fixture.a.tenantId, AGENT_B, campaignId);

    const [nextA, nextB] = await Promise.all([
      advance({
        tenantId: fixture.a.tenantId,
        userId: AGENT_A,
        sessionId: a.session.id,
        action: 'next',
        outcome: 'NO_ANSWER',
      }),
      advance({
        tenantId: fixture.a.tenantId,
        userId: AGENT_B,
        sessionId: b.session.id,
        action: 'next',
        outcome: 'NO_ANSWER',
      }),
    ]);

    expect(nextA.contact!.id).not.toBe(nextB.contact!.id);
  });

  it('never leaves a contact claimed by an ended session', async () => {
    const a = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    const held = a.contact!.id;

    await endSession(fixture.a.tenantId, a.session.id, AGENT_A);

    const after = await prisma.campaignContact.findFirstOrThrow({
      where: { id: held, tenantId: fixture.a.tenantId },
      select: { status: true, claimedBySessionId: true, claimedAt: true },
    });
    // Straight back to the front of the queue rather than waiting for the sweep.
    expect(after.status).toBe('PENDING');
    expect(after.claimedBySessionId).toBeNull();
    expect(after.claimedAt).toBeNull();
  });

  it('reaps a session that stopped answering and frees what it held', async () => {
    const a = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    const held = a.contact!.id;

    // A closed laptop: the session is still ACTIVE and still holding somebody.
    await prisma.dialerSession.update({
      where: { id: a.session.id, tenantId: fixture.a.tenantId },
      data: { lastActivityAt: new Date(Date.now() - 60 * 60_000) },
    });

    const released = await sweepStaleClaims(fixture.a.tenantId, campaignId);
    expect(released).toBeGreaterThanOrEqual(1);

    const after = await prisma.campaignContact.findFirstOrThrow({
      where: { id: held, tenantId: fixture.a.tenantId },
      select: { status: true, claimedBySessionId: true },
    });
    expect(after.status).toBe('PENDING');
    expect(after.claimedBySessionId).toBeNull();
  });
});

// ── Queue rules ──────────────────────────────────────────────────────────────
describe('the queue rules', () => {
  it('will not hand out a number rung inside the cooldown', async () => {
    const a = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    const contact = a.contact!;

    // A call placed seconds ago against this number, by anyone.
    await prisma.call.create({
      data: {
        tenantId: fixture.a.tenantId,
        callerId: fixture.a.userId,
        recipientNumber: contact.phone,
        startedAt: new Date(),
        status: 'COMPLETED',
      },
    });

    await advance({
      tenantId: fixture.a.tenantId,
      userId: AGENT_A,
      sessionId: a.session.id,
      action: 'next',
      outcome: 'NO_ANSWER',
    });

    // Re-queued by the NO_ANSWER, but not offered again while it is cooling.
    const resumed = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    expect(resumed.contact?.phone).not.toBe(contact.phone);
  });

  it('does not burn an attempt on a skip', async () => {
    const a = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    const skipped = a.contact!.id;

    await advance({ tenantId: fixture.a.tenantId, userId: AGENT_A, sessionId: a.session.id, action: 'skip' });

    const after = await prisma.campaignContact.findFirstOrThrow({
      where: { id: skipped, tenantId: fixture.a.tenantId },
      select: { status: true, attempts: true },
    });
    // An agent passing on a row must not consume one of the tries the number
    // gets, or a campaign quietly exhausts its own list.
    expect(after.attempts).toBe(0);
    expect(after.status).toBe('SKIPPED');
  });

  it('retires a number on the last of its configured attempts', async () => {
    // dialerMaxAttempts is 3 here. Driven to the boundary directly rather than
    // by looping three rounds through the cooldown, which tests the loop rather
    // than the rule.
    const session = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    const target = session.contact!.id;
    await prisma.campaignContact.updateMany({
      where: { id: target, tenantId: fixture.a.tenantId },
      data: { attempts: 2 },
    });

    await advance({
      tenantId: fixture.a.tenantId,
      userId: AGENT_A,
      sessionId: session.session.id,
      action: 'next',
      outcome: 'NO_ANSWER',
    });

    const after = await prisma.campaignContact.findFirstOrThrow({
      where: { id: target, tenantId: fixture.a.tenantId },
      select: { status: true, attempts: true },
    });
    expect(after.attempts).toBe(3);
    expect(after.status).toBe('EXHAUSTED');
  });

  it('completes rather than exhausts when the last attempt actually connects', async () => {
    const session = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    const target = session.contact!.id;
    await prisma.campaignContact.updateMany({
      where: { id: target, tenantId: fixture.a.tenantId },
      data: { attempts: 2 },
    });

    await advance({
      tenantId: fixture.a.tenantId,
      userId: AGENT_A,
      sessionId: session.session.id,
      action: 'next',
      outcome: 'NOT_INTERESTED',
    });

    // Somebody answered on the third try and said no. That is a finished
    // conversation, not a number that ran out of chances.
    const after = await prisma.campaignContact.findFirstOrThrow({
      where: { id: target, tenantId: fixture.a.tenantId },
      select: { status: true },
    });
    expect(after.status).toBe('COMPLETED');
  });

  it('holds a callback until the time the client asked for', async () => {
    const a = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    const target = a.contact!.id;
    const when = new Date(Date.now() + 2 * 60 * 60_000);

    await advance({
      tenantId: fixture.a.tenantId,
      userId: AGENT_A,
      sessionId: a.session.id,
      action: 'callback',
      callbackAt: when,
    });

    const after = await prisma.campaignContact.findFirstOrThrow({
      where: { id: target, tenantId: fixture.a.tenantId },
      select: { status: true, nextAttemptAt: true },
    });
    expect(after.status).toBe('CALLBACK');
    expect(after.nextAttemptAt?.getTime()).toBeCloseTo(when.getTime(), -3);

    // And it is not offered again before then, however many times the agent asks.
    for (let i = 0; i < 4; i++) {
      const view = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
      expect(view.contact?.id).not.toBe(target);
      await advance({ tenantId: fixture.a.tenantId, userId: AGENT_A, sessionId: a.session.id, action: 'skip' });
    }
  });
});

// ── Loading the queue ────────────────────────────────────────────────────────
describe('loading a campaign queue', () => {
  beforeEach(async () => {
    await prisma.campaignContact.deleteMany({ where: { tenantId: fixture.a.tenantId, campaignId } });
  });

  it('refuses to build a queue from nothing', async () => {
    await expect(
      loadQueue({ tenantId: fixture.a.tenantId, actorId: fixture.a.userId, campaignId }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('skips a lead who asked not to be contacted, a lead with no phone, and a duplicate number', async () => {
    await makeLead('Withdrawn Person', '+971509000001', { consentStatus: 'WITHDRAWN' });
    await prisma.lead.create({
      data: {
        tenantId: fixture.a.tenantId,
        reference: `LD-${Math.random().toString(36).slice(2, 10)}`,
        fullName: 'No Phone',
        stageId: fixture.a.stageId,
      },
    });
    await makeLead('Household One', '+971509000002');
    await makeLead('Household Two', '+971509000002');

    const result = await loadQueue({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      campaignId,
      stageIds: [fixture.a.stageId],
    });

    expect(result.skippedSuppressed).toBeGreaterThanOrEqual(1);
    expect(result.skippedNoPhone).toBeGreaterThanOrEqual(1);
    // Two leads sharing a household number: the second is dropped rather than
    // failing the whole batch on the unique index.
    expect(result.skippedDuplicate).toBeGreaterThanOrEqual(1);

    const queued = await prisma.campaignContact.findMany({
      where: { tenantId: fixture.a.tenantId, campaignId },
      select: { phone: true },
    });
    expect(queued.filter((c) => c.phone === '+971509000002')).toHaveLength(1);
    expect(queued.map((c) => c.phone)).not.toContain('+971509000001');
  });

  it('tops the queue up on a second load rather than duplicating it', async () => {
    await makeLead('Repeat Loader', '+971509000010');

    const first = await loadQueue({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      campaignId,
      stageIds: [fixture.a.stageId],
    });
    const second = await loadQueue({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      campaignId,
      stageIds: [fixture.a.stageId],
    });

    expect(first.loaded).toBeGreaterThan(0);
    // Building a campaign is an interrupted, resumed job; a second press must
    // not wipe the calls already made.
    expect(second.loaded).toBe(0);

    const stats = await queueStats(fixture.a.tenantId, campaignId);
    expect(stats.total).toBe(first.loaded);
  });

  it('never reaches another workspace leads', async () => {
    await loadQueue({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      campaignId,
      stageIds: [fixture.a.stageId],
    });

    const contacts = await prisma.campaignContact.findMany({
      where: { tenantId: fixture.a.tenantId, campaignId },
      select: { leadId: true },
    });
    const foreign = await prisma.lead.findMany({
      where: { tenantId: fixture.b.tenantId, id: { in: contacts.map((c) => c.leadId!).filter(Boolean) } },
      select: { id: true },
    });
    expect(foreign).toHaveLength(0);
  });
});

// ── Which campaigns get called at all ────────────────────────────────────────
/**
 * The dialer worked a campaign's list whatever state the campaign was in.
 *
 * Both the route and the page selected `campaign.status` and neither read it,
 * so Cancel, Complete and Pause stopped nothing on the floor — and a DRAFT
 * campaign, one nobody had pressed Start on, was dialled like a live one.
 *
 * The mid-shift case below is the one that matters and the reason the rule is
 * enforced inside `claimNext`'s statement rather than at the two entrances: an
 * agent who is already holding somebody must be handed nobody on their *next*
 * press, without losing the disposition of the call they just made.
 */
describe('a campaign is called only while it is running', () => {
  const setStatus = (status: string) =>
    prisma.campaign.update({
      where: { id: campaignId, tenantId: fixture.a.tenantId },
      data: { status: status as never },
    });

  afterEach(() => setStatus('RUNNING'));

  it('stops handing out people the moment the campaign is cancelled, mid-shift', async () => {
    const started = await resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId);
    const held = started.contact!.id;
    expect(held).toBeTruthy();

    await setStatus('CANCELLED');

    const next = await advance({
      tenantId: fixture.a.tenantId,
      userId: AGENT_A,
      sessionId: started.session.id,
      action: 'next',
      outcome: 'NO_ANSWER',
    });

    // Nobody else. Without the condition inside the claim this is the next
    // contact in the queue, which is the defect.
    expect(next.contact).toBeNull();
    expect(next.blockedBy).toMatch(/cancelled/i);

    // And the call that already happened still counted. Enforcing the rule by
    // throwing would have rolled this back — a real call losing its outcome is
    // a worse trade than one extra dial.
    const worked = await prisma.campaignContact.findFirstOrThrow({
      where: { id: held, tenantId: fixture.a.tenantId },
      select: { attempts: true, outcome: true, claimedBySessionId: true },
    });
    expect(worked.attempts).toBe(1);
    expect(worked.outcome).toBe('NO_ANSWER');
    expect(worked.claimedBySessionId).toBeNull();
    expect(next.session.dialed).toBe(1);
  });

  it('refuses to open a dialer on a paused campaign, and says how to resume it', async () => {
    await setStatus('PAUSED');

    await expect(resumeOrStart(fixture.a.tenantId, AGENT_B, campaignId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/paused.*resume/i),
    });
    // No session row left behind saying somebody started a shift on it.
    expect(
      await prisma.dialerSession.count({ where: { tenantId: fixture.a.tenantId, campaignId, userId: AGENT_B } }),
    ).toBe(0);
  });

  it('refuses a campaign nobody has started', async () => {
    // A behaviour change, and the intended one: DRAFT means the list is still
    // being built. The way out is the Start button the campaign page already has.
    await setStatus('DRAFT');

    await expect(resumeOrStart(fixture.a.tenantId, AGENT_A, campaignId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/not been started/i),
    });
  });

  it('still lets the list be built before the campaign starts', async () => {
    // Deliberately a different rule from the dialer's: a queue is curated first
    // and the campaign is started afterwards, which is the order of the work.
    await setStatus('DRAFT');
    await prisma.campaignContact.deleteMany({ where: { tenantId: fixture.a.tenantId, campaignId } });
    await makeLead('Built Before Start', '+971509000090');

    const result = await loadQueue({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      campaignId,
      stageIds: [fixture.a.stageId],
    });

    expect(result.loaded).toBeGreaterThan(0);
  });

  it('refuses to add anybody to a campaign that is over', async () => {
    await setStatus('COMPLETED');
    await makeLead('Too Late', '+971509000091');

    await expect(
      loadQueue({
        tenantId: fixture.a.tenantId,
        actorId: fixture.a.userId,
        campaignId,
        stageIds: [fixture.a.stageId],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
