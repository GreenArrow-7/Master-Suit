import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { reconciliation } from '@/services/money/commissions';

const query = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .strict()
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'The range ends before it starts.' });

/**
 * What was earned against what was reversed, for a period.
 *
 * Deliberately organization-wide rather than owner-scoped: a reconciliation
 * that only shows your own rows reconciles nothing. The permission is the
 * control, not the scope.
 */
export const GET = route(
  { module: 'commissions', productModule: 'SALES', action: 'EXPORT', query },
  async ({ ctx, query: q }) => reconciliation(ctx.tenantId, q.from, q.to),
);
