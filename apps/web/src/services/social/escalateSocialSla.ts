/**
 * Nobody answered in time — tell someone who can do something about it.
 *
 * Runs from a delayed job armed at ingestion (see `applySocialComment`), so it
 * fires once, at the deadline. Everything it does is guarded by state read at
 * that moment rather than assumed from when the job was queued: between arming
 * and firing the enquiry may have been answered, converted, dismissed or
 * reassigned, and only the first two mean the desk did its job.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { socialSlaState } from '@/services/social/sla';

export async function escalateSocialSla(tenantId: string, socialCommentId: string) {
  const enquiry = await prisma.socialComment.findFirst({
    where: { tenantId, id: socialCommentId },
    select: {
      id: true,
      intent: true,
      status: true,
      provider: true,
      authorName: true,
      commentText: true,
      commentCreatedAt: true,
      slaDueAt: true,
      slaEscalatedAt: true,
      repliedAt: true,
      convertedAt: true,
      ownerId: true,
      teamId: true,
    },
  });
  if (!enquiry) return { ignored: 'gone' as const };

  // Already paged somebody about this one. A redelivered webhook arms a second
  // job, and BullMQ retries the same one — neither may wake a manager twice.
  if (enquiry.slaEscalatedAt) return { ignored: 'already-escalated' as const };

  const state = socialSlaState(enquiry);
  if (state !== 'BREACHED') return { ignored: state };

  /**
   * Only HIGH escalates. A medium enquiry going a few minutes over is a normal
   * busy morning; escalating it teaches managers to ignore the alert, and then
   * the one that mattered gets ignored too.
   */
  if (enquiry.intent !== 'HIGH') {
    await stamp(tenantId, enquiry.id);
    return { ignored: 'not-high' as const };
  }

  /**
   * The owner's line manager, or the team's, or nobody. Escalating to the
   * person who already missed it would just be a second notification for them.
   */
  const owner = enquiry.ownerId
    ? await prisma.user.findFirst({
        where: { tenantId, id: enquiry.ownerId },
        select: { fullName: true, managerId: true },
      })
    : null;
  const team = enquiry.teamId
    ? await prisma.team.findFirst({ where: { tenantId, id: enquiry.teamId }, select: { managerId: true } })
    : null;
  const managerId = owner?.managerId ?? team?.managerId ?? null;

  await stamp(tenantId, enquiry.id);

  const channel = enquiry.provider === 'instagram' ? 'Instagram' : 'Facebook';
  const lateBy = Math.max(Math.round((Date.now() - enquiry.slaDueAt!.getTime()) / 60_000), 1);

  if (managerId && managerId !== enquiry.ownerId) {
    await prisma.notification
      .create({
        data: {
          tenantId,
          userId: managerId,
          kind: 'SOCIAL_ENQUIRY',
          title: `${channel} enquiry unanswered`,
          body: `${lateBy} min past target${owner?.fullName ? `, with ${owner.fullName}` : ' and unassigned'}: "${enquiry.commentText.slice(0, 100)}"`,
          objectType: 'SOCIAL_COMMENT',
          recordId: enquiry.id,
        },
      })
      .catch((err) => logger.warn({ err: (err as Error).message, tenantId }, 'sla escalation notification failed'));
  }

  /**
   * Fire the automation event regardless of whether a manager was found. A
   * workspace with no reporting lines configured still wants its own rule — a
   * webhook to a supervisor channel, a task — to be able to react.
   */
  await enqueue('automation', 'trigger', {
    tenantId,
    event: 'sla.warning',
    object: 'SOCIAL_COMMENT',
    recordId: enquiry.id,
  });

  logger.warn(
    { tenantId, socialCommentId: enquiry.id, lateBy, managerId, ownerId: enquiry.ownerId },
    'social enquiry SLA breached',
  );
  return { escalated: true, managerId, lateBy };
}

/** Stamped before notifying: a duplicate page is worse than a missed one here. */
function stamp(tenantId: string, id: string) {
  return prisma.socialComment.update({
    where: { id, tenantId },
    data: { slaEscalatedAt: new Date() },
  });
}
