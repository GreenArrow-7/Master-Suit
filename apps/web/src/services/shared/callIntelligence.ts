/**
 * Transcript → analysis → audit, off the request thread.
 *
 * These three steps used to run inside the HTTP handler that asked for them. A
 * model call is seconds, sometimes tens of seconds: it held a connection open,
 * a client that gave up left the row stuck in PROCESSING with nothing to resume
 * it, and a Gemini outage surfaced as a 500 on a button the employee pressed
 * rather than as a retry.
 *
 * Each step is idempotent, claims its row before doing any paid work, and
 * enqueues the next one. Failures are recorded on the row *and* rethrown, so
 * BullMQ's backoff gets its chance and the UI still has something to show.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { getObject } from '@/lib/storage';
import { analyzeTranscript } from '@/lib/ai/analysis';
import { auditCall } from '@/lib/ai/audit';
import { connectionCredentials } from '@/lib/integrations/connection';
import { getTranscriptionProvider } from '@/lib/integrations/transcription';

export interface CallJob {
  tenantId: string;
  callId: string;
}

export interface TranscribeJob extends CallJob {
  language?: string;
}

export interface AuditJob extends CallJob {
  scorecardId: string;
}

type Outcome = { done: boolean; reason?: string };

const skipped = (reason: string): Outcome => {
  logger.info({ reason }, 'call intelligence step skipped');
  return { done: false, reason };
};

/**
 * Consent is re-read at the start of every step, not inherited from the one
 * before. A client can withdraw between the transcript finishing and the
 * analysis starting, and the transcript is as much a record of the conversation
 * as the audio is.
 */
async function consented(tenantId: string, callId: string): Promise<boolean> {
  const consent = await prisma.recordingConsent.findFirst({ where: { callId, tenantId } });
  return Boolean(consent?.consentGiven && !consent.withdrawnAt);
}

// ── 1. Transcript ────────────────────────────────────────────────────────────

export async function transcribeCall(job: TranscribeJob): Promise<Outcome> {
  const { tenantId, callId } = job;
  if (!(await consented(tenantId, callId))) return skipped('consent absent or withdrawn');

  const [existing, recording] = await Promise.all([
    prisma.transcript.findFirst({ where: { callId, tenantId } }),
    prisma.recording.findFirst({ where: { callId, tenantId } }),
  ]);
  if (existing) {
    // Already transcribed — carry the chain forward rather than stopping, so a
    // replayed job still reaches analysis.
    await enqueue('ai', 'analyse', { tenantId, callId });
    return skipped('transcript already exists');
  }
  if (!recording) return skipped('no recording');
  if (recording.storageBucket === 'provider') {
    // The ingest worker has not finished pulling the media into our bucket.
    // Thrown, not skipped: the queue's backoff is exactly the right wait.
    throw new Error('recording has not been ingested yet');
  }

  const credentials = await connectionCredentials(tenantId, 'transcription');
  if (!credentials?.provider) return skipped('no speech-to-text provider connected');

  const result = await getTranscriptionProvider(credentials.provider, credentials).transcribe({
    audio: await getObject(recording.storageKey),
    mimeType: recording.mimeType,
    language: job.language ?? 'en',
  });
  if (!result.text) return skipped('no speech recognised');

  await prisma.transcript.upsert({
    where: { callId, tenantId },
    create: {
      tenantId,
      callId,
      content: result.text,
      language: job.language ?? 'en',
      provider: result.provider,
      confidence: result.confidence,
      wordCount: result.text.split(/\s+/).filter(Boolean).length,
    },
    update: { content: result.text, provider: result.provider, confidence: result.confidence },
  });

  await enqueue('ai', 'analyse', { tenantId, callId });
  return { done: true };
}

// ── 2. Analysis ──────────────────────────────────────────────────────────────

/**
 * Claims the analysis row atomically, then calls the model.
 *
 * `createMany(skipDuplicates)` is decided by the unique constraint on callId;
 * the `updateMany` beneath it is a compare-and-swap for a re-run. Two clicks, or
 * a job replayed while the first is still running, therefore produce one model
 * call rather than two — which matters because the second one is also billed.
 */
export async function claimAnalysis(tenantId: string, callId: string): Promise<boolean> {
  const created = await prisma.aIAnalysis.createMany({
    data: [{ tenantId, callId, status: 'PROCESSING' }],
    skipDuplicates: true,
  });
  if (created.count > 0) return true;

  const claimed = await prisma.aIAnalysis.updateMany({
    where: { callId, tenantId, status: { not: 'PROCESSING' } },
    data: { status: 'PROCESSING', errorMessage: null },
  });
  return claimed.count > 0;
}

