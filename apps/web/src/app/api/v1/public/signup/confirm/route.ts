import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { confirmSignup } from '@/services/platform/signup';

/**
 * Self-serve sign-up, step two: the emailed link's token makes the workspace.
 * A POST from the confirmation page's script, never the link's GET, so a mail
 * scanner that opens links cannot use one up.
 */
export const POST = route(
  {
    module: 'settings',
    // Not CREATE: the rate limit keys on module and action, and the confirmation
    // must not spend the request form's allowance.
    action: 'EDIT',
    anonymous: true,
    body: z.object({ token: z.string().min(20).max(200) }).strict(),
    rateLimit: { max: 10, windowSeconds: 3600 },
  },
  async ({ body }) => confirmSignup(body.token),
);
