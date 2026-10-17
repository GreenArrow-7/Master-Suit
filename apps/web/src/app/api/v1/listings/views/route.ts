import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { deleteView, saveView } from '@/services/inventory/views';

/** Saves the listing book's filters as one of the caller's own views (M11-08, M12-05). */
export const POST = route(
  {
    module: 'listings',
    productModule: LEAD_MODULES,
    action: 'VIEW',
    body: z.object({
      name: z.string().trim().min(1).max(60),
      /** The list's URL query as it stood; anything that is not one of its filters is dropped. */
      params: z.record(z.string(), z.unknown()).default({}),
    }),
  },
  async ({ ctx, body }) => saveView(ctx, 'LISTING', body.name, body.params),
);

/** Deletes one of the caller's own views, by `?viewId=`. */
export const DELETE = route(
  {
    module: 'listings',
    productModule: LEAD_MODULES,
    action: 'VIEW',
    query: z.object({ viewId: z.string().cuid() }).strict(),
  },
  async ({ ctx, query }) => deleteView(ctx, 'LISTING', query.viewId),
);
