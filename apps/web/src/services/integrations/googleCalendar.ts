/**
 * The workspace's Google Calendar (M8-08): connecting it, and keeping the CRM's
 * meetings, follow-ups and site visits on it.
 *
 * One calendar per workspace, as the Google Workspace connection always was
 * (`IntegrationConnection` per tenant and provider): events go on the calendar
 * it names (`calendarId`, default the connected account's primary) with the
 * record's owner as a guest, so the entry is on their own calendar too.
 *
 * A write never waits on Google. The route commits, then `queueCalendarSync`
 * queues the record; the job reads it as it now stands and writes, moves or
 * removes its event. Google down fails the job (retried by the queue, the
 * reason on the Integrations card), never the follow-up.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { redis } from '@/lib/redis';
import { decryptCredentials, wrapCredentials } from '@/lib/integrations/connection';
import {
  deleteGoogleCalendarEvent,
  googleOAuthConfigured,
  googleToken,
  putGoogleCalendarEvent,
  type CalendarEvent,
} from '@/lib/integrations/calendar';
import { FOLLOW_UP_KIND_LABELS, type FollowUpKind } from '@/lib/leads/followUpDue';
import { entityRoute } from '@/lib/nav/entityRoute';
import type { OAuthState } from '@/services/meta/oauth';

// ── Connecting ───────────────────────────────────────────────────────────────

/** Events on calendars the account can reach; nothing else of theirs. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events'] as const;

const STATE_PREFIX = 'google:oauth:';
const STATE_TTL_SECONDS = 600;

/** One fixed URL: Google matches it exactly against the OAuth client's list. */
export const googleRedirectUri = () => `${env.APP_URL.replace(/\/$/, '')}/api/v1/integrations/google/callback`;

/**
 * Where to send the browser. `state` is a random handle to the flow kept in
 * Redis (single use, ten minutes), as in services/meta/oauth.ts: the URL
 * carries neither the workspace nor the person.
 */
export async function beginGoogleOAuth(state: OAuthState): Promise<string> {
  const handle = randomBytes(32).toString('base64url');
  await redis.set(`${STATE_PREFIX}${handle}`, JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    // A refresh token, every time: without one the calendar stops after an hour.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: handle,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function consumeGoogleOAuthState(handle: string): Promise<OAuthState | null> {
  if (!handle || handle.length > 200) return null;
  const raw = await redis.getdel(`${STATE_PREFIX}${handle}`).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthState;
  } catch {
    return null;
  }
}

/**
 * A live access token for the workspace's calendar, or null when none is
 * connected. A connection made through Google is refreshed with the
 * deployment's OAuth client once its hour is up, the new token kept encrypted.
 */
export async function googleAccessToken(tenantId: string): Promise<string | null> {
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider: 'google' } },
    select: { status: true, credentials: true, expiresAt: true },
  });
  if (!conn || conn.status !== 'CONNECTED') return null;
  const credentials = decryptCredentials((conn.credentials ?? {}) as Record<string, unknown>);
  const stale = !conn.expiresAt || conn.expiresAt.getTime() < Date.now() + 60_000;
  if (!stale || !credentials.refreshToken || !googleOAuthConfigured()) return credentials.accessToken || null;

  const fresh = await googleToken({ refreshToken: credentials.refreshToken });
  await prisma.integrationConnection.updateMany({
    where: { tenantId, provider: 'google' },
    data: {
      credentials: wrapCredentials({ ...credentials, accessToken: fresh.accessToken }),
      expiresAt: fresh.expiresAt,
    },
  });
  return fresh.accessToken;
}

// ── Keeping the calendar ─────────────────────────────────────────────────────

export type CalendarRecord = 'followUp' | 'task' | 'visit';

/** Follow-ups on the calendar unless the connection says every one (`syncAllFollowUps`). */
const CALENDAR_KINDS: readonly string[] = ['MEETING', 'SITE_VISIT'];

/**
 * The event's id, ours rather than Google's: hex (inside Google's base32hex),
 * the same for the record every time. A sync needs nothing stored to find the
 * event again, and a record deleted outright can still take its event with it.
 */
export const calendarEventId = (tenantId: string, kind: CalendarRecord, id: string) =>
  createHash('sha256').update(`${tenantId}:${kind}:${id}`).digest('hex');

/**
 * After the write commits: each record's event follows it. Only where the
 * workspace has a connected calendar, and never throwing — the CRM write has
 * already happened and must not be reported as failed.
 */
export async function queueCalendarSync(
  tenantId: string,
  kind: CalendarRecord,
  ...ids: (string | null | undefined)[]
): Promise<void> {
  try {
    const wanted = ids.filter((id): id is string => !!id);
    if (!wanted.length) return;
    const connected = await prisma.integrationConnection.findFirst({
      where: { tenantId, provider: 'google', status: 'CONNECTED' },
      select: { id: true },
    });
    if (!connected) return;
    // `fresh`: a second change to the record is a second sync, not the first one's id.
    for (const id of wanted) await enqueue('notifications', 'calendar-sync', { tenantId, kind, id }, { fresh: true });
  } catch (err) {
    logger.warn({ err, tenantId, kind }, 'calendar sync not queued');
  }
}

