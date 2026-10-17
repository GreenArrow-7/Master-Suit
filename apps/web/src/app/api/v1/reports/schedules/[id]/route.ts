import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { deleteSchedule } from '@/services/leadership/reportSchedules';

const params = z.object({ id: z.string().min(1) });

/** Stops a scheduled report email; another person's schedule answers 404, as a missing one does. */
export const DELETE = route(
  { module: 'reports', productModule: LEAD_MODULES, action: 'EXPORT', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => deleteSchedule(ctx, params.id),
);
