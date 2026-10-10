import { prisma } from '@/lib/db';

const LIFTED = new Set<string>(['HIGH', 'URGENT']);
const lifted = (n: { priority: string; readAt: Date | null }) => !n.readAt && LIFTED.has(n.priority);

/**
 * Your own feed: newest first, with unread HIGH/URGENT rows lifted to the top.
 * The bell and the Inbox both read through here so they cannot order
 * differently. Read rows and LOW/MEDIUM rows keep their pure recency order.
 */
export async function listFeed(tenantId: string, userId: string, take: number) {
  const rows = await prisma.notification.findMany({
    where: { tenantId, userId },
    orderBy: { createdAt: 'desc' },
    take,
  });
  // ponytail: lifts only within the `take` window (Array.sort is stable, so recency holds inside each group);
  // switch to orderBy [{ readAt: { sort: 'asc', nulls: 'first' } }, { priority: 'desc' }, { createdAt: 'desc' }]
  // if an unread HIGH older than the window must surface.
  return rows.sort((a, b) => Number(lifted(b)) - Number(lifted(a)));
}
