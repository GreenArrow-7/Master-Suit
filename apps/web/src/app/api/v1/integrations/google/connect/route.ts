import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { PRODUCT_MODULE_KEYS } from '@/lib/modules/catalogue';
import { Conflict } from '@/lib/errors';
import { googleOAuthConfigured } from '@/lib/integrations/calendar';
import { safeReturnTo } from '@/lib/security/redirect';
import { beginGoogleOAuth, googleRedirectUri } from '@/services/integrations/googleCalendar';

/**
 * Starts the Google Calendar connect flow and hands back where to send the
 * browser (M8-08), as the Facebook one does (integrations/meta/connect): the
 * workspace is the session's, the redirect URI is fixed, and `returnTo` is a
 * same-site path or the site root.
 */
const body = z.object({ returnTo: z.string().max(200).optional() }).strict();

export const POST = route(
  {
    module: 'integrations',
    action: 'MANAGE_CONFIGURATION',
    // Any product: the calendar takes lead modules' meetings and Events' Meet links.
    productModule: PRODUCT_MODULE_KEYS,
    body,
    auditEvent: 'INTEGRATION_MODIFIED',
  },
  async ({ ctx, body }) => {
    if (!googleOAuthConfigured()) {
      throw Conflict(
        'Google Calendar is not configured on this deployment. An operator needs to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
    const url = await beginGoogleOAuth({
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      returnTo: safeReturnTo(body.returnTo),
    });
    return { url, redirectUri: googleRedirectUri() };
  },
);
