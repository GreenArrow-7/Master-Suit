/**
 * The workspace's calendars, whichever provider: Google (M8-08) and Microsoft
 * 365 (M8-09). What each CRM meeting wants on them, queueing it after the write
 * commits, the `calendar-sync` job, the sweep that re-drives what failed, and a
 * live access token. The providers differ only in their entry in `CALENDARS`.
 *
 * One calendar per workspace and provider (`IntegrationConnection` per tenant
 * and provider); a workspace with both connected has each meeting on both, with
 * the record's owner as a guest. A write never waits on a provider: the route
 * commits, then `queueCalendarSync` queues one job per connected provider; the
 * job reads the record as it now stands and writes, moves or removes its event.
 * A provider down fails the job (retried by the queue, the reason on its
 * Integrations card), never the follow-up.
 *
 * A record whose sync failed, or that changed while the connection was not
 * CONNECTED, stays pending (a Redis set per workspace and provider) until a
 * sync of it succeeds: the maintenance sweep re-queues it every quarter hour,
 * and the card keeps its error until nothing is pending.
 */
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { redis } from '@/lib/redis';
import { decryptCredentials, wrapCredentials } from '@/lib/integrations/connection';
import {
  googleOAuthConfigured,
  googleToken,
  microsoftOAuthConfigured,
  microsoftToken,
  type CalendarEvent,
  type OAuthTokens,
} from '@/lib/integrations/calendar';
import { FOLLOW_UP_KIND_LABELS, type FollowUpKind } from '@/lib/leads/followUpDue';
import { entityRoute } from '@/lib/nav/entityRoute';
import type { OAuthState } from '@/services/meta/oauth';
import { beginGoogleOAuth, consumeGoogleOAuthState, googleRedirectUri, writeGoogleEvent } from './googleCalendar';
import {
  beginMicrosoftOAuth,
  consumeMicrosoftOAuthState,
  microsoftRedirectUri,
  writeMicrosoftEvent,
  type MicrosoftOAuthState,
} from './microsoftCalendar';

export type CalendarRecord = 'followUp' | 'task' | 'visit';

/** Each provider: connecting it (the connect and callback routes), its tokens, and writing an event. */
export const CALENDARS = {
  google: {
    label: 'Google Calendar',
    vendor: 'Google',
    configured: googleOAuthConfigured,
    begin: beginGoogleOAuth,
    consume: consumeGoogleOAuthState,
    redirectUri: googleRedirectUri,
    exchange: (code: string) => googleToken({ code, redirectUri: googleRedirectUri() }),
    refresh: (refreshToken: string) => googleToken({ refreshToken }),
    write: writeGoogleEvent,
  },
  microsoft: {
    label: 'Microsoft 365',
    vendor: 'Microsoft',
    configured: microsoftOAuthConfigured,
    begin: beginMicrosoftOAuth,
    consume: consumeMicrosoftOAuthState,
    redirectUri: microsoftRedirectUri,
    exchange: (code: string, state: OAuthState) =>
      microsoftToken({ code, redirectUri: microsoftRedirectUri(), verifier: (state as MicrosoftOAuthState).verifier }),
    refresh: (refreshToken: string) => microsoftToken({ refreshToken }),
    write: writeMicrosoftEvent,
  },
} satisfies Record<
  string,
  {
    label: string;
    vendor: string;
    configured: () => boolean;
    begin: (state: OAuthState) => Promise<string>;
    consume: (handle: string) => Promise<OAuthState | null>;
    redirectUri: () => string;
    exchange: (code: string, state: OAuthState) => Promise<OAuthTokens>;
    refresh: (refreshToken: string) => Promise<OAuthTokens>;
    write: (
      token: string,
      record: SyncTarget,
      entry: CalendarEvent | null,
      settings: Record<string, unknown>,
    ) => Promise<void>;
  }
>;

export type CalendarProvider = keyof typeof CALENDARS;
export const CALENDAR_PROVIDERS = Object.keys(CALENDARS) as CalendarProvider[];
export const isCalendarProvider = (key: string): key is CalendarProvider => key in CALENDARS;

interface SyncTarget {
  tenantId: string;
  kind: CalendarRecord;
  id: string;
}

/**
 * A live access token for the workspace's calendar at `provider`, or null when
 * none is connected. A connection made through the consent screen is refreshed
 * with the deployment's OAuth client once its hour is up, kept encrypted;
 * Microsoft's new refresh token replaces the old.
 */
export async function calendarAccessToken(tenantId: string, provider: CalendarProvider): Promise<string | null> {
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    select: { status: true, credentials: true, expiresAt: true },
  });
  if (!conn || conn.status !== 'CONNECTED') return null;
  const credentials = decryptCredentials((conn.credentials ?? {}) as Record<string, unknown>);
  const stale = !conn.expiresAt || conn.expiresAt.getTime() < Date.now() + 60_000;
  const calendar = CALENDARS[provider];
  if (!stale || !credentials.refreshToken || !calendar.configured()) return credentials.accessToken || null;

  const fresh = await calendar.refresh(credentials.refreshToken);
  await prisma.integrationConnection.updateMany({
    where: { tenantId, provider },
    data: {
      credentials: wrapCredentials({
        ...credentials,
        accessToken: fresh.accessToken,
        ...(fresh.refreshToken && { refreshToken: fresh.refreshToken }),
      }),
      expiresAt: fresh.expiresAt,
    },
  });
  return fresh.accessToken;
}