/**
 * Which fields a re-run must leave alone.
 *
 * A row corrected *before* `correctedFields` existed carries the flag and an
 * empty list — "somebody corrected this, we do not know what". That is read as
 * "protect everything", because guessing wrong here means destroying work
 * somebody did, and the cost of being conservative is a stale field on a handful
 * of old rows.
 */
export function protectedFields(
  existing: { humanCorrected: boolean; correctedFields: string[] } | null,
  candidates: string[],
): string[] {
  if (!existing?.humanCorrected) return [];
  if (existing.correctedFields.length === 0) return candidates;
  return candidates.filter((field) => existing.correctedFields.includes(field));
}

export async function analyseCall(job: CallJob): Promise<Outcome> {
  const { tenantId, callId } = job;
  if (!(await consented(tenantId, callId))) return skipped('consent absent or withdrawn');

  const [call, transcript] = await Promise.all([
    prisma.call.findFirst({ where: { id: callId, tenantId, deletedAt: null } }),
    prisma.transcript.findFirst({ where: { callId, tenantId } }),
  ]);
  if (!call) return skipped('call not found');
  if (!transcript) return skipped('no transcript');

  if (!(await claimAnalysis(tenantId, callId))) return skipped('analysis already in progress');

  try {
    const context = await campaignContext(tenantId, call.campaignId);
    const { result, modelId, processingMs } = await analyzeTranscript({
      tenantId,
      transcript: transcript.content,
      talkingPoints: context.talkingPoints,
      qualifications: context.qualifications,
      callDirection: call.direction,
      campaignName: context.campaignName,
    });

    /**
     * The model's answer, minus anything a person has already corrected.
     *
     * This used to write every column unconditionally, so re-analysing a call
     * somebody had edited replaced their words with the model's — silently, with
     * no way back. `humanCorrected` was recorded and read by nothing but a badge
     * in the UI.
     *
     * `rawOutput` is written whatever happens, so the model's complete answer is
     * still on the row and a later interface can show "the model now says X"
     * beside the correction. Nothing is lost; the model simply does not win an
     * argument a person has already settled.
     */
    const existing = await prisma.aIAnalysis.findFirst({
      where: { callId, tenantId },
      select: { humanCorrected: true, correctedFields: true },
    });
    const modelFields = {
      summary: result.summary,
      clientNeeds: result.clientNeeds,
      objections: result.objections,
      commitments: result.commitments,
      buyingSignals: result.buyingSignals,
      risks: result.risks,
      nextSteps: result.nextSteps,
      topicsDiscussed: result.topicsDiscussed,
      topicsMissed: result.topicsMissed,
      sentiment: result.sentiment,
      sentimentScore: result.sentimentScore,
      suggestedStatus: result.suggestedStatus,
      complianceFlags: result.complianceFlags,
      uncertainItems: result.uncertainItems,
    };
    const preserved = protectedFields(existing, Object.keys(modelFields));
    for (const field of preserved) delete (modelFields as Record<string, unknown>)[field];

    if (preserved.length) {
      logger.info({ tenantId, callId, preserved }, 'analysis: kept human corrections over the model');
    }

    await prisma.aIAnalysis.update({
      where: { callId, tenantId },
      data: {
        status: 'COMPLETED',
        modelId,
        processingMs,
        ...modelFields,
        rawOutput: result as unknown as object,
      },
    });

    await notify(tenantId, call.callerId, {
      kind: 'CALL_ANALYSIS_READY',
      title: 'Call analysis is ready',
      body: result.summary.slice(0, 240),
      recordId: callId,
    });

    // Audit only where the workspace has said what "good" means. Auditing
    // against a scorecard nobody wrote would produce a score with no meaning
    // and, worse, one attached to a named employee.
    const scorecard = await prisma.auditScorecard.findFirst({
      where: { tenantId, isActive: true, OR: [{ campaignId: call.campaignId }, { campaignId: null }] },
      orderBy: { campaignId: 'desc' },
      select: { id: true },
    });
    if (scorecard) await enqueue('ai', 'audit', { tenantId, callId, scorecardId: scorecard.id });

    return { done: true };
  } catch (err) {
    await prisma.aIAnalysis.updateMany({
      where: { callId, tenantId },
      data: { status: 'FAILED', errorMessage: (err as Error).message?.slice(0, 500) },
    });
    throw err;
  }
}

// ── 3. Audit ─────────────────────────────────────────────────────────────────

