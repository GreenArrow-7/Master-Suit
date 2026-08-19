import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { Conflict } from '@/lib/errors';
import { beginMetaOAuth, metaOAuthConfigured, metaRedirectUri } from '@/services/meta/oauth';

/**
 * Starts the Facebook connect flow and hands back where to send the browser.
 *
 * A POST that returns a URL rather than a redirect, because the caller is
 * `fetch` from an admin screen: a 302 to facebook.com would be followed by the
 * fetch and land as an opaque CORS failure instead of a page the person can see.
 *
 * The workspace being connected comes from the session. Nothing about the
 * destination is taken from the request — a caller cannot aim the flow at
 * another tenant, and cannot choose the redirect URI Meta will honour anyway.
 */
const body = z.object({ returnTo: z.string().max(200).optional() }).strict();

export const POST = route(
  { module: 'integrations', action: 'MANAGE_CONFIGURATION', body, auditEvent: 'INTEGRATION_MODIFIED' },
  async ({ ctx, body }) => {
    if (!metaOAuthConfigured()) {
      throw Conflict(
        'Facebook & Instagram is not configured on this deployment. An operator needs to set META_APP_ID and META_APP_SECRET.',
      );
    }

    /**
     * A relative path only. Taking a full URL here would turn the connect
     * button into an open redirect that survives a round trip through Facebook.
     */
    const returnTo = body.returnTo?.startsWith('/') ? body.returnTo : '/';

    const url = await beginMetaOAuth({ tenantId: ctx.tenantId, actorId: ctx.actor.id, returnTo });
    return { url, redirectUri: metaRedirectUri() };
  },
);
