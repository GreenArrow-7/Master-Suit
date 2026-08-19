import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import { wrapCredentials } from '@/lib/integrations/connection';
import { audit } from '@/lib/security/audit';
import { completeMetaOAuth, consumeMetaOAuthState, metaOAuthConfigured } from '@/services/meta/oauth';

/**
 * Where Facebook sends the administrator back to.
 *
 * A browser navigation rather than an API call, so it redirects with a readable
 * message instead of returning JSON: whatever happens here, a person is looking
 * at the result.
 *
 * Identity comes from the session, exactly as everywhere else. `state` proves
 * this redirect belongs to a flow this server started; it never *establishes*
 * who the caller is. Both are checked, and they have to agree — a state minted
 * for one workspace is refused when the session is in another, which is the
 * attack this parameter exists to stop.
 */
export const dynamic = 'force-dynamic';

function back(returnTo: string, params: Record<string, string>) {
  const target = returnTo.startsWith('/') ? returnTo : '/';
  const url = new URL(target, env.APP_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const requestId = randomUUID();
  const query = new URL(req.url).searchParams;

  /**
   * The state is consumed first, and unconditionally.
   *
   * It has to be spent even on the cancel path: leaving a live handle behind
   * after a failed attempt is a replayable credential, and the cost of spending
   * it is that the administrator starts again — which they were going to do
   * anyway.
   */
  const state = await consumeMetaOAuthState(query.get('state') ?? '');

  // Nothing sensible to redirect to without a state, and no reason to trust the
  // rest of the query either.
  if (!state) {
    logger.warn({ requestId }, 'meta oauth callback with an unknown state');
    return back('/', { connected: 'meta', error: 'That connection link has expired. Please try again.' });
  }

  const cancelled = query.get('error');
  if (cancelled) {
    // Meta sends error=access_denied&error_reason=user_denied when somebody
    // closes the consent screen. That is a decision, not a fault.
    const reason =
      query.get('error_reason') === 'user_denied'
        ? 'Connection cancelled — nothing was changed.'
        : (query.get('error_description') ?? 'Facebook refused the connection.');
    return back(state.returnTo, { connected: 'meta', error: reason });
  }

  const code = query.get('code');
  if (!code)
    return back(state.returnTo, { connected: 'meta', error: 'Facebook did not return an authorisation code.' });

  try {
    if (!metaOAuthConfigured()) throw new Error('Facebook & Instagram is not configured on this deployment.');

    const ctx = await resolveCtx(req, requestId);

    /**
     * The session decides the workspace, and it must be the one the flow began
     * in. Someone who signs into another workspace mid-flow, or replays a
     * captured link from a different session, lands here — and gets nothing.
     */
    if (ctx.tenantId !== state.tenantId) {
      logger.warn({ requestId, session: ctx.tenantId, state: state.tenantId }, 'meta oauth workspace mismatch');
      return back(state.returnTo, {
        connected: 'meta',
        error: 'That connection was started in a different workspace. Please try again from this one.',
      });
    }
    // Re-checked here rather than assumed from the start of the flow: a role can
    // change while a consent screen is open.
    if (!can(ctx, 'integrations', 'MANAGE_CONFIGURATION')) {
      return back(state.returnTo, { connected: 'meta', error: 'Your role cannot manage integrations.' });
    }

    const assets = await completeMetaOAuth(code);

    /**
     * Tokens are wrapped before they touch the database, and the Page id and
     * names go in `metadata` — readable without the encryption key because the
     * admin screen shows them, and worthless to anyone who reads them.
     */
    await prisma.integrationConnection.upsert({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider: 'meta' } },
      create: {
        tenantId: ctx.tenantId,
        provider: 'meta',
        status: 'CONNECTED',
        credentials: wrapCredentials({ accessToken: assets.accessToken }),
        scopes: assets.scopes,
        expiresAt: assets.expiresAt,
        externalUserId: assets.pageId,
        metadata: {
          pageId: assets.pageId,
          pageName: assets.pageName,
          instagramId: assets.instagramId ?? '',
          instagramHandle: assets.instagramHandle ?? '',
          businessName: assets.businessName ?? assets.pageName,
        },
        createdById: ctx.actor.id,
      },
      update: {
        status: 'CONNECTED',
        credentials: wrapCredentials({ accessToken: assets.accessToken }),
        scopes: assets.scopes,
        expiresAt: assets.expiresAt,
        externalUserId: assets.pageId,
        errorMessage: null,
        metadata: {
          pageId: assets.pageId,
          pageName: assets.pageName,
          instagramId: assets.instagramId ?? '',
          instagramHandle: assets.instagramHandle ?? '',
          businessName: assets.businessName ?? assets.pageName,
        },
      },
    });

    // Never the token, and never the secret — only that a connection changed and
    // which Page it points at.
    await audit(ctx, {
      event: 'INTEGRATION_MODIFIED',
      objectType: 'integration',
      recordId: 'meta',
      newValue: { status: 'CONNECTED', pageId: assets.pageId, scopes: assets.scopes },
    });

    logger.info({ requestId, tenantId: ctx.tenantId, pageId: assets.pageId }, 'meta connected');
    return back(state.returnTo, { connected: 'meta', page: assets.pageName });
  } catch (err) {
    const message = (err as Error).message;
    logger.warn({ requestId, err: message }, 'meta oauth callback failed');
    return back(state.returnTo, { connected: 'meta', error: message.slice(0, 300) });
  }
}
