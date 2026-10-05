import { Worker, type Job } from 'bullmq';
import type { QueueName } from '@/lib/queue';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { enrollMatchingAutomations, runEnrollmentNode } from '@/services/automation/engine';
import { sweepDueCampaigns } from '@/services/campaigns/scheduler';
import { assignLead } from '@/services/distribution/assignLead';
import { analyseCall, runCallAudit, transcribeCall } from '@/services/shared/callIntelligence';
import { ingestRecording } from '@/services/shared/ingestRecording';
import { scorePracticeSession } from '@/services/shared/practiceScoring';
import { checkLeadFirstContact } from '@/services/sla/checkLeadFirstContact';
import { escalateSocialSla } from '@/services/social/escalateSocialSla';
import { AI_CONCURRENCY, fairShare } from './ai';
import { MAINTENANCE_JOBS } from './maintenance';
import { emailHrEvent, pushRecord } from './notifications';
import { applyWebhookEvent } from './webhook';

// A job's payload is whatever its producer enqueued; each handler states the shape it reads.
type Jobs = Record<string, (data: any) => unknown>;

/**
 * Every queue lib/queue.ts can enqueue to, and the jobs it runs, by name.
 *
 * `Record<QueueName, ...>` is exhaustive both ways: a queue nobody drains and a
 * consumer for a queue that no longer exists are each a compile error. This
 * replaced a start-up log that named three queues with retry policies and no
 * consumer — a log line is not a build failure.
 */
export const JOBS: Record<QueueName, Jobs> = {
  automation: {
    trigger: (d) => enrollMatchingAutomations(d.tenantId, d.event, d.object, d.recordId),
    'run-node': (d) => runEnrollmentNode(d.tenantId, d.enrollmentId),
  },
  distribution: { 'assign-lead': (d) => assignLead(d.tenantId, d.leadId) },
  sla: {
    'lead-first-contact': (d) => checkLeadFirstContact(d.tenantId, d.leadId),
    'social-enquiry-response': (d) => escalateSocialSla(d.tenantId, d.socialCommentId),
  },
  media: { 'recording.ingest': ingestRecording },
  // The once-a-minute lifecycle sweep: starts due SCHEDULED campaigns, completes RUNNING ones past their end.
  campaign: { sweep: () => sweepDueCampaigns() },
  ai: { transcribe: transcribeCall, analyse: analyseCall, audit: runCallAudit, 'practice-score': scorePracticeSession },
  notifications: {
    'record-push': pushRecord,
    // The name the push had when only HR raised it, kept for jobs mid-flight across a deploy.
    'hr-event-push': pushRecord,
    'hr-event': emailHrEvent,
  },
  webhook: { 'meta.event': applyWebhookEvent },
  maintenance: MAINTENANCE_JOBS,
};

/**
 * Runs a job by queue and name: what each worker hands BullMQ, exported so a test
 * drives the registered dispatch rather than a copy that stays green while it breaks.
 */
export async function handleJob(queue: QueueName, job: { name: string; data?: unknown }): Promise<unknown> {
  const run = JOBS[queue][job.name];
  if (!run) {
    logger.warn({ queue, jobName: job.name }, 'unknown job');
    return undefined;
  }
  return run(job.data);
}

/** One job at a time, except ai: two maintenance sweeps at once would contend on the same rows. */
export function startWorker(queue: QueueName) {
  const run = (job: Job) => handleJob(queue, job);
  return queue === 'ai'
    ? new Worker(queue, fairShare(run), { connection: redis, concurrency: AI_CONCURRENCY })
    : new Worker(queue, run, { connection: redis, concurrency: 1 });
}
