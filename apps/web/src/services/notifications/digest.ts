/**
 * The morning summary (audit M8-04, M17-04): one email to each person who chose
 * it (Profile → Notifications), listing their follow-ups overdue and due today
 * and the leads given to them since the last one. Choosing it stops the email
 * copy of each notification (workers/notifications.ts); the bell and the phone
 * are unchanged.
 *
 * Runs hourly on the maintenance queue and sends from 08:00 on the workspace's
 * clock, once a day, only in a workspace with a lead product. `User.digestSentAt`
 * is claimed by a conditional update before the lists are read, so two
 * overlapping runs send one, and is handed back when anything after the claim
 * fails, so the next hour tries again. Nothing to say, no email.
 *
 * The lists name leads, never their numbers, as every notification does, and
 * only the leads the reader may still open (`leadsInScope`, the Follow-ups
 * page's rule): a follow-up can outlive its lead's hand-over or deletion.
 * "Given to you" is a hand-over by someone else (LeadAssignmentHistory), never
 * a lead the reader made or imported for themselves.
 *
 * ponytail: one morning hour for every workspace; a setting when one asks for another.
 */
import { randomUUID } from 'node:crypto';
import { mergeWhere } from '@/lib/api/where';
import { ctxForUser } from '@/lib/auth/session';
import { prisma, withPlatformTx } from '@/lib/db';
import { env } from '@/lib/env';
import { followUpDueWhere, OPEN_FOLLOW_UP } from '@/lib/leads/followUpDue';
import { logger } from '@/lib/logger';
import { sendMail } from '@/lib/mailer';
import { entityRoute } from '@/lib/nav/entityRoute';
import { hasAnyModuleEntitlement, LEAD_MODULES } from '@/lib/security/entitlements';
import { leadsInScope } from '@/lib/security/record-scope';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';

const DIGEST_HOUR = 8;
/** Lines per list; the heading carries the full count. */
const LIST_MAX = 20;

interface Reader {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  digestSentAt: Date | null;
  slug: string;
  timezone: string;
}

/** One pass. `tenantId` limits it to one workspace, for a test sharing the database. */
export async function runDigestSweep(now = new Date(), tenantId?: string): Promise<{ sent: number }> {
  // Across workspaces, so through the platform flag RLS names, as the reminder sweep does.
  const readers = await withPlatformTx(
    (tx) => tx.$queryRaw<Reader[]>`
      SELECT u.id, u."tenantId", u.email, u."fullName", u."digestSentAt", t.slug, t.timezone
        FROM "User" u
        JOIN "Tenant" t ON t.id = u."tenantId"
       WHERE u.status = 'ACTIVE' AND u."deletedAt" IS NULL
         AND t.status = 'ACTIVE' AND t."deletedAt" IS NULL
         AND u."notificationPrefs"->>'email' = 'true'
         AND u."notificationPrefs"->>'digest' = 'true'
         AND (${tenantId ?? null}::text IS NULL OR u."tenantId" = ${tenantId ?? null})`,
  );
  let sent = 0;
  // Every lead route refuses a workspace without a lead product; its mail stops too.
  const leadProduct = new Map<string, Promise<boolean>>();
  for (const reader of readers) {
    // One person's failure (a bad time zone, a lost connection) is not everyone's.
    try {
      if (!leadProduct.has(reader.tenantId)) {
        leadProduct.set(reader.tenantId, hasAnyModuleEntitlement(reader.tenantId, LEAD_MODULES));
      }
      if (!(await leadProduct.get(reader.tenantId))) continue;
      if (await sendDigest(reader, now)) sent += 1;
    } catch (err) {
      logger.warn({ err, tenantId: reader.tenantId, userId: reader.id }, 'morning summary skipped');
    }
  }
  if (sent) logger.info({ sent }, 'morning summaries sent');
  return { sent };
}

