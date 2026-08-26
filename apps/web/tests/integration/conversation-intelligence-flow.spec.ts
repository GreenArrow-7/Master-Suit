/**
 * The whole conversation-intelligence chain, end to end, through the real
 * route handlers and the real worker functions:
 *
 *   consent → recording upload → transcription (mock provider, diarised)
 *   → analysis (simulated, no model key) → playbook match → talk ratio
 *   → follow-up email draft → send → Communication + Activity rows
 *   → practice session → scoring → coaching dashboard numbers
 *
 * No external provider is touched: transcription uses the mock provider the
 * module ships for development, analysis runs the deterministic simulation, and
 * email lands in the mock outbox. That is precisely the configuration the
 * acceptance criteria demand works end to end.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * Object storage is mocked at the module seam: CI runs no MinIO service, and
 * this spec is about the pipeline, not S3. The mock transcription provider
 * never reads the audio bytes anyway.
 */
vi.mock('@/lib/storage', () => {
  const objects = new Map<string, Buffer>();
  return {
    putObject: async (key: string, body: Buffer) => {
      objects.set(key, body);
      return key;
    },
    getObject: async (key: string) => {
      const body = objects.get(key);
      if (!body) throw new Error(`mock storage: no object at ${key}`);
      return body;
    },
    deleteObject: async (key: string) => void objects.delete(key),
    moveObject: async (_from: string, to: string) => to,
  };
});
import { mockOutbox } from '@/lib/mailer';
import { wrapCredentials } from '@/lib/integrations/connection';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { get, patch, post } from '../helpers/request';
import { transcribeCall, analyseCall } from '@/services/shared/callIntelligence';
import { scorePracticeSession } from '@/services/shared/practiceScoring';
import { POST as createCall } from '@/app/api/v1/calls/route';
import { POST as recordConsent } from '@/app/api/v1/calls/[id]/consent/route';
import { PUT as uploadRecording } from '@/app/api/v1/calls/[id]/recording/media/route';
import { POST as createObjection } from '@/app/api/v1/objections/route';
import { POST as requestAnalysis } from '@/app/api/v1/calls/[id]/analysis/route';
import { POST as draftFollowUp, PUT as sendFollowUp } from '@/app/api/v1/calls/[id]/follow-up-email/route';
import { POST as startPractice } from '@/app/api/v1/practice/route';
import { POST as practiceTurn, PATCH as finishPractice } from '@/app/api/v1/practice/[id]/route';
import { GET as coachingDashboard } from '@/app/api/v1/coaching/route';

let fixture: Fixture;
let callId: string;
let leadId: string;

/**
 * Waits for a claimed row to reach a terminal status.
 *
 * The routes here run their work inline when no worker is attached and enqueue
 * when one is — so whether this process or a background one executes depends on
 * the machine, not the test. Both are guarded by the same claim, so exactly one
 * runs; the loser returns early. Asserting immediately after driving the work
 * therefore passed only where a worker happened to be running (a developer with
 * `npm run worker` up) and raced in CI, where nothing drains the queue and the
 * route's own inline run is the executor.
 *
 * A stranded PROCESSING row never settles, so this still fails on the very
 * regression the re-run test exists to catch — it just fails on a timeout
 * instead of on a snapshot taken mid-flight.
 */
async function settles(
  read: () => Promise<{ status: string } | null>,
  { tries = 40, waitFor = ['COMPLETED', 'FAILED', 'INSUFFICIENT_DATA'] } = {},
): Promise<{ status: string } | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const row = await read();
    if (row && waitFor.includes(row.status)) return row;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return read();
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  leadId = fixture.a.leadIds[0];
  // The follow-up email resolves its recipient from the call's lead.
  await prisma.lead.update({
    where: { id: leadId, tenantId: fixture.a.tenantId },
    data: { email: 'client@example.test' },
  });
  // The workspace's speech-to-text connection, pointed at the mock provider —
  // the same shape the admin screen writes, exercised through the same
  // credential decryption the worker uses. (The development fallback in
  // transcriptionProviderFor only applies under NODE_ENV=development.)
  await prisma.integrationConnection.create({
    data: {
      tenantId: fixture.a.tenantId,
      provider: 'transcription',
      status: 'CONNECTED',
      credentials: wrapCredentials({ provider: 'mock' }),
    },
  });
}, 60_000);

afterAll(async () => {
  await fixture?.cleanup();
});

