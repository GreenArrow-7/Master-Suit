/**
 * Deliberate ownership of a social enquiry.
 *
 * Everything about who owns what lives here rather than in the route or the
 * component: authorization, eligibility, the write, the history row and the
 * notification. A second caller — bulk assignment, an automation — must get the
 * same guarantees without reimplementing them.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { Forbidden, NotFound, Conflict } from '@/lib/errors';
import { assertPermission, scopeFor } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { nextDistributionOwner } from '@/services/distribution/assignLead';
import type { Ctx } from '@/lib/security/rbac';

export interface AssignInput {
  socialCommentId: string;
  /** Exactly one of these decides the destination. */
  toUserId?: string | null;
  toTeamId?: string | null;
  /** Optional free text, kept on the history row. */
  reason?: string | null;
}

export async function assignSocialLead(ctx: Ctx, input: AssignInput) {
  /**
   * A rep may claim work; only ASSIGN-holders may hand it to someone else.
   *
   * `assignToSelf` is the common case from the unassigned queue and should not
   * require managing other people, so it is gated on VIEW plus the row being
   * visible. Anything pointing at another user or a team needs ASSIGN.
   */
  const assigningToSelf = input.toUserId === ctx.actor.id && !input.toTeamId;
  if (!assigningToSelf) assertPermission(ctx, 'leads', 'ASSIGN');
  if (scopeFor(ctx, 'leads', 'VIEW') === 'NONE') throw Forbidden();

  // Loaded through the visibility filter, so an id from another workspace misses
  // rather than being refused — and RLS refuses it again underneath.
  const visible = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const enquiry = await prisma.socialComment.findFirst({
    where: { ...visible, id: input.socialCommentId },
    select: { id: true, ownerId: true, teamId: true, intent: true, authorName: true, provider: true, status: true },
  });
  if (!enquiry) throw NotFound('Social enquiry');

  let toUserId: string | null = null;
  let toTeamId: string | null = null;
  let note: string | null = null;

  if (input.toUserId) {
    /**
     * Re-checked against the tenant and against eligibility, never trusted from
     * the request. Assigning to a suspended account produces an enquiry nobody
     * sees, which is worse than leaving it unassigned.
     */
    const target = await prisma.user.findFirst({
      where: { tenantId: ctx.tenantId, id: input.toUserId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!target) throw NotFound('User');
    toUserId = target.id;
  } else if (input.toTeamId) {
    const team = await prisma.team.findFirst({
      where: { tenantId: ctx.tenantId, id: input.toTeamId },
      select: { id: true },
    });
    if (!team) throw NotFound('Team');
    toTeamId = team.id;
    /**
     * A team is a destination, not a person. The existing distribution engine
     * picks who inside it takes the enquiry — reimplementing that choice here
     * would be a second rotation competing with the first.
     */
    const distributed = await nextDistributionOwner(ctx.tenantId);
    toUserId = distributed.userId;
    note = distributed.note;
  } else {
    throw Conflict('Choose a person or a team.');
  }

  const [updated] = await prisma.$transaction([
    prisma.socialComment.update({
      where: { id: enquiry.id, tenantId: ctx.tenantId },
      data: {
        ownerId: toUserId,
        teamId: toTeamId,
        // The sticky value: automated reprocessing must never undo this.
        assignmentSource: 'MANUAL',
        assignedAt: new Date(),
        assignmentNote: note,
        // A claimed enquiry is being worked, unless it is already further along.
        ...(enquiry.status === 'NEW' && toUserId ? { status: 'ASSIGNED' } : {}),
      },
      select: { id: true, ownerId: true, teamId: true, status: true },
    }),
    // Append-only. History is never edited, only added to.
    prisma.socialAssignmentHistory.create({
      data: {
        tenantId: ctx.tenantId,
        socialCommentId: enquiry.id,
        fromOwnerId: enquiry.ownerId,
        toOwnerId: toUserId,
        teamId: toTeamId,
        source: 'MANUAL',
        // The actor comes from the session, never from the request body.
        assignedById: ctx.actor.id,
        reason: input.reason?.slice(0, 300) ?? null,
      },
    }),
  ]);

  /**
   * Tell the new owner, unless they just claimed it themselves — nobody needs a
   * notification about their own click.
   */
  if (toUserId && toUserId !== ctx.actor.id) {
    const channel = enquiry.provider === 'instagram' ? 'Instagram' : 'Facebook';
    await prisma.notification
      .create({
        data: {
          tenantId: ctx.tenantId,
          userId: toUserId,
          kind: 'SOCIAL_ENQUIRY',
          title: 'Social enquiry assigned to you',
          body: `${channel} enquiry from ${enquiry.authorName ?? 'a commenter'}.`,
          objectType: 'SOCIAL_COMMENT',
          recordId: enquiry.id,
        },
      })
      .catch((err) => logger.warn({ err: (err as Error).message }, 'assignment notification failed'));
  }

  logger.info(
    { tenantId: ctx.tenantId, socialCommentId: enquiry.id, from: enquiry.ownerId, to: toUserId, by: ctx.actor.id },
    'social enquiry reassigned',
  );
  return updated;
}
