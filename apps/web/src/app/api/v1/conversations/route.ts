import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';

/**
 * The conversation list behind the inbox (§26).
 *
 * Scoped by `visibilityWhere`, the same helper every list page and every AI tool
 * uses, so a rep sees their own threads and a manager sees their team's without
 * this route inventing a second interpretation of the same permission (§37).
 *
 * `includeUnassigned` is on: an unassigned thread is precisely what somebody
 * with ASSIGN needs to see in order to claim it, and hiding it would make the
 * "Unassigned" filter permanently empty for the people meant to work it.
 */
const listQuery = z.object({
  filter: z.enum(['all', 'unread', 'mine', 'unassigned', 'archived']).default('all'),
  channel: z.enum(['WHATSAPP', 'SMS', 'EMAIL', 'CHAT']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  /** Cursor pagination (§54): never an offset, which drifts as messages arrive. */
  cursor: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export const GET = route({ module: 'communications', action: 'VIEW', query: listQuery }, async ({ ctx, query }) => {
  const visible = await visibilityWhere(ctx, 'communications', 'VIEW', { includeUnassigned: true });

  const where: Record<string, unknown> = {
    ...visible,
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.filter === 'unread' ? { unreadCount: { gt: 0 } } : {}),
    ...(query.filter === 'mine' ? { ownerId: ctx.actor.id } : {}),
    ...(query.filter === 'unassigned' ? { ownerId: null } : {}),
    // Archived is opt-in. Every other filter hides it, or the list fills with
    // threads somebody deliberately put away.
    ...(query.filter === 'archived' ? { status: 'ARCHIVED' } : { status: { not: 'ARCHIVED' } }),
    ...(query.search
      ? {
          OR: [
            { displayName: { contains: query.search, mode: 'insensitive' } },
            { externalId: { contains: query.search } },
          ],
        }
      : {}),
  };

  // One extra row decides whether there is a next page, without a second count
  // query over the same predicate.
  const rows = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      channel: true,
      externalId: true,
      displayName: true,
      status: true,
      unreadCount: true,
      lastMessageAt: true,
      ownerId: true,
      owner: { select: { id: true, fullName: true } },
      lead: { select: { id: true, reference: true, fullName: true } },
      // The preview line. One row, not the thread.
      communications: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, direction: true, createdAt: true, status: true },
      },
    },
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  return {
    conversations: page.map(({ communications, ...conversation }) => ({
      ...conversation,
      lastMessage: communications[0] ?? null,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
});
