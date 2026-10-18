/**
 * The workspace's Microsoft 365 / Outlook calendar (M8-09): connecting it, and
 * writing a record's event through Microsoft Graph. What a record wants on the
 * calendar, when it is synced and how a failure is retried are the same as for
 * Google (calendarSync.ts).
 *
 * One calendar per workspace: the connected account's default calendar
 * (`/me/events`), with the record's owner invited so it is on theirs too.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { redis } from '@/lib/redis';
import {
  createGraphEvent,
  deleteGraphEvent,
  MICROSOFT_LOGIN,
  MICROSOFT_SCOPES,
  updateGraphEvent,
  type CalendarEvent,
} from '@/lib/integrations/calendar';
import type { OAuthState } from '@/services/meta/oauth';
import type { CalendarRecord } from './calendarSync';

// ── Connecting ───────────────────────────────────────────────────────────────

const STATE_PREFIX = 'microsoft:oauth:';
const STATE_TTL_SECONDS = 600;

/** One fixed URL: Microsoft matches it exactly against the app registration's redirect URIs. */
export const microsoftRedirectUri = () => `${env.APP_URL.replace(/\/$/, '')}/api/v1/integrations/microsoft/callback`;

/** The flow's state, plus the PKCE verifier its code is redeemed with. */
export interface MicrosoftOAuthState extends OAuthState {
  verifier: string;
}

/**
 * Where to send the browser. `state` is a random handle to the flow kept in
 * Redis (single use, ten minutes), as Google's is; the PKCE verifier stays
 * there too, so a code intercepted on its way back is worth nothing without it.
 */
export async function beginMicrosoftOAuth(state: OAuthState): Promise<string> {
  const handle = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  await redis.set(`${STATE_PREFIX}${handle}`, JSON.stringify({ ...state, verifier }), 'EX', STATE_TTL_SECONDS);
  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID ?? '',
    redirect_uri: microsoftRedirectUri(),
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    // The account chooser every time: the workspace's calendar need not be the account the browser is signed in to.
    prompt: 'select_account',
    state: handle,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return `${MICROSOFT_LOGIN}/authorize?${params}`;
}

export async function consumeMicrosoftOAuthState(handle: string): Promise<MicrosoftOAuthState | null> {
  if (!handle || handle.length > 200) return null;
  const raw = await redis.getdel(`${STATE_PREFIX}${handle}`).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MicrosoftOAuthState;
  } catch {
    return null;
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * The record's event as it should stand (`entry`), or removed (null). Graph
 * chooses event ids, so which event is the record's lives in CalendarEventLink;
 * its `transactionId` is stored before the create is sent, so a retry of a
 * create whose answer was lost sends the same one and Graph returns the event
 * the first attempt made.
 */
export async function writeMicrosoftEvent(
  token: string,
  { tenantId, kind, id }: { tenantId: string; kind: CalendarRecord; id: string },
  entry: CalendarEvent | null,
) {
  const record = { tenantId, provider: 'microsoft', recordKind: kind, recordId: id };
  const link = await prisma.calendarEventLink.findFirst({
    where: record,
    select: { transactionId: true, externalId: true },
  });

  if (!entry) {
    // ponytail: a create whose answer never came back (no externalId) cannot be found to remove; its retry
    // normally runs first. Look the event up by its transactionId if orphans ever show up.
    if (link?.externalId) await deleteGraphEvent(token, link.externalId);
    await prisma.calendarEventLink.deleteMany({ where: record });
    return;
  }
  if (link?.externalId && (await updateGraphEvent(token, link.externalId, entry))) return;

  // New, or deleted in Outlook since: created under a fresh transactionId. A link
  // without an id is a create still unanswered, retried under the one it has.
  if (!link)
    await prisma.calendarEventLink.createMany({
      data: [{ ...record, transactionId: randomUUID() }],
      skipDuplicates: true,
    });
  else if (link.externalId)
    await prisma.calendarEventLink.updateMany({
      where: record,
      data: { transactionId: randomUUID(), externalId: null },
    });
  // Read back: a sync of the same record running beside this one may have stored its own first.
  const { transactionId } = await prisma.calendarEventLink.findFirstOrThrow({
    where: record,
    select: { transactionId: true },
  });
  const externalId = await createGraphEvent(token, entry, transactionId);
  await prisma.calendarEventLink.updateMany({ where: record, data: { externalId } });
}
