import { route } from '@/lib/api/handler';
import { punchFromPhone } from '@/services/hr/mobileAttendance';

/**
 * Check in from the phone: multipart frames, the challenge and the position,
 * judged by the web console's `punch()` (services/hr/mobileAttendance.ts).
 */
export const POST = route(
  { module: 'hr_self', action: 'VIEW', selfService: true, mobile: true },
  async ({ ctx, req }) => punchFromPhone(ctx, req, 'CHECK_IN'),
);
