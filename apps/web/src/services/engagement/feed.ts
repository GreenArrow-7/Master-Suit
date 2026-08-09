/**
 * The internal feed.
 *
 * A noticeboard the whole workspace can write to. Two rules carry it: a post is
 * edited only by whoever wrote it, and taking one down is moderation — recorded
 * with a name and a reason rather than a row quietly vanishing.
 */
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';

export const POST_KINDS = ['UPDATE', 'ANNOUNCEMENT', 'CELEBRATION', 'QUESTION'] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const REACTION_KINDS = ['LIKE', 'CELEBRATE', 'SUPPORT', 'INSIGHTFUL'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export interface CreatePostInput {
  ctx: Ctx;
  kind?: PostKind;
  body: string;
  videoKey?: string;
  videoUrl?: string;
  posterKey?: string;
  isPinned?: boolean;
}

/**
 * Media is ours or somebody else's, never both.
 *
 * Deliberately not `assertMediaSource` from the inventory module: that rule says
 * video is *always* linked, which is right for a developer's marketing reel and
 * wrong for a clip somebody filmed at the office. Sharing the function would
 * have meant loosening it for listings too.
 */
function assertOneSource(input: { videoKey?: string; videoUrl?: string }) {
  if (input.videoKey && input.videoUrl) {
    throw Invalid([
      { field: 'videoUrl', code: 'conflict', message: 'A clip is either uploaded here or linked, not both.' },
    ]);
  }
}

export async function createPost(input: CreatePostInput) {
  const { ctx } = input;
  if (input.body.trim().length === 0) {
    throw Invalid([{ field: 'body', code: 'required', message: 'Say something.' }]);
  }
  assertOneSource(input);

  // Pinning holds a post above everyone else's. That is a leadership act, not a
  // formatting choice.
  if (input.isPinned && !can(ctx, 'posts', 'DELETE')) {
    throw Forbidden('Pinning a post to the top of the feed is a moderator’s call.');
  }

  return withTx(ctx.tenantId, async (tx) => {
    const post = await tx.post.create({
      data: {
        tenantId: ctx.tenantId,
        authorId: ctx.actor.id,
        kind: input.kind ?? 'UPDATE',
        body: input.body.trim(),
        videoKey: input.videoKey,
        videoUrl: input.videoUrl,
        posterKey: input.posterKey,
        isPinned: input.isPinned ?? false,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'posts',
        recordId: post.id,
        previousValue: {},
        newValue: { kind: post.kind, isPinned: post.isPinned },
      },
      tx,
    );

    return post;
  });
}

export interface EditPostInput {
  ctx: Ctx;
  postId: string;
  body?: string;
  kind?: PostKind;
  isPinned?: boolean;
}

/** Only the author rewrites their own words. Moderators hide, they do not edit. */
export async function editPost(input: EditPostInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const post = await tx.post.findFirst({
      where: { id: input.postId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!post) throw NotFound('Post');

    const isModerator = can(ctx, 'posts', 'DELETE');
    if (post.authorId !== ctx.actor.id && !(isModerator && input.body === undefined)) {
      throw Forbidden('Only the author can change what a post says.');
    }
    if (input.isPinned !== undefined && !isModerator) {
      throw Forbidden('Pinning a post to the top of the feed is a moderator’s call.');
    }
    if (post.hiddenAt) throw Conflict('This post has been hidden. Restore it first.');
    if (input.body !== undefined && input.body.trim().length === 0) {
      throw Invalid([{ field: 'body', code: 'required', message: 'Say something.' }]);
    }

    const updated = await tx.post.update({
      where: { id: post.id, tenantId: ctx.tenantId },
      data: {
        body: input.body?.trim(),
        kind: input.kind,
        isPinned: input.isPinned,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'posts',
        recordId: post.id,
        previousValue: { body: post.body, isPinned: post.isPinned },
        newValue: { body: updated.body, isPinned: updated.isPinned },
      },
      tx,
    );

    return updated;
  });
}

export interface ModeratePostInput {
  ctx: Ctx;
  postId: string;
  hide: boolean;
  reason?: string;
}

/**
 * Taking a post down, or putting it back.
 *
 * Never a delete. A row that vanishes is indistinguishable from a bug, the
 * author is owed a reason, and somebody has to be answerable for the decision —
 * which is why the database refuses a hidden post with no reason on it.
 */
export async function moderatePost(input: ModeratePostInput) {
  const { ctx } = input;
  if (!can(ctx, 'posts', 'DELETE')) throw Forbidden('Taking somebody’s post down is a moderator’s call.');
  if (input.hide && !input.reason?.trim()) {
    throw Invalid([{ field: 'reason', code: 'required', message: 'Say why it was taken down.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    const post = await tx.post.findFirst({
      where: { id: input.postId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!post) throw NotFound('Post');

    const updated = await tx.post.update({
      where: { id: post.id, tenantId: ctx.tenantId },
      data: input.hide
        ? { hiddenAt: new Date(), hiddenById: ctx.actor.id, hiddenReason: input.reason!.trim() }
        : { hiddenAt: null, hiddenById: null, hiddenReason: null },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'posts',
        recordId: post.id,
        previousValue: { hiddenAt: post.hiddenAt, hiddenReason: post.hiddenReason },
        newValue: { hiddenAt: updated.hiddenAt, hiddenReason: updated.hiddenReason },
      },
      tx,
    );

    return updated;
  });
}

export interface ReactInput {
  ctx: Ctx;
  postId: string;
  kind: ReactionKind | null;
}

/**
 * One reaction per person per post.
 *
 * Changing your mind updates the row; `null` takes it back. The unique index is
 * what actually enforces it, so two taps racing each other cannot leave two
 * rows behind.
 */
export async function react(input: ReactInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const post = await tx.post.findFirst({
      where: { id: input.postId, tenantId: ctx.tenantId, deletedAt: null, hiddenAt: null },
      select: { id: true },
    });
    if (!post) throw NotFound('Post');

    if (input.kind === null) {
      await tx.postReaction.deleteMany({ where: { tenantId: ctx.tenantId, postId: post.id, userId: ctx.actor.id } });
      return { kind: null };
    }

    const existing = await tx.postReaction.findFirst({
      where: { tenantId: ctx.tenantId, postId: post.id, userId: ctx.actor.id },
      select: { id: true },
    });

    if (existing) {
      await tx.postReaction.update({ where: { id: existing.id, tenantId: ctx.tenantId }, data: { kind: input.kind } });
    } else {
      await tx.postReaction.create({
        data: { tenantId: ctx.tenantId, postId: post.id, userId: ctx.actor.id, kind: input.kind },
      });
    }

    return { kind: input.kind };
  });
}

export interface FeedOptions {
  includeHidden?: boolean;
  limit?: number;
  before?: Date;
}

/**
 * The feed itself.
 *
 * Pinned first, then newest. Hidden posts are excluded unless a moderator asks
 * for them — the author still sees their own, because a post that disappears
 * with no explanation is how somebody concludes the software ate it.
 */
export async function feed(ctx: Ctx, opts: FeedOptions = {}) {
  const isModerator = can(ctx, 'posts', 'DELETE');

  const posts = await prisma.post.findMany({
    where: {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      ...(isModerator && opts.includeHidden ? {} : { OR: [{ hiddenAt: null }, { authorId: ctx.actor.id }] }),
    },
    select: {
      id: true,
      authorId: true,
      kind: true,
      body: true,
      videoKey: true,
      videoUrl: true,
      posterKey: true,
      isPinned: true,
      hiddenAt: true,
      hiddenReason: true,
      createdAt: true,
      reactions: { select: { userId: true, kind: true } },
    },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: opts.limit ?? 50,
  });

  const authors = await prisma.user.findMany({
    where: { tenantId: ctx.tenantId, id: { in: [...new Set(posts.map((p) => p.authorId))] } },
    select: { id: true, fullName: true, avatarUrl: true },
  });
  const authorBy = new Map(authors.map((u) => [u.id, u]));

  return posts.map(({ reactions, ...post }) => {
    const counts: Record<string, number> = {};
    for (const r of reactions) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return {
      ...post,
      author: authorBy.get(post.authorId) ?? null,
      reactionCounts: counts,
      reactionTotal: reactions.length,
      /** What the reader themselves pressed, so the UI needs no second call. */
      myReaction: reactions.find((r) => r.userId === ctx.actor.id)?.kind ?? null,
    };
  });
}
