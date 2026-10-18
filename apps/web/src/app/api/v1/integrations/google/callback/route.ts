import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { PRODUCT_MODULE_KEYS } from '@/lib/modules/catalogue';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { googleOAuthConfigured, googleToken } from '@/lib/integrations/calendar';
import { wrapCredentials } from '@/lib/integrations/connection';
import { audit } from '@/lib/security/audit';
import { safeReturnTo } from '@/lib/security/redirect';
import { consumeGoogleOAuthState, googleRedirectUri } from '@/services/integrations/googleCalendar';

/**
 * Where Google sends the administrator back to (M8-08). A browser navigation,
 * so every outcome is a redirect with a readable message. The session decides
 * the workspace (the kernel, signed in only); `state` proves the redirect
 * belongs to a flow this server started in that same workspace.
 *
 * Not strict: Google adds `scope`, `authuser`, `prompt` and `hd` to the query.
 */
const query = z.object({
  state: z.string().max(200).optional(),
  code: z.string().max(2000).optional(),
  error: z.string().max(200).optional(),
});

function back(returnTo: string, error?: string) {
  const url = new URL(safeReturnTo(returnTo), env.APP_URL);
  url.searchParams.set('connected', 'google');
  if (error) url.searchParams.set('error', error);
  return NextResponse.redirect(url);
}

export const GET = route(
  {
    module: 'integrations',
    action: 'MANAGE_CONFIGURATION',
    productModule: PRODUCT_MODULE_KEYS,
    sessionOnly: true,
    query,
  },
  async ({ ctx, query }) => {
    // Spent first, on every path: a live handle left behind is a replayable credential.
    const state = await consumeGoogleOAuthState(query.state ?? '');
    if (!state) return back('/', 'That connection link has expired. Please try again.');
    if (state.tenantId !== ctx.tenantId) {
      return back(
        state.returnTo,
        'That connection was started in a different workspace. Please try again from this one.',
      );
    }
    if (query.error) {
      return back(
        state.returnTo,
        query.error === 'access_denied'
          ? 'Connection cancelled — nothing was changed.'
          : `Google refused the connection: ${query.error}`,
      );
    }
    if (!query.code) return back(state.returnTo, 'Google did not return an authorisation code.');

    try {
      if (!googleOAuthConfigured()) throw new Error('Google Calendar is not configured on this deployment.');
      const tokens = await googleToken({ code: query.code, redirectUri: googleRedirectUri() });
      if (!tokens.refreshToken) throw new Error('Google sent no refresh token. Please connect again.');

      // Tokens wrapped before they are stored; the calendar and sync switch already saved stay as they are.
      const data = {
        status: 'CONNECTED',
        credentials: wrapCredentials({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
        scopes: tokens.scopes,
        expiresAt: tokens.expiresAt,
        errorMessage: null,
        lastSyncAt: new Date(),
      };
      await prisma.integrationConnection.upsert({
        where: { tenantId_provider: { tenantId: ctx.tenantId, provider: 'google' } },
        create: { ...data, tenantId: ctx.tenantId, provider: 'google', createdById: ctx.actor.id },
        update: data,
      });
      // Never the tokens: that the connection changed, and what it may do.
      await audit(ctx, {
        event: 'INTEGRATION_MODIFIED',
        objectType: 'integration',
        recordId: 'google',
        newValue: { status: 'CONNECTED', scopes: tokens.scopes },
      });
      return back(state.returnTo);
    } catch (err) {
      const message = (err as Error).message;
      logger.warn({ requestId: ctx.requestId, err: message }, 'google oauth callback failed');
      return back(state.returnTo, message.slice(0, 300));
    }
  },
);
