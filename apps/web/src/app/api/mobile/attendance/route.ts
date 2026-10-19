import { route } from '@/lib/api/handler';
import { currentShift } from '@/services/hr/mobileAttendance';

/** The open check-in and today's calling target, or `{ shift: null }`. */
export const GET = route({ module: 'hr_self', action: 'VIEW', selfService: true, mobile: true }, async ({ ctx }) => ({
  shift: await currentShift(ctx),
}));
