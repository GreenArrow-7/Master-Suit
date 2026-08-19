/**
 * Connecting a workspace's Facebook Page and Instagram account.
 *
 * Until now the connection was created outside the product — a row somebody
 * wrote by hand — which meant nobody could actually adopt the feature without
 * an engineer. This is the flow that makes it self-service.
 *
 * Two things carry the security of the whole exchange:
 *
 * 1. The app secret never leaves the server. The browser is sent to Facebook
 *    with the app *id* and a state string; the secret is used only here, in the
 *    token exchange, and the resulting tokens are wrapped before they are stored.
 *
 * 2. `state` is not a signed blob the caller can mint. It is a random handle to
 *    a record held server-side, bound to the workspace and the person who
 *    started the flow, single-use, and short-lived. The callback trusts the
 *    session for identity and uses `state` only to prove the redirect belongs to
 *    a flow this server started.
 *
 * Contract checked against live documentation on 2026-08-17, not recalled:
 *   dialog    GET https://www.facebook.com/v26.0/dialog/oauth
 *             client_id, redirect_uri, state, scope, response_type=code
 *   exchange  GET /v26.0/oauth/access_token
 *             client_id, client_secret, redirect_uri, code
 *   long-lived GET /v26.0/oauth/access_token
 *             grant_type=fb_exchange_token, client_id, client_secret, fb_exchange_token
 *             — about 60 days.
 *   pages     GET /v26.0/me/accounts
 *             Page tokens derived from a long-lived user token do not expire on
 *             a timer, which is why the Page token is what gets stored.
 *   cancel    the redirect carries error=access_denied&error_reason=user_denied
 */
import { randomBytes } from 'node:crypto';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

export const GRAPH_VERSION = 'v26.0';

/**
 * What the product actually needs, and nothing more.
 *
 * Every scope here is one App Review will be asked about, so an unused one is a
 * question to answer for a feature that does not exist. Comment capture and
 * reply need the first four; lead forms need the last.
 */
export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_engagement',
  'pages_messaging',
  'instagram_basic',
  'instagram_manage_comments',
  'pages_manage_metadata',
  'leads_retrieval',
] as const;

const STATE_PREFIX = 'meta:oauth:';
/** Long enough to read a consent screen, short enough that a leaked link is stale. */
const STATE_TTL_SECONDS = 600;

export interface OAuthState {
  tenantId: string;
  actorId: string;
  /** Where to send the administrator back to once this finishes. */
  returnTo: string;
}

export function metaOAuthConfigured(): boolean {
  return Boolean(env.META_APP_ID && env.META_APP_SECRET);
}

/** One fixed URL, because Meta matches the redirect exactly against the app's allow-list. */
export function metaRedirectUri(): string {
  return `${env.APP_URL.replace(/\/$/, '')}/api/v1/integrations/meta/callback`;
}

/**
 * Starts a flow and returns where to send the browser.
 *
 * The state is created here rather than in the route so that the only way to
 * obtain a valid one is to have gone through this function with a real session.
 */
