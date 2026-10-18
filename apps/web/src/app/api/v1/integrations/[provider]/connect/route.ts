import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { PRODUCT_MODULE_KEYS } from '@/lib/modules/catalogue';
import { Conflict } from '@/lib/errors';
import { safeReturnTo } from '@/lib/security/redirect';
import { CALENDAR_PROVIDERS, CALENDARS, type CalendarProvider } from '@/services/integrations/calendarSync';

/**
 * Starts a calendar's connect flow — Google (M8-08) or Microsoft 365 (M8-09) —
 * and hands back where to send the browser, as the Facebook one does
 * (integrations/meta/connect): the workspace is the session's, the redirect
 * URI is fixed, and `returnTo` is a same-site path or the site root.
 */
const params = z.object({ provider: z.enum(CALENDAR_PROVIDERS as [CalendarProvider, ...CalendarProvider[]]) });
const body = z.object({ returnTo: z.string().max(200).optional() }).strict();

export const POST = route(
  {
    module: 'integrations',
    action: 'MANAGE_CONFIGURATION',
    // Any product: the calendar takes lead modules' meetings and Events' Meet links.
    productModule: PRODUCT_MODULE_KEYS,
    params,
    body,
    auditEvent: 'INTEGRATION_MODIFIED',
    // Each start is a consent screen, and each return a call to the vendor's token endpoint.
    rateLimit: { max: 30, windowSeconds: 300 },
  },
  async ({ ctx, params, body }) => {
    const calendar = CALENDARS[params.provider];
    if (!calendar.configured()) {
      const env = params.provider.toUpperCase();
      throw Conflict(
        `${calendar.label} is not configured on this deployment. An operator needs to set ${env}_CLIENT_ID and ${env}_CLIENT_SECRET.`,
      );
    }
    const url = await calendar.begin({
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      returnTo: safeReturnTo(body.returnTo),
    });
    return { url, redirectUri: calendar.redirectUri() };
  },
);