// ── Keeping the calendars ────────────────────────────────────────────────────

/** Follow-ups on the calendar unless the connection says every one (`syncAllFollowUps`). */
const CALENDAR_KINDS: readonly string[] = ['MEETING', 'SITE_VISIT'];

/**
 * After the write commits: each record's event follows it, on every calendar
 * the workspace has connected. Never throwing — the CRM write has already
 * happened and must not be reported as failed.
 */
export async function queueCalendarSync(
  tenantId: string,
  kind: CalendarRecord,
  ...ids: (string | null | undefined)[]
): Promise<void> {
  try {
    const wanted = ids.filter((id): id is string => !!id);
    if (!wanted.length) return;
    const connections = await prisma.integrationConnection.findMany({
      where: { tenantId, provider: { in: CALENDAR_PROVIDERS } },
      select: { provider: true, status: true },
    });
    for (const { provider, status } of connections) {
      // In ERROR (a failed Test connection) or unverified: kept for when it is connected again.
      if (status !== 'CONNECTED') {
        await markPending(
          provider,
          tenantId,
          wanted.map((id) => `${kind}:${id}`),
        );
        continue;
      }
      // `fresh`: a second change to the record is a second sync, not the first one's id.
      for (const id of wanted) {
        await enqueue('calendar', 'calendar-sync', { tenantId, kind, id, provider }, { fresh: true });
      }
    }
  } catch (err) {
    logger.warn({ err, tenantId, kind }, 'calendar sync not queued');
  }
}

/** Workspaces with records pending, per provider (Google's keys are the ones M8-08 used). */
const pendingTenants = (provider: string) => `${provider}:calendar:pending`;
/** `{kind}:{id}` of the workspace's records whose event is not yet as the record stands. */
const pendingOf = (provider: string, tenantId: string) => `${pendingTenants(provider)}:${tenantId}`;

async function markPending(provider: string, tenantId: string, members: string[]) {
  await redis.sadd(pendingOf(provider, tenantId), ...members);
  await redis.sadd(pendingTenants(provider), tenantId);
}

/**
 * The maintenance sweep: every pending record of a workspace whose calendar is
 * CONNECTED, queued again. A disconnected workspace's are dropped (its row is
 * gone, and so is the calendar to keep in step). `tenantIds` limits it, for tests.
 */
export async function retryPendingCalendarSyncs(tenantIds?: string[]) {
  let queued = 0;
  for (const provider of CALENDAR_PROVIDERS) {
    for (const tenantId of tenantIds ?? (await redis.smembers(pendingTenants(provider)))) {
      const members = await redis.smembers(pendingOf(provider, tenantId));
      const conn = members.length
        ? await prisma.integrationConnection.findFirst({ where: { tenantId, provider }, select: { status: true } })
        : null;
      if (!conn) {
        await redis.del(pendingOf(provider, tenantId));
        await redis.srem(pendingTenants(provider), tenantId);
        continue;
      }
      if (conn.status !== 'CONNECTED') continue;
      // ponytail: a record the provider refuses for good (a 400) is retried every sweep, its reason on the card; add a give-up count if that ever piles up.
      for (const member of members) {
        const [kind, id] = member.split(':');
        await enqueue('calendar', 'calendar-sync', { tenantId, kind, id, provider }, { fresh: true });
        queued += 1;
      }
    }
  }
  return { queued };
}

/**
 * The queue's job: the record's event, at one provider, as the record now
 * stands. A job queued before M8-09 names no provider: it was Google's.
 */
export async function syncCalendarEntry({
  tenantId,
  kind,
  id,
  provider = 'google',
}: SyncTarget & { provider?: CalendarProvider }) {
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    select: { status: true, metadata: true },
  });
  const member = `${kind}:${id}`;
  if (conn?.status !== 'CONNECTED') {
    if (conn) await markPending(provider, tenantId, [member]);
    return { skipped: 'not connected' as const };
  }
  const settings = (conn.metadata ?? {}) as Record<string, unknown>;
  const entry = await calendarEntry(tenantId, kind, id, settings.syncAllFollowUps === true);
  if (entry === 'skip') {
    // Nothing for the calendar to hold (the switch went off since): nothing pending either.
    await redis.srem(pendingOf(provider, tenantId), member);
    return { skipped: 'not a calendar entry' as const };
  }

  const where = { tenantId, provider };
  try {
    const token = await calendarAccessToken(tenantId, provider);
    if (!token) return { skipped: 'not connected' as const };
    await CALENDARS[provider].write(token, { tenantId, kind, id }, entry, settings);
    await redis.srem(pendingOf(provider, tenantId), member);
    // The card's error stays while another record is still waiting for its sync.
    const waiting = await redis.scard(pendingOf(provider, tenantId));
    await prisma.integrationConnection.updateMany({
      where,
      data: { lastSyncAt: new Date(), ...(waiting ? {} : { errorMessage: null }) },
    });
    return { synced: entry ? ('saved' as const) : ('removed' as const) };
  } catch (err) {
    // On the Integrations card, pending for the sweep, and thrown so the queue tries again.
    const message = `Calendar sync failed: ${(err as Error).message}`.slice(0, 300);
    await markPending(provider, tenantId, [member]).catch(() => undefined);
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
    // Only an account still working here: a suspended or deactivated owner is never invited again.
    row.ownerId
      ? prisma.user.findFirst({
          where: { tenantId, id: row.ownerId, status: 'ACTIVE' },
          select: { email: true },
        })
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
