import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import { googleOAuthConfigured, googleToken } from '@/lib/integrations/calendar';
import { wrapCredentials } from '@/lib/integrations/connection';
import { audit } from '@/lib/security/audit';
import { safeReturnTo } from '@/lib/security/redirect';
import { consumeGoogleOAuthState, googleRedirectUri } from '@/services/integrations/googleCalendar';

/**
 * Where Google sends the administrator back to (M8-08). A browser navigation,
 * so every outcome is a redirect with a readable message — including no
 * session at all (the flow finished in another browser, a phone's own browser
 * opened from the app), which is why this is a plain handler, as the Facebook
 * one is (integrations/meta/callback), and not the kernel's `route()`: that
 * answers a 401 body before the state is spent.
 *
 * The session decides the workspace; `state` proves the redirect belongs to a
 * flow this server started in that same workspace.
 */
function back(returnTo: string, error?: string) {
  const url = new URL(safeReturnTo(returnTo), env.APP_URL);
  url.searchParams.set('connected', 'google');
  if (error) url.searchParams.set('error', error);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const requestId = randomUUID();
  const query = new URL(req.url).searchParams;

  // Spent first, on every path: a live handle left behind is a replayable credential.
  const state = await consumeGoogleOAuthState(query.get('state') ?? '');
  if (!state) return back('/', 'That connection link has expired. Please try again.');

  const ctx = await resolveCtx(req, requestId).catch(() => null);
  if (!ctx) {
    return back(
      state.returnTo,
      'Sign in to YOUHAN ONE in this browser, then connect Google Calendar again from Admin → Integrations.',
    );
  }
  // A path chosen in another workspace never steers this session: it lands on the site root.
  if (state.tenantId !== ctx.tenantId) {
    logger.warn({ requestId, session: ctx.tenantId, state: state.tenantId }, 'google oauth workspace mismatch');
    return back('/', 'That connection was started in a different workspace. Please try again from this one.');
  }
  // Re-checked here: a role can change while the consent screen is open.
  if (!can(ctx, 'integrations', 'MANAGE_CONFIGURATION')) {
    return back(state.returnTo, 'Your role cannot manage integrations.');
  }

  const error = query.get('error');
  if (error) {
    return back(
      state.returnTo,
      error === 'access_denied'
        ? 'Connection cancelled — nothing was changed.'
        : `Google refused the connection: ${error.slice(0, 200)}`,
    );
  }
  const code = query.get('code');
  if (!code) return back(state.returnTo, 'Google did not return an authorisation code.');

  try {
    if (!googleOAuthConfigured()) throw new Error('Google Calendar is not configured on this deployment.');
    const tokens = await googleToken({ code: code.slice(0, 2000), redirectUri: googleRedirectUri() });
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
    logger.warn({ requestId, err: message }, 'google oauth callback failed');
    return back(state.returnTo, message.slice(0, 300));
  }
}
