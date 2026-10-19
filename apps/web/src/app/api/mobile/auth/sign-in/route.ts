import { z } from 'zod';
import { bareRoute } from '@/lib/api/handler';
import { readJsonBody } from '@/lib/api/read-body';
import { login, loginFields, requestInfo } from '@/lib/auth/login';

const body = z
  .object({
    ...loginFields,
    /** The workspace's slug: the token is bound to it for its 90 days. */
    workspace: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    /** "Yousef's iPhone", shown under Profile → Security beside its Sign out. */
    deviceName: z.string().trim().min(1).max(80).optional(),
    platform: z.enum(['ios', 'android']).optional(),
  })
  .strict();

/**
 * Sign a phone in (M20-10): the web form's steps — throttle, lockout, refused
 * accounts, the second factor as a second request carrying `challenge` and
 * `mfaCode` or `recoveryCode` — for the named workspace, answered with a
 * bearer token instead of a cookie: `{ token, expiresAt, workspace }`.
 */
export const POST = bareRoute('/api/mobile/auth/sign-in', async (req, requestId) => {
  const { workspace, deviceName, platform, ...credentials } = await readJsonBody(req, body);
  return login(credentials, requestInfo(req, requestId), {
    workspace,
    deviceName: deviceName ?? null,
    platform: platform ?? null,
  });
});
