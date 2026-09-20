import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { dailyBoard } from '@/services/targets/dailyBoard';

const query = z.object({
  /** YYYY-MM-DD in the workspace's time zone; today when omitted. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * The daily lead-target board. Who appears is decided by the caller's reports
 * scope (their subtree, the whole workspace, or only themselves); every number
 * is counted from calls, follow-ups, meetings, opportunities and attendance.
 */
export const GET = route({ module: 'leads', productModule: 'SALES', action: 'VIEW', query }, async ({ ctx, query }) =>
  dailyBoard(ctx, query.date),
);