describe('ingest → transcribe → analyse → follow-up', () => {
  it('creates the call and records consent', async () => {
    const created = await post(
      createCall,
      '/api/v1/calls',
      { leadId, recipientNumber: '+971509999999' },
      fixture.a.cookie,
    );
    expect(created.status).toBe(200);
    callId = created.body.id;

    const consent = await post(
      recordConsent,
      `/api/v1/calls/${callId}/consent`,
      { consentGiven: true, method: 'VERBAL' },
      fixture.a.cookie,
      { id: callId },
    );
    expect(consent.status).toBe(200);
  });

  it('accepts a recording upload and stores it in the bucket', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(2048)], { type: 'audio/webm' }), 'call.webm');

    const req = new Request(`http://localhost/api/v1/calls/${callId}/recording/media`, {
      method: 'PUT',
      headers: { cookie: fixture.a.cookie },
      body: form,
    });
    const res = await uploadRecording(req, { params: Promise.resolve({ id: callId }) });
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);

    const recording = await prisma.recording.findFirst({ where: { callId, tenantId: fixture.a.tenantId } });
    expect(recording).not.toBeNull();
    expect(recording!.storageBucket).not.toBe('provider');
  });

  it('transcribes through the mock provider with speaker attribution', async () => {
    // Drive the worker function directly — deterministic, no queue needed. The
    // mock transcription provider is the development fallback under test.
    await transcribeCall({ tenantId: fixture.a.tenantId, callId }).catch(() => {
      // The upload route may have already run the chain inline (dev mode);
      // either way the row below must exist.
    });

    const transcript = await prisma.transcript.findFirst({ where: { callId, tenantId: fixture.a.tenantId } });
    expect(transcript).not.toBeNull();
    expect(transcript!.content).toContain('Agent:');
    expect(transcript!.content).toContain('Client:');
    expect((transcript!.segments as unknown[]).length).toBeGreaterThan(0);
  });

  it('analyses the call, measures talk ratio and matches the playbook', async () => {
    // Playbook entry whose trigger appears in the mock transcript, with a
    // recommended response the mock agent's reply overlaps.
    const objection = await post(
      createObjection,
      '/api/v1/objections',
      {
        name: 'Too expensive',
        triggerPhrases: ['too expensive'],
        recommendedResponses: ['Explain the payment plan and the monthly figure over three years.'],
      },
      fixture.a.cookie,
    );
    expect(objection.status).toBe(200);

    // May lose the claim to an inline run the transcript route already started;
    // either executor is fine, the end state is what is asserted.
    await analyseCall({ tenantId: fixture.a.tenantId, callId }).catch(() => {});
    await settles(() => prisma.aIAnalysis.findFirst({ where: { callId, tenantId: fixture.a.tenantId } }));

    const analysis = await prisma.aIAnalysis.findFirst({ where: { callId, tenantId: fixture.a.tenantId } });
    expect(analysis).not.toBeNull();
    expect(analysis!.status).toBe('COMPLETED');
    // No model key in tests: the row must be stamped as simulation, never
    // mistakable for a model verdict.
    expect(analysis!.modelId).toBe('demo-simulation');
    expect(analysis!.promptVersion).toBeTruthy();
    // Measured from the attributed transcript, not asked of any model.
    expect(analysis!.talkRatio).toBeGreaterThan(0);
    expect(analysis!.talkRatio).toBeLessThan(1);

    const matches = await prisma.objectionMatch.findMany({ where: { callId, tenantId: fixture.a.tenantId } });
    expect(matches).toHaveLength(1);
    expect(matches[0].phrase).toBe('too expensive');
    expect(matches[0].addressed).toBe(true);
  });

  it('re-running analysis actually re-runs, instead of stranding PROCESSING', async () => {
    // Regression: the route used to claim the row (set PROCESSING) before
    // queueing, and the worker's own claim then found PROCESSING and skipped —
    // every explicit re-run stranded the row. The route must accept the
    // request, and a subsequent worker run must complete it.
    const rerun = await post(requestAnalysis, `/api/v1/calls/${callId}/analysis`, {}, fixture.a.cookie, {
      id: callId,
    });
    // 200 accepts the re-run; 409 means one is genuinely in flight already,
    // which is the route doing its job. The bug being guarded against produced
    // neither — it accepted the request and then nothing ever ran.
    expect([200, 409]).toContain(rerun.status);

    await analyseCall({ tenantId: fixture.a.tenantId, callId }).catch(() => {});
    const row = await settles(() => prisma.aIAnalysis.findFirst({ where: { callId, tenantId: fixture.a.tenantId } }));
    expect(row?.status).toBe('COMPLETED');
  });

  it('drafts a follow-up the rep can edit, then sends and logs it', async () => {
    mockOutbox.clear();

    const draft = await post(draftFollowUp, `/api/v1/calls/${callId}/follow-up-email`, {}, fixture.a.cookie, {
      id: callId,
    });
    expect(draft.status).toBe(200);
    expect(draft.body.to).toBe('client@example.test');
    expect(draft.body.source).toBe('template'); // no model key → labelled template
    expect(draft.body.subject.length).toBeGreaterThan(0);

    const sent = await new Promise<{ status: number; body: any }>((resolve) =>
      resolve(
        // The rep edited the draft; the recipient stays server-resolved.
        (async () => {
          const req = new Request(`http://localhost/api/v1/calls/${callId}/follow-up-email`, {
            method: 'PUT',
            headers: { cookie: fixture.a.cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ subject: 'Following up on our call', body: 'Edited body.\nBest regards.' }),
          });
          const res = await sendFollowUp(req, { params: Promise.resolve({ id: callId }) });
          return { status: res.status, body: await res.json() };
        })(),
      ),
    );
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('SENT');

    // The provider (mock) actually received it…
    expect(mockOutbox.lastTo('client@example.test')?.subject).toBe('Following up on our call');

    // …and the CRM recorded both the message and the timeline activity.
    const communication = await prisma.communication.findFirst({
      where: { tenantId: fixture.a.tenantId, toAddress: 'client@example.test', status: 'SENT' },
    });
    expect(communication).not.toBeNull();
    expect((communication!.metadata as { callId?: string }).callId).toBe(callId);

    const activity = await prisma.activity.findFirst({
      where: { tenantId: fixture.a.tenantId, leadId, type: { key: 'email' } },
    });
    expect(activity).not.toBeNull();
  });

  it('surfaces the call on the coaching dashboard with its numbers', async () => {
    // The dashboard lists COMPLETED calls; complete this one.
    await prisma.call.update({
      where: { id: callId, tenantId: fixture.a.tenantId },
      data: { status: 'COMPLETED', outcome: 'INTERESTED', endedAt: new Date() },
    });

    const list = await get(coachingDashboard, '/api/v1/coaching?view=calls', fixture.a.cookie);
    expect(list.status).toBe(200);
    const row = list.body.data.find((r: any) => r.id === callId);
    expect(row).toBeTruthy();
    expect(row.objections).toBe(1);
    expect(row.objectionsAddressed).toBe(1);
    expect(row.followUpSentAt).toBeTruthy();
    expect(row.talkRatio).toBeGreaterThan(0);

    const analytics = await get(coachingDashboard, '/api/v1/coaching?view=analytics', fixture.a.cookie);
    expect(analytics.status).toBe(200);
    expect(analytics.body.talkToListenByRep.length).toBeGreaterThan(0);
    expect(analytics.body.objectionConversion[0].name).toBe('Too expensive');
    expect(analytics.body.followUpTiming.followedUp).toBeGreaterThanOrEqual(0);
  });
});

