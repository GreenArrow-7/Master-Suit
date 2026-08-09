import { z } from 'zod';
import { route } from '@/lib/api/handler';
import {
  createPost,
  editPost,
  feed,
  moderatePost,
  react,
  POST_KINDS,
  REACTION_KINDS,
} from '@/services/engagement/feed';

const listQuery = z
  .object({
    includeHidden: z.coerce.boolean().default(false),
    before: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

/** The feed. Pinned first, then newest. */
export const GET = route(
  { module: 'posts', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => ({
    data: await feed(ctx, { includeHidden: query.includeHidden, before: query.before, limit: query.limit }),
  }),
);

const createBody = z
  .object({
    kind: z.enum(POST_KINDS).optional(),
    body: z.string().min(1).max(8000),
    videoKey: z.string().max(500).optional(),
    videoUrl: z.string().url().max(2000).optional(),
    posterKey: z.string().max(500).optional(),
    isPinned: z.boolean().optional(),
  })
  .strict();

export const POST = route(
  { module: 'posts', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => createPost({ ctx, ...body }),
);

const editBody = z
  .object({
    action: z.literal('EDIT'),
    postId: z.string().cuid(),
    body: z.string().min(1).max(8000).optional(),
    kind: z.enum(POST_KINDS).optional(),
    isPinned: z.boolean().optional(),
  })
  .strict();

const moderateBody = z
  .object({
    action: z.literal('MODERATE'),
    postId: z.string().cuid(),
    hide: z.boolean(),
    reason: z.string().max(1000).optional(),
  })
  .strict();

const reactBody = z
  .object({
    action: z.literal('REACT'),
    postId: z.string().cuid(),
    // Null takes the reaction back.
    kind: z.enum(REACTION_KINDS).nullable(),
  })
  .strict();

/**
 * Editing, moderating, or reacting.
 *
 * Reacting sits on the same verb because it is a change to a post somebody else
 * owns, and giving it its own route would mean a second place that has to know
 * a hidden post takes no reactions.
 */
export const PATCH = route(
  {
    module: 'posts',
    productModule: 'SALES',
    // EDIT, not VIEW: this verb changes rows. Reacting needs it too, which is
    // right — the migration grants EDIT to everyone who may post at all, and a
    // read-only seat should not be writing to other people's posts.
    action: 'EDIT',
    body: z.discriminatedUnion('action', [editBody, moderateBody, reactBody]),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, body }) => {
    if (body.action === 'REACT') return react({ ctx, postId: body.postId, kind: body.kind });
    if (body.action === 'MODERATE') {
      return moderatePost({ ctx, postId: body.postId, hide: body.hide, reason: body.reason });
    }
    return editPost({ ctx, postId: body.postId, body: body.body, kind: body.kind, isPinned: body.isPinned });
  },
);
