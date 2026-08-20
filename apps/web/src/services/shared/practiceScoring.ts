/**
 * Scores a finished practice session, off the request thread.
 *
 * Same discipline as callIntelligence.ts: claim the row before the paid work,
 * record failure on the row *and* rethrow so BullMQ's backoff gets its chance
 * and the UI still has something to show.
 */
import { prisma } from '@/lib/db';
import { scorePractice, type PracticeScenario, type PracticeTurn } from '@/lib/ai/practice';

export interface PracticeScoreJob {
  tenantId: string;
  sessionId: string;
}

export async function scorePracticeSession(job: PracticeScoreJob): Promise<{ done: boolean; reason?: string }> {
  const { tenantId, sessionId } = job;

  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, tenantId, status: 'COMPLETED' },
  });
  if (!session) return { done: false, reason: 'session not found or not completed' };

  // Claim: PENDING/FAILED → PROCESSING. A replayed job while one is running,
  // or after a score landed, does nothing — one billed model call per finish.
  const claimed = await prisma.practiceScore.updateMany({
    where: { sessionId, tenantId, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'PROCESSING', errorMessage: null },
  });
  if (claimed.count === 0) return { done: false, reason: 'score already processed or in progress' };

  try {
    const result = await scorePractice({
      tenantId,
      scenario: session.scenario as PracticeScenario,
      brief: session.brief,
      turns: session.turns as unknown as PracticeTurn[],
    });

    await prisma.practiceScore.update({
      where: { sessionId, tenantId },
      data: {
        status: 'COMPLETED',
        overallScore: result.overallScore,
        maxScore: result.maxScore,
        rubricScores: result.rubricScores as unknown as object,
        strengths: result.strengths,
        improvements: result.improvements,
        modelId: result.modelId,
      },
    });
    return { done: true };
  } catch (err) {
    await prisma.practiceScore.updateMany({
      where: { sessionId, tenantId },
      data: { status: 'FAILED', errorMessage: (err as Error).message?.slice(0, 500) },
    });
    throw err;
  }
}