async function sendDigest(reader: Reader, now: Date): Promise<boolean> {
  const { tenantId, id } = reader;
  const zone = reader.timezone || 'Asia/Dubai';
  const today = dayBounds(todayKey(zone, now), zone);
  const morning = new Date(today.from.getTime() + DIGEST_HOUR * 3_600_000);
  if (now < morning || (reader.digestSentAt && reader.digestSentAt >= morning)) return false;

  const { count } = await prisma.user.updateMany({
    where: { tenantId, id, OR: [{ digestSentAt: null }, { digestSentAt: { lt: morning } }] },
    data: { digestSentAt: now },
  });
  if (!count) return false;
  try {
    return await compose(reader, now, zone);
  } catch (err) {
    await prisma.user.updateMany({
      where: { tenantId, id, digestSentAt: now },
      data: { digestSentAt: reader.digestSentAt },
    });
    logger.warn({ err, tenantId, userId: id }, 'morning summary failed; the next run tries again');
    return false;
  }
}

/** The lists and the mail, once today's claim is held. Throws to hand it back. */
async function compose(reader: Reader, now: Date, zone: string): Promise<boolean> {
  const { tenantId, id } = reader;
  const since = reader.digestSentAt ?? new Date(now.getTime() - 86_400_000);
  const followUps = (due: 'overdue' | 'today') => {
    // As the Follow-ups list counts them (view=mine): overdue is before today began.
    const where = mergeWhere({ tenantId, ownerId: id }, OPEN_FOLLOW_UP, followUpDueWhere({ due }, zone, now));
    return Promise.all([
      prisma.followUpTask.findMany({
        where,
        orderBy: { dueAt: 'asc' },
        take: LIST_MAX,
        select: { title: true, dueAt: true, leadId: true },
      }),
      prisma.followUpTask.count({ where }),
    ]);
  };
  // Still theirs, and handed to them by someone else (or a rule) since the last one.
  const leadsWhere = {
    tenantId,
    ownerId: id,
    assignments: {
      some: {
        toOwnerId: id,
        createdAt: { gt: since, lte: now },
        OR: [{ assignedById: null }, { assignedById: { not: id } }],
      },
    },
  };
  const [[overdue, overdueCount], [dueToday, todayCount], leads, leadCount] = await Promise.all([
    followUps('overdue'),
    followUps('today'),
    prisma.lead.findMany({
      where: leadsWhere,
      orderBy: { assignedAt: 'desc' },
      take: LIST_MAX,
      select: { fullName: true, reference: true },
    }),
    prisma.lead.count({ where: leadsWhere }),
  ]);
  if (!overdueCount && !todayCount && !leadCount) return false;
  const named = await leadsInScope(
    await ctxForUser(id, tenantId, randomUUID()),
    [...overdue, ...dueToday].map((f) => f.leadId),
  );

  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const followUpLine = (f: (typeof overdue)[number]) =>
    `- ${[f.title, f.leadId && named.get(f.leadId)?.fullName, time.format(f.dueAt)].filter(Boolean).join(' · ')}`;
  const section = (heading: string, total: number, lines: string[]) =>
    total
      ? [`${heading} (${total})`, ...lines, ...(total > lines.length ? [`- and ${total - lines.length} more`] : []), '']
      : [];
  const base = env.APP_URL.replace(/\/$/, '');
  const text = [
    `Good morning ${reader.fullName},`,
    '',
    ...section('Overdue follow-ups', overdueCount, overdue.map(followUpLine)),
    ...section('Follow-ups due today', todayCount, dueToday.map(followUpLine)),
    ...section(
      'Leads given to you since your last summary',
      leadCount,
      leads.map((lead) => `- ${lead.fullName} (${lead.reference})`),
    ),
    `Your follow-ups: ${base}${entityRoute('follow_ups', null, reader.slug)}`,
    `Change what you receive: ${base}/${reader.slug}/profile/notifications`,
  ].join('\n');
  const subject = `Your day: ${[
    overdueCount && `${overdueCount} overdue`,
    todayCount && `${todayCount} due today`,
    leadCount && `${leadCount} new lead${leadCount === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(', ')}`;

  await sendMail(reader.email, subject, text);
  return true;
}
