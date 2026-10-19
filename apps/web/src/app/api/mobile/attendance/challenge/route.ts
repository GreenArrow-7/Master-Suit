import { route } from '@/lib/api/handler';
import { requestChallenge } from '@/services/hr/attendance';
import { PHONE_ATTEMPTS, PHONE_FRAMES } from '@/services/hr/mobileAttendance';

/**
 * What to do in front of the camera, fetched just before a check-in or
 * check-out: the web console's challenge (consent and enrolment checked, the
 * face engine up, a single-use nonce the server picked the move for), in the
 * standalone app's shape.
 */
export const POST = route(
  { module: 'hr_self', action: 'VIEW', selfService: true, mobile: true, rateLimit: PHONE_ATTEMPTS },
  async ({ ctx }) => {
    const challenge = await requestChallenge(ctx);
    return {
      challengeId: challenge.nonce,
      instruction: challenge.instruction,
      expiresIn: challenge.expiresInSeconds,
      frames: PHONE_FRAMES,
    };
  },
);
