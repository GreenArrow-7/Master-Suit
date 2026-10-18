import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import { wrapCredentials } from '@/lib/integrations/connection';
import { audit } from '@/lib/security/audit';
import { safeReturnTo } from '@/lib/security/redirect';
import { CALENDARS, isCalendarProvider } from '@/services/integrations/calendarSync';

/**
 * Where Google (M8-08) or Microsoft (M8-09) sends the administrator back to:
 * `/api/v1/integrations/google/callback`, `…/microsoft/callback`. A browser
 * navigation, so every outcome is a redirect with a readable message —
 * including no session at all (the flow finished in another browser, a phone's
 * own browser opened from the app), which is why this is a plain handler, as
 * the Facebook one is (integrations/meta/callback), and not the kernel's
 * `route()`: that answers a 401 body before the state is spent.
 *
 * The session decides the workspace; `state` proves the redirect belongs to a
 * flow this server started in that same workspace.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isCalendarProvider(provider)) return NextResponse.json({ detail: 'Not found' }, { status: 404 });
  const calendar = CALENDARS[provider];
  const requestId = randomUUID();
  const query = new URL(req.url).searchParams;

  function back(returnTo: string, error?: string) {
    const url = new URL(safeReturnTo(returnTo), env.APP_URL);
    url.searchParams.set('connected', provider);
    if (error) url.searchParams.set('error', error);
    return NextResponse.redirect(url);
  }

  // Spent first, on every path: a live handle left behind is a replayable credential.
  const state = await calendar.consume(query.get('state') ?? '');
  if (!state) return back('/', 'That connection link has expired. Please try again.');

  const ctx = await resolveCtx(req, requestId).catch(() => null);
  if (!ctx) {
    return back(
      state.returnTo,
      `Sign in to YOUHAN ONE in this browser, then connect ${calendar.label} again from Admin → Integrations.`,
    );
  }
  // A path chosen in another workspace never steers this session: it lands on the site root.
  if (state.tenantId !== ctx.tenantId) {
    logger.warn({ requestId, provider, session: ctx.tenantId, state: state.tenantId }, 'oauth workspace mismatch');
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
        : `${calendar.vendor} refused the connection: ${error.slice(0, 200)}`,
    );
  }
  const code = query.get('code');
  if (!code) return back(state.returnTo, `${calendar.vendor} did not return an authorisation code.`);

  try {
    if (!calendar.configured()) throw new Error(`${calendar.label} is not configured on this deployment.`);
    const tokens = await calendar.exchange(code.slice(0, 4000), state);
    if (!tokens.refreshToken) throw new Error(`${calendar.vendor} sent no refresh token. Please connect again.`);

    // Tokens wrapped before they are stored; the settings already saved stay as they are.
    const data = {
      status: 'CONNECTED',
      credentials: wrapCredentials({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
      scopes: tokens.scopes,
      expiresAt: tokens.expiresAt,
      errorMessage: null,
      lastSyncAt: new Date(),
    };
    await prisma.integrationConnection.upsert({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
      create: { ...data, tenantId: ctx.tenantId, provider, createdById: ctx.actor.id },
      update: data,
    });
    // Never the tokens: that the connection changed, and what it may do.
    await audit(ctx, {
      event: 'INTEGRATION_MODIFIED',
      objectType: 'integration',
      recordId: provider,
      newValue: { status: 'CONNECTED', scopes: tokens.scopes },
    });
    return back(state.returnTo);
  } catch (err) {
    const message = (err as Error).message;
    logger.warn({ requestId, provider, err: message }, 'oauth callback failed');
    return back(state.returnTo, message.slice(0, 300));
  }
}
