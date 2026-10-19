import { readJsonBody } from '@/lib/api/read-body';
import { toResponse } from '@/lib/api/handler';
import { login, loginBody, requestInfo } from '@/lib/auth/login';

/**
 * The sign-in form's endpoint. The steps — password, second factor, throttle,
 * lockout, the session and where it goes — are in `lib/auth/login.ts`, which
 * the phone's sign-in (`/api/mobile/auth/sign-in`) runs too.
 */
export async function POST(req: Request) {
  const info = requestInfo(req);
  try {
    return await login(await readJsonBody(req, loginBody), info);
  } catch (err) {
    return toResponse(err, info.requestId, { route: '/api/v1/auth/login' });
  }
}
