import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { NotFound } from '@/lib/errors';
import { dailyCalls } from '@/services/targets/dailyBoard';

const params = z.object({ userId: z.string().cuid() });
const query = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * One seller's day: their board row and every call behind it. A seller the
 * caller may not see is a 404, not an empty list.
 */
export const GET = route(
  { module: 'leads', productModule: 'SALES', action: 'VIEW', params, query },
  async ({ ctx, params, query }) => {
    const result = await dailyCalls(ctx, params.userId, query.date);
    if (result.board.rows.length === 0) throw NotFound('Seller');
    return result;
  },
);
