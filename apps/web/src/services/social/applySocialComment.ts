/**
 * A normalised Meta comment becomes an actionable social enquiry.
 *
 * Runs on the `webhook` queue, never in the HTTP acknowledgement path (§7):
 * Meta must not wait on qualification, assignment or notification fan-out, and
 * a viral post is exactly when that matters.
 *
 * Layer 1 only. Nothing here writes a `Lead` — a CRM record is created when a
 * human converts the enquiry or an explicitly configured policy says so. That
 * separation is the whole design and this function is where it would be easiest
 * to accidentally break.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { qualifyComment } from '@/services/social/qualify';
import { socialSlaTarget } from '@/services/social/sla';
import { nextDistributionOwner } from '@/services/distribution/assignLead';
import type { NormalizedMetaEvent } from '@/lib/integrations/meta/events';

/** Intent levels that put an enquiry in front of a salesperson. */
const ACTIONABLE = new Set(['HIGH', 'MEDIUM']);

export interface ApplySocialCommentJob {
  tenantId: string;
  connectionId?: string;
  event: NormalizedMetaEvent;
}

export async function applySocialComment({ tenantId, connectionId, event }: ApplySocialCommentJob) {
  const comment = event.comment;
  if (!comment) return;

  /**
   * Idempotency, and the reason the whole job is safe to retry.
   *
   * `(tenantId, provider, providerCommentId)` is unique, so a redelivered
   * webhook or a retried job finds the existing row. An existing row is left
   * alone rather than re-qualified and re-assigned: doing that would move an
   * enquiry a salesperson has already picked up, and would re-notify them.
   */
  const existing = await prisma.socialComment.findUnique({
    where: {
      tenantId_provider_providerCommentId: {
        tenantId,
        provider: comment.provider,
        providerCommentId: comment.providerCommentId,
      },
    },
    select: { id: true, status: true, assignmentSource: true },
  });

  if (existing) {
    /**
     * Facebook reports edits and deletions through `verb`; Instagram does not,
     * so this only ever fires for Facebook. An edited comment updates its text
     * and is re-qualified — the customer may have added "what's the price" —
     * but a removed one keeps its record and is simply dismissed, because the
     * enquiry having existed is history worth keeping.
     */
    if (comment.verb === 'edit' || comment.verb === 'edited') {
      const requalified = qualifyComment(comment.commentText);
      await prisma.socialComment.update({
        where: { id: existing.id, tenantId },
        data: {
          commentText: comment.commentText,
          intent: requalified.intent,
          intentScore: requalified.score,
          intentReasons: requalified.reasons,
        },
      });
      return { socialCommentId: existing.id, updated: true };
    }
    /**
     * A human's decision outranks reprocessing, explicitly.
     *
     * Today the duplicate branch below already returns before assignment runs,
     * so this is belt and braces — but that is an accident of control flow, and
     * a future reprocessing path (a backfill, a re-qualification job) could
     * easily reach the assignment code. The business rule belongs in the
     * business logic, not in the shape of an if-statement.
     */
    if (existing.assignmentSource === 'MANUAL') {
      logger.info(
        { tenantId, socialCommentId: existing.id },
        'social enquiry was assigned manually — leaving ownership alone',
      );
      return { socialCommentId: existing.id, duplicate: true, manualOwnershipPreserved: true };
    }

    if (comment.verb === 'remove' || comment.verb === 'delete') {
      await prisma.socialComment.update({
        where: { id: existing.id, tenantId },
        data: { status: 'DISMISSED' },
      });
      return { socialCommentId: existing.id, removed: true };
    }
    return { socialCommentId: existing.id, duplicate: true };
  }

  // A delete for a comment we never captured is not an error worth retrying.
  if (comment.verb === 'remove' || comment.verb === 'delete') return { ignored: 'unknown-comment-removed' as const };

  const qualification = qualifyComment(comment.commentText);

  /**
   * Have we met this person? Only by a stable provider id — a username is a
   * label the customer can change, and matching on it would attach one
   * customer's enquiry to another. `findDuplicates` is reused rather than
   * reimplemented, and it is asked nothing it cannot answer: Meta supplies no
   * phone or email on a comment, so this matches on prior social identity only.
   */
  let linkedLeadId: string | null = null;
  if (comment.providerAuthorId) {
    const prior = await prisma.socialComment.findFirst({
      where: {
        tenantId,
        provider: comment.provider,
        providerAuthorId: comment.providerAuthorId,
        linkedLeadId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { linkedLeadId: true },
    });
    linkedLeadId = prior?.linkedLeadId ?? null;
  }

  /**
   * Assignment. Only enquiries worth a salesperson's attention are routed —
   * praise and spam stay unassigned rather than filling a queue, which is the
   * difference between a useful inbox and a firehose. Ownership comes from the
   * linked lead when there is one, so a returning customer reaches the person
   * who already knows them.
   */
  let ownerId: string | null = null;
  let source: 'INHERITED_CUSTOMER_OWNER' | 'GLOBAL_DISTRIBUTION' | null = null;
  /**
   * Why nobody owns it, when nobody does.
   *
   * A null owner with no explanation is the thing that makes an unassigned queue
   * useless — a manager cannot tell "no rule configured" from "the team is
   * empty" from "distribution errored", and those need different responses.
   */
  let note: string | null = null;

  if (!ACTIONABLE.has(qualification.intent)) {
    note = 'Not a sales enquiry, so it was not distributed.';
  } else {
    if (linkedLeadId) {
      const lead = await prisma.lead.findFirst({
        where: { tenantId, id: linkedLeadId },
        select: { ownerId: true },
      });
      ownerId = lead?.ownerId ?? null;
      if (ownerId) source = 'INHERITED_CUSTOMER_OWNER';
    }
    /**
     * Nobody owns them yet, so fall through to the workspace's distribution
     * rules — the same rotation leads use. Without this an unmatched high-intent
     * enquiry sat unassigned, which is the difference between "captured" and
     * "somebody is working it".
     *
     * Best-effort: a workspace with no configured rule simply leaves it in the
     * unassigned queue, which is a legitimate way to run the desk, not a failure.
     */
    if (!ownerId) {
      const distributed = await nextDistributionOwner(tenantId).catch((err) => {
        logger.warn({ err: (err as Error).message, tenantId }, 'social comment distribution failed');
        return { userId: null, note: 'Distribution failed; left for manual assignment.' };
      });
      ownerId = distributed.userId;
      if (ownerId) source = 'GLOBAL_DISTRIBUTION';
      else note = distributed.note;
    }
  }

  /**
   * The response clock, started from the customer's comment rather than from
   * now. Ingestion can lag — a webhook retry, a worker restart, a backfill — and
   * measuring from our own processing time would quietly forgive exactly the
   * delays the target exists to catch.
   */
  const target = await socialSlaTarget(tenantId, qualification.intent);
  const slaDueAt = target ? new Date(comment.commentCreatedAt.getTime() + target.minutes * 60_000) : null;

  const created = await prisma.socialComment.create({
    data: {
      tenantId,
      integrationConnectionId: connectionId ?? null,
      provider: comment.provider,
      providerCommentId: comment.providerCommentId,
      providerAuthorId: comment.providerAuthorId ?? null,
      // A handle or a display name. Never an email, phone or legal name — Meta
      // does not supply them on a comment and nothing here may invent them.
      authorName: comment.authorName ?? null,
      commentText: comment.commentText,
      commentCreatedAt: comment.commentCreatedAt,
      providerMediaId: comment.providerMediaId ?? null,
      mediaType: comment.mediaType ?? null,
      parentCommentId: comment.parentCommentId ?? null,
      providerAdId: comment.providerAdId ?? null,
      providerAdTitle: comment.providerAdTitle ?? null,
      intent: qualification.intent,
      intentScore: qualification.score,
      intentReasons: qualification.reasons,
      status: qualification.intent === 'SPAM' ? 'SPAM' : ownerId ? 'ASSIGNED' : 'NEW',
      ownerId,
      assignmentSource: source,
      assignedAt: ownerId ? new Date() : null,
      assignmentNote: note,
      slaDueAt,
      linkedLeadId,
    },
    select: { id: true, intent: true, status: true },
  });

  /**
   * One delayed job at the deadline, following the pattern `createLead` already
   * uses for lead first-contact. A comment that arrived late enough to be
   * overdue on arrival gets a job with no delay rather than being skipped —
   * an enquiry that sat in a retry queue for an hour is exactly the one a
   * manager needs told about.
   */
  if (slaDueAt) {
    await enqueue(
      'sla',
      'social-enquiry-response',
      { tenantId, socialCommentId: created.id },
      { delayMs: Math.max(slaDueAt.getTime() - Date.now(), 0) },
    );
  }

  /**
   * The assignment trail. Written even when nobody was assigned, because
   * "we tried and there was no eligible user" is the fact a manager needs, and
   * time-to-assignment analytics needs a row to measure from.
   */
  if (source || note) {
    await prisma.socialAssignmentHistory
      .create({
        data: {
          tenantId,
          socialCommentId: created.id,
          toOwnerId: ownerId,
          source: source ?? 'SYSTEM',
          method: source === 'GLOBAL_DISTRIBUTION' ? 'ROUND_ROBIN' : null,
          reason: note ?? (source === 'INHERITED_CUSTOMER_OWNER' ? 'Existing customer owner' : 'Distribution rule'),
        },
      })
      .catch((err) => logger.warn({ err: (err as Error).message, tenantId }, 'social assignment history failed'));
  }

  /**
   * Notification, best-effort by design (§21).
   *
   * The enquiry is already committed. If the notification write fails the
   * salesperson still finds it in the Social Leads queue, and throwing here
   * would retry the whole job — which the idempotency check would then treat as
   * a duplicate, silently losing the retry's purpose.
   */
  if (ownerId && ACTIONABLE.has(qualification.intent)) {
    const who = comment.authorName ?? 'Someone';
    const channel = comment.provider === 'instagram' ? 'Instagram' : 'Facebook';
    await prisma.notification
      .create({
        data: {
          tenantId,
          userId: ownerId,
          title: `New ${channel} enquiry`,
          body: `${who}: "${comment.commentText.slice(0, 120)}"`,
          kind: 'SOCIAL_ENQUIRY',
          objectType: 'SOCIAL_COMMENT',
          recordId: created.id,
          // Deep link straight to the enquiry (§17), not to a list.
        },
      })
      .catch((err) => logger.warn({ err: (err as Error).message, tenantId }, 'social comment notification failed'));
  }

  logger.info(
    { tenantId, provider: comment.provider, intent: created.intent, assigned: Boolean(ownerId) },
    'social comment captured',
  );
  return { socialCommentId: created.id, intent: created.intent, created: true };
}