export async function beginMetaOAuth(state: OAuthState): Promise<string> {
  const handle = randomBytes(32).toString('base64url');
  await redis.set(`${STATE_PREFIX}${handle}`, JSON.stringify(state), 'EX', STATE_TTL_SECONDS);

  const params = new URLSearchParams({
    client_id: env.META_APP_ID!,
    redirect_uri: metaRedirectUri(),
    state: handle,
    scope: META_SCOPES.join(','),
    response_type: 'code',
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`;
}

/**
 * Reads a state once and destroys it.
 *
 * `getdel` rather than get-then-delete: a replayed callback and a genuine one
 * arriving together must not both succeed, and the atomic form is the only
 * version of this that is actually single-use.
 */
export async function consumeMetaOAuthState(handle: string): Promise<OAuthState | null> {
  if (!handle || handle.length > 200) return null;
  const raw = await redis.getdel(`${STATE_PREFIX}${handle}`).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthState;
  } catch {
    return null;
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

async function graph(path: string, params: Record<string, string>): Promise<TokenResponse & Record<string, unknown>> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const data = (await res.json().catch(() => ({}))) as TokenResponse & Record<string, unknown>;
  if (!res.ok || data.error) {
    // Meta's own wording. "Invalid verification code format" tells an
    // administrator what happened; "connect failed" does not.
    throw new Error(data.error?.message ?? `Facebook returned HTTP ${res.status}`);
  }
  return data;
}

export interface MetaAssets {
  accessToken: string;
  /** When the *user* token expires. Page tokens derived from it do not. */
  expiresAt: Date | null;
  pageId: string;
  pageName: string;
  instagramId: string | null;
  instagramHandle: string | null;
  scopes: string[];
  businessName: string | null;
}

/**
 * Turns the one-time code into something the product can use.
 *
 * The Page token is what gets kept, not the user token: it is what every call
 * this integration makes is authorised by, and unlike the user token it does
 * not quietly expire in sixty days and take comment capture down with it.
 */
export async function completeMetaOAuth(code: string): Promise<MetaAssets> {
  const short = await graph('oauth/access_token', {
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    redirect_uri: metaRedirectUri(),
    code,
  });
  if (!short.access_token) throw new Error('Facebook did not return an access token.');

  const long = await graph('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    fb_exchange_token: short.access_token,
  });
  const userToken = long.access_token ?? short.access_token;
  const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null;

  const accounts = (await graph('me/accounts', {
    access_token: userToken,
    fields: 'id,name,access_token,tasks,instagram_business_account{id,username}',
    limit: '100',
  })) as {
    data?: {
      id?: string;
      name?: string;
      access_token?: string;
      tasks?: string[];
      instagram_business_account?: { id?: string; username?: string };
    }[];
  };

  const pages = accounts.data ?? [];
  if (pages.length === 0) {
    throw new Error(
      'That account does not manage any Facebook Page. Connect with an account that has a Page role, then try again.',
    );
  }

  /**
   * The first Page that can actually be used, not simply the first returned.
   *
   * Someone with a role on several Pages may hold only ANALYZE on one of them,
   * and connecting that would produce an integration that authenticates
   * perfectly and refuses every write. Preferring a Page that can moderate and
   * message turns a confusing later failure into an obvious one now.
   */
  const usable =
    pages.find((p) => p.access_token && p.tasks?.includes('MODERATE') && p.tasks?.includes('MESSAGING')) ??
    pages.find((p) => p.access_token) ??
    pages[0]!;

  if (!usable.access_token) {
    throw new Error('Facebook did not return a Page access token. Check the Page roles on that account.');
  }

  /**
   * What Meta actually granted, which is rarely everything asked for — a person
   * can untick permissions on the consent screen. `replyCapability` reads this
   * to decide what to offer, so recording the truth here is what stops the UI
   * promising a reply the connection cannot send.
   */
  const permissions = (await graph('me/permissions', { access_token: userToken })) as {
    data?: { permission?: string; status?: string }[];
  };
  const scopes = (permissions.data ?? [])
    .filter((p) => p.status === 'granted' && p.permission)
    .map((p) => p.permission!);

  logger.info(
    { pageId: usable.id, hasInstagram: Boolean(usable.instagram_business_account?.id), scopes: scopes.length },
    'meta oauth completed',
  );

  return {
    accessToken: usable.access_token,
    expiresAt,
    pageId: String(usable.id),
    pageName: String(usable.name ?? 'Facebook Page'),
    instagramId: usable.instagram_business_account?.id ?? null,
    instagramHandle: usable.instagram_business_account?.username
      ? `@${usable.instagram_business_account.username}`
      : null,
    scopes,
    businessName: String(usable.name ?? '') || null,
  };
}
