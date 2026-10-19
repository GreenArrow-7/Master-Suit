import { route } from '@/lib/api/handler';
import { punchFromPhone } from '@/services/hr/mobileAttendance';

/**
 * Check out from the phone, with the face as on the web: the same multipart as
 * check-in. A position alone (the standalone app's JSON) is refused 422 with a
 * sentence the app shows.
 */
export const POST = route(
  { module: 'hr_self', action: 'VIEW', selfService: true, mobile: true },
  async ({ ctx, req }) => punchFromPhone(ctx, req, 'CHECK_OUT'),
);
