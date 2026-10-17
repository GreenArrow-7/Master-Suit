import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { createSchedule, listSchedules, scheduleBody } from '@/services/leadership/reportSchedules';

/**
 * Scheduled report emails (M16-16): the caller's own. EXPORT, not VIEW: every
 * send is the CSV the Export button gives, leaving the building on a timer.
 */
export const GET = route({ module: 'reports', productModule: LEAD_MODULES, action: 'EXPORT' }, async ({ ctx }) => ({
  data: await listSchedules(ctx),
}));

export const POST = route(
  {
    module: 'reports',
    productModule: LEAD_MODULES,
    action: 'EXPORT',
    body: scheduleBody,
    sessionOnly: true,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => createSchedule(ctx, body),
);