describe('practice → score', () => {
  it('runs a text roleplay and scores it without a model key', async () => {
    const started = await post(startPractice, '/api/v1/practice', { scenario: 'DISCOVERY' }, fixture.a.cookie);
    expect(started.status).toBe(200);
    const sessionId = started.body.id;
    expect(started.body.remainingToday).toBeGreaterThanOrEqual(0);

    for (const line of [
      'Hi, thanks for making time. What prompted you to look at new projects this quarter?',
      'Understood. Roughly what budget range are you working with?',
      'That helps. I will send two options and book a viewing for Thursday — does that work?',
    ]) {
      const turn = await post(practiceTurn, `/api/v1/practice/${sessionId}`, { text: line }, fixture.a.cookie, {
        id: sessionId,
      });
      expect(turn.status).toBe(200);
      // The simulated prospect labels itself; nothing pretends to be a model.
      expect(turn.body.source).toBe('simulated');
    }

    const finished = await patch(
      finishPractice,
      `/api/v1/practice/${sessionId}`,
      { outcome: 'COMPLETED' },
      fixture.a.cookie,
      { id: sessionId },
    );
    expect(finished.status).toBe(200);

    /**
     * Scoring runs wherever the deployment puts it: inline from the route when
     * no worker is attached, or on the `ai` queue when one is. Give the route's
     * own run a moment to claim and finish; if the row is still sitting there,
     * nothing is draining the queue, so run the worker function here.
     */
    const readScore = () => prisma.practiceScore.findFirst({ where: { sessionId, tenantId: fixture.a.tenantId } });
    if (!(await settles(readScore, { tries: 8 }))?.status.startsWith('COMPLETED')) {
      await scorePracticeSession({ tenantId: fixture.a.tenantId, sessionId }).catch(() => {});
      await settles(readScore);
    }
    const score = await readScore();
    expect(score).not.toBeNull();
    expect(score!.status).toBe('COMPLETED');
    expect(score!.modelId).toBe('demo-simulation');
    expect(score!.overallScore).toBeGreaterThan(0);
    expect((score!.rubricScores as unknown[]).length).toBeGreaterThan(0);
  });

  it('enforces the per-tenant daily cap', async () => {
    await prisma.organizationSetting.upsert({
      where: { tenantId: fixture.a.tenantId },
      create: { tenantId: fixture.a.tenantId, practiceDailyCap: 1 },
      update: { practiceDailyCap: 1 },
    });

    // One session already ran today, so the cap of 1 is spent.
    const refused = await post(startPractice, '/api/v1/practice', { scenario: 'OPENER' }, fixture.a.cookie);
    expect(refused.status).toBe(429);
  });
});
