import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getCalendarProvider } from '@/lib/integrations/calendar';
import { connectionCredentials } from '@/lib/integrations/connection';

const createBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  eventType: z.enum(['ONLINE', 'PHYSICAL', 'HYBRID']).default('PHYSICAL'),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  timezone: z.string().max(60).default('Asia/Dubai'),
  hostId: z.string().cuid().optional(),
  location: z.string().max(300).optional(),
  address: z.string().max(500).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  meetingUrl: z.string().url().optional(),
  capacity: z.number().int().positive().optional(),
  campaignId: z.string().cuid().optional(),
  notes: z.string().max(2000).optional(),
}).strict().refine((d) => d.endAt > d.startAt, { message: 'endAt must be after startAt' });

export const POST = route(
  { module: 'events', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const event = await prisma.event.create({
      data: { tenantId: ctx.tenantId, createdById: ctx.actor.id, ...body },
    });

    // Online and hybrid events get a Google Calendar entry with a Meet link. A
    // physical event, an event that already carries a link, or a tenant with no
    // connected calendar is left alone — the organiser can still paste a URL.
    if (event.eventType === 'PHYSICAL' || event.meetingUrl) return event;
    const credentials = await connectionCredentials(ctx.tenantId, 'google');
    if (!credentials?.accessToken) return event;

    try {
      const created = await getCalendarProvider('google', credentials.accessToken).createEvent({
        title: event.title,
        description: event.description ?? undefined,
        startAt: event.startAt,
        endAt: event.endAt,
        timezone: event.timezone,
        location: event.location ?? undefined,
        createMeetLink: true,
      });
      return prisma.event.update({
        where: { id: event.id, tenantId: ctx.tenantId },
        data: {
          externalCalendarId: created.externalCalendarId,
          externalMeetId: created.externalMeetId ?? null,
          meetingUrl: created.meetingUrl ?? null,
        },
      });
    } catch (err) {
      // The event is already saved. Losing it because Google is unreachable would
      // be worse than returning it without a link the organiser can add by hand.
      logger.error({ err, eventId: event.id }, 'Google Meet provisioning failed');
      return event;
    }
  },
);

const listQuery = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
  upcoming: z.enum(['true', 'false']).optional(),
  campaignId: z.string().optional(),
}).strict();

export const GET = route(
  { module: 'events', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.upcoming === 'true') where.startAt = { gte: new Date() };
    if (query.campaignId) where.campaignId = query.campaignId;

    const data = await prisma.event.findMany({
      where,
      orderBy: { startAt: 'asc' },
      take: 100,
      include: { _count: { select: { invitees: true } } },
    });

    return { data };
  },
);