export async function runCallAudit(job: AuditJob): Promise<Outcome> {
  const { tenantId, callId, scorecardId } = job;
  if (!(await consented(tenantId, callId))) return skipped('consent absent or withdrawn');

  const [transcript, analysis, scorecard] = await Promise.all([
    prisma.transcript.findFirst({ where: { callId, tenantId } }),
    prisma.aIAnalysis.findFirst({ where: { callId, tenantId, status: 'COMPLETED' } }),
    prisma.auditScorecard.findFirst({
      where: { id: scorecardId, tenantId, isActive: true },
      include: { criteria: { orderBy: { position: 'asc' } } },
    }),
  ]);
  if (!transcript) return skipped('no transcript');
  if (!analysis) return skipped('no completed analysis');
  if (!scorecard) return skipped('no active scorecard');

  // One audit per call per scorecard. A replayed job re-scores the existing row
  // rather than stacking a second score against the same employee.
  const existing = await prisma.callAudit.findFirst({ where: { callId, tenantId, scorecardId } });
  if (existing?.status === 'PROCESSING') return skipped('audit already in progress');

  const row = existing
    ? await prisma.callAudit.update({
        where: { id: existing.id, tenantId },
        data: { status: 'PROCESSING', errorMessage: null },
      })
    : await prisma.callAudit.create({ data: { tenantId, callId, scorecardId, status: 'PROCESSING' } });

  try {
    const result = await auditCall({
      tenantId,
      transcript: transcript.content,
      analysisJson: {
        summary: analysis.summary,
        clientNeeds: analysis.clientNeeds,
        objections: analysis.objections,
        commitments: analysis.commitments,
        topicsDiscussed: analysis.topicsDiscussed,
        topicsMissed: analysis.topicsMissed,
        sentiment: analysis.sentiment,
      },
      criteria: scorecard.criteria.map((c) => ({
        label: c.label,
        description: c.description ?? undefined,
        weight: c.weight,
        isRequired: c.isRequired,
      })),
    });

    await prisma.callAudit.update({
      where: { id: row.id, tenantId },
      data: {
        status: 'COMPLETED',
        overallScore: result.overallScore,
        maxScore: result.maxScore,
        criteriaScores: result.criteriaScores as unknown as object,
        missedPoints: result.missedPoints,
        strengths: result.strengths,
        risks: result.risks,
        suggestions: result.suggestions,
        nextAction: result.nextAction,
      },
    });

    return { done: true };
  } catch (err) {
    await prisma.callAudit.update({
      where: { id: row.id, tenantId },
      data: { status: 'FAILED', errorMessage: (err as Error).message?.slice(0, 500) },
    });
    throw err;
  }
}

// ── Shared ───────────────────────────────────────────────────────────────────

async function campaignContext(tenantId: string, campaignId: string | null) {
  if (!campaignId) return { talkingPoints: [], qualifications: [], campaignName: undefined };

  const [talkingPoints, qualifications, campaign] = await Promise.all([
    prisma.campaignTalkingPoint.findMany({
      where: { tenantId, campaignId },
      select: { label: true, isRequired: true },
    }),
    prisma.campaignQualification.findMany({
      where: { tenantId, campaignId },
      select: { question: true, expectedAnswer: true },
    }),
    prisma.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { name: true } }),
  ]);

  return {
    talkingPoints,
    qualifications: qualifications.map((q) => ({
      question: q.question,
      expectedAnswer: q.expectedAnswer ?? undefined,
    })),
    campaignName: campaign?.name,
  };
}

/**
 * The whole analyse → audit chain, run inline. For callers that prefer the `ai`
 * queue but discovered nothing is draining it (dev/demo without a worker), and
 * for the live demo session that finalises a call synchronously. Both steps
 * claim their rows, so racing a worker cannot double-run either.
 */
export async function analyseAndAudit(tenantId: string, callId: string): Promise<void> {
  await analyseCall({ tenantId, callId });
  const call = await prisma.call.findFirst({ where: { id: callId, tenantId }, select: { campaignId: true } });
  const scorecard = await prisma.auditScorecard.findFirst({
    where: { tenantId, isActive: true, OR: [{ campaignId: call?.campaignId ?? null }, { campaignId: null }] },
    orderBy: { campaignId: 'desc' },
    select: { id: true },
  });
  if (scorecard) await runCallAudit({ tenantId, callId, scorecardId: scorecard.id });
}

/** Best effort: a notification that cannot be written must not fail the analysis. */
async function notify(
  tenantId: string,
  userId: string,
  n: { kind: string; title: string; body?: string; recordId?: string },
) {
  await prisma.notification
    .create({
      data: { tenantId, userId, kind: n.kind, title: n.title, body: n.body, objectType: 'calls', recordId: n.recordId },
    })
    .catch((err) => logger.warn({ err, userId }, 'notification write failed'));
}