/** The queue's job: the record's event as the record now stands. */
export async function syncCalendarEntry({
  tenantId,
  kind,
  id,
}: {
  tenantId: string;
  kind: CalendarRecord;
  id: string;
}) {
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider: 'google' } },
    select: { status: true, metadata: true },
  });
  if (conn?.status !== 'CONNECTED') return { skipped: 'not connected' as const };
  const settings = (conn.metadata ?? {}) as Record<string, unknown>;
  const entry = await calendarEntry(tenantId, kind, id, settings.syncAllFollowUps === true);
  if (entry === 'skip') return { skipped: 'not a calendar entry' as const };

  const calendarId =
    typeof settings.calendarId === 'string' && settings.calendarId.trim() ? settings.calendarId.trim() : 'primary';
  const eventId = calendarEventId(tenantId, kind, id);
  const where = { tenantId, provider: 'google' };
  try {
    const token = await googleAccessToken(tenantId);
    if (!token) return { skipped: 'not connected' as const };
    if (entry) await putGoogleCalendarEvent(token, calendarId, eventId, entry);
    else await deleteGoogleCalendarEvent(token, calendarId, eventId);
    await prisma.integrationConnection.updateMany({ where, data: { lastSyncAt: new Date(), errorMessage: null } });
    return { synced: entry ? ('saved' as const) : ('removed' as const) };
  } catch (err) {
    // On the Integrations card, and thrown so the queue tries again.
    const message = `Calendar sync failed: ${(err as Error).message}`.slice(0, 300);
    await prisma.integrationConnection.updateMany({ where, data: { errorMessage: message } });
    throw err;
  }
}

/** The event a record wants: null to remove it, 'skip' for a record the calendar does not hold. */
async function calendarEntry(
  tenantId: string,
  kind: CalendarRecord,
  id: string,
  everyFollowUp: boolean,
): Promise<CalendarEvent | null | 'skip'> {
  const lead = { select: { fullName: true } } as const;
  let row: {
    title: string;
    text: string | null;
    startAt: Date;
    minutes: number;
    status: string;
    ownerId: string | null;
    leadId: string | null;
    leadName?: string;
    location?: string | null;
  };

  if (kind === 'followUp') {
    const f = await prisma.followUpTask.findFirst({
      where: { tenantId, id },
      select: {
        title: true,
        description: true,
        dueAt: true,
        kind: true,
        status: true,
        ownerId: true,
        leadId: true,
        lead,
      },
    });
    // ponytail: a call follow-up put on while every follow-up synced stays when that is switched off.
    if (f && !everyFollowUp && !CALENDAR_KINDS.includes(f.kind)) return 'skip';
    if (!f || f.status === 'CANCELLED') return null;
    const label = FOLLOW_UP_KIND_LABELS[f.kind as FollowUpKind] ?? 'Follow-up';
    row = {
      ...f,
      title: `${label}: ${f.title}`,
      text: f.description,
      startAt: f.dueAt,
      minutes: 30,
      leadName: f.lead?.fullName,
    };
  } else if (kind === 'task') {
    const t = await prisma.task.findFirst({
      where: { tenantId, id },
      select: {
        title: true,
        description: true,
        dueAt: true,
        status: true,
        category: true,
        location: true,
        ownerId: true,
        leadId: true,
        lead,
        type: { select: { category: true, defaultDurationMins: true } },
      },
    });
    // A meeting: booked as an appointment, or of an appointment type (Meeting, Site visit, Demo).
    if (t && t.category !== 'APPOINTMENT' && t.type.category !== 'APPOINTMENT') return 'skip';
    if (!t || t.status === 'CANCELLED') return null;
    // At its due time, where the app's own calendar draws it and where a reschedule moves it.
    row = {
      ...t,
      text: t.description,
      startAt: t.dueAt,
      minutes: t.type.defaultDurationMins ?? 30,
      leadName: t.lead?.fullName,
    };
  } else {
    const v = await prisma.siteVisit.findFirst({
      where: { tenantId, id },
      select: {
        kind: true,
        status: true,
        scheduledAt: true,
        durationMin: true,
        address: true,
        notes: true,
        ownerId: true,
        leadId: true,
        lead,
        project: { select: { name: true } },
      },
    });
    if (!v || v.status === 'CANCELLED' || v.status === 'REJECTED') return null;
    const where = v.project?.name ?? v.address;
    row = {
      ...v,
      title: v.kind === 'CLIENT_MEETING' ? 'Client meeting' : `Site visit${where ? `: ${where}` : ''}`,
      text: v.notes,
      startAt: v.scheduledAt,
      minutes: v.durationMin,
      leadName: v.lead?.fullName,
      location: v.address ?? v.project?.name,
    };
  }

  const [tenant, owner] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, timezone: true } }),
    row.ownerId
      ? prisma.user.findFirst({ where: { tenantId, id: row.ownerId }, select: { email: true } })
      : Promise.resolve(null),
  ]);
  const leadPath = row.leadId && tenant ? entityRoute('lead', row.leadId, tenant.slug) : null;
  return {
    // Done stays on the calendar, marked: it happened.
    title: `${row.status === 'COMPLETED' ? 'Done: ' : ''}${row.title}${row.leadName ? ` — ${row.leadName}` : ''}`,
    // The lead's name and its page, never its numbers.
    description: [
      row.leadName && `Lead: ${row.leadName}`,
      leadPath && `${env.APP_URL.replace(/\/$/, '')}${leadPath}`,
      row.text,
    ]
      .filter(Boolean)
      .join('\n'),
    startAt: row.startAt,
    endAt: new Date(row.startAt.getTime() + row.minutes * 60_000),
    timezone: tenant?.timezone ?? 'Asia/Dubai',
    location: row.location ?? undefined,
    attendees: owner?.email ? [owner.email] : undefined,
  };
}
