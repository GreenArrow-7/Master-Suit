/**
 * Scheduled report emails (audit row M16-16).
 *
 * A schedule names a report (and its grouping), a cadence and members of the
 * workspace to send it to. The maintenance sweep runs it as its creator, at
 * their scope today and only while they hold reports:EXPORT, over the period
 * the cadence covers, and mails the CSV the Export button would have given
 * them. Each send is audited as EXPORT_REQUESTED, as a download is.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ReportCadence } from '@prisma/client';
import { ctxForUser } from '@/lib/auth/session';
import { prisma, withPlatformTx } from '@/lib/db';
import { Invalid, NotFound } from '@/lib/errors';
import { shiftDay } from '@/lib/leads/followUpDue';
import { logger } from '@/lib/logger';
import { sendMail } from '@/lib/mailer';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';
import {
  nextMonth,
  PIVOT_KEYS,
  PIVOTS,
  REPORT_KEYS,
  reportFileName,
  runReport,
  toCsv,
  type Pivot,
  type ReportKey,
} from './reports';

export const scheduleBody = z
  .object({
    report: z.enum(REPORT_KEYS),
    by: z.enum(PIVOT_KEYS).optional(),
    cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
    recipients: z.array(z.string().trim().toLowerCase().email()).min(1).max(10),
  })
  .strict()
  .refine((v) => !v.by || (PIVOTS[v.report] ?? []).includes(v.by), {
    path: ['by'],
    message: 'This report cannot be grouped that way.',
  });

/**
 * 07:00 on the workspace's clock: yesterday's numbers are in before the day starts.
 * ponytail: midnight + 7 h, an hour off on a daylight-saving change day (the UAE has none).
 */
const sendAt = (day: string, zone: string) => new Date(dayBounds(day, zone).from.getTime() + 7 * 3_600_000);

/** The first send after `now`: every day, every Monday, or the 1st of each month, at 07:00. */
export function nextRunAt(cadence: ReportCadence, zone: string, now = new Date()): Date {
  const onOrAfter = (day: string) =>
    cadence === 'DAILY'
      ? day
      : cadence === 'WEEKLY'
        ? shiftDay(day, (8 - new Date(`${day}T12:00:00Z`).getUTCDay()) % 7)
        : day.endsWith('-01')
          ? day
          : `${nextMonth(day.slice(0, 7))}-01`;
  const day = onOrAfter(todayKey(zone, now));
  return sendAt(day, zone) > now ? sendAt(day, zone) : sendAt(onOrAfter(shiftDay(day, 1)), zone);
}

/** What a send at `at` covers, ending the day before: that day, the 7 days, or the month before. */
export function periodOf(cadence: ReportCadence, zone: string, at: Date) {
  const day = todayKey(zone, at);
  const last = shiftDay(day, -1);
  const first = cadence === 'DAILY' ? last : cadence === 'WEEKLY' ? shiftDay(day, -7) : `${last.slice(0, 7)}-01`;
  return { from: dayBounds(first, zone).from, to: dayBounds(last, zone).to };
}

/** The addresses among `emails` (lower-cased) that belong to active members of the workspace. */
async function memberEmails(tenantId: string, emails: string[]) {
  const users = await prisma.user.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      OR: emails.map((email) => ({ email: { equals: email, mode: 'insensitive' } })),
    },
    select: { email: true },
  });
  const members = new Set(users.map((u) => u.email.toLowerCase()));
  return emails.filter((email) => members.has(email));
}

const SCHEDULE = {
  id: true,
  reportKey: true,
  by: true,
  cadence: true,
  recipients: true,
  nextRunAt: true,
  lastRunAt: true,
} as const;
const shown = <T extends { reportKey: string }>({ reportKey, ...rest }: T) => ({ report: reportKey, ...rest });

/** The caller's own schedules: each runs at its creator's scope, so nobody manages another's. */
export async function listSchedules(ctx: Ctx) {
  const rows = await prisma.reportSchedule.findMany({
    where: { tenantId: ctx.tenantId, createdById: ctx.actor.id },
    orderBy: { createdAt: 'asc' },
    select: SCHEDULE,
  });
  return rows.map(shown);
}

export async function createSchedule(ctx: Ctx, body: z.infer<typeof scheduleBody>) {
  const recipients = [...new Set(body.recipients)];
  const members = await memberEmails(ctx.tenantId, recipients);
  const outside = recipients.filter((email) => !members.includes(email));
  // A report is the workspace's numbers: it goes to its people, never to an address typed in.
  if (outside.length > 0) {
    throw Invalid([
      {
        field: 'recipients',
        code: 'not_a_member',
        message: `Only active members of this workspace can receive reports: ${outside.join(', ')}.`,
      },
    ]);
  }
  const zone = await workspaceTimezone(ctx);
  const row = await prisma.reportSchedule.create({
    data: {
      tenantId: ctx.tenantId,
      reportKey: body.report,
      by: body.by ?? null,
      cadence: body.cadence,
      recipients,
      nextRunAt: nextRunAt(body.cadence, zone),
      createdById: ctx.actor.id,
    },
    select: SCHEDULE,
  });
  return shown(row);
}

export async function deleteSchedule(ctx: Ctx, id: string) {
  const { count } = await prisma.reportSchedule.deleteMany({
    where: { tenantId: ctx.tenantId, id, createdById: ctx.actor.id },
  });
  if (count === 0) throw NotFound('Schedule');
  return { id };
}

/** The maintenance sweep: every schedule due, across workspaces; `tenantIds` narrows it (tests). */
export async function runReportSchedules(now = new Date(), tenantIds?: string[]) {
  // ponytail: 200 a sweep, oldest first; the next quarter hour takes the rest.
  const due = await withPlatformTx(
    (tx) => tx.$queryRaw<{ id: string; tenantId: string }[]>`
      SELECT "id", "tenantId" FROM "ReportSchedule"
       WHERE "nextRunAt" <= ${now}
       ORDER BY "nextRunAt"
       LIMIT 200`,
  );
  let sent = 0;
  for (const row of due) {
    if (tenantIds && !tenantIds.includes(row.tenantId)) continue;
    try {
      if (await sendSchedule(row.tenantId, row.id, now)) sent += 1;
    } catch (err) {
      // One schedule's failure must not stop the rest; it is claimed, so it sends again next period.
      logger.error({ err, tenantId: row.tenantId, scheduleId: row.id }, 'scheduled report failed');
    }
  }
  return { due: due.length, sent };
}

async function sendSchedule(tenantId: string, id: string, now: Date) {
  const schedule = await prisma.reportSchedule.findFirst({ where: { tenantId, id, nextRunAt: { lte: now } } });
  if (!schedule) return false;
  const zone = await workspaceTimezone({ tenantId });
  // Claimed by moving nextRunAt on, only if it is still what was read: overlapping sweeps send once.
  const { count } = await prisma.reportSchedule.updateMany({
    where: { tenantId, id, nextRunAt: schedule.nextRunAt },
    data: { nextRunAt: nextRunAt(schedule.cadence, zone, now), lastRunAt: now },
  });
  if (count === 0) return false;

  // As its creator today: a schedule outlives neither their account nor their right to export.
  const ctx = await ctxForUser(schedule.createdById, tenantId, randomUUID()).catch(() => null);
  if (!ctx || !can(ctx, 'reports', 'EXPORT')) {
    logger.info({ tenantId, scheduleId: id }, 'scheduled report not sent: its creator may not export');
    return false;
  }
  const to = await memberEmails(tenantId, schedule.recipients);
  if (to.length === 0) return false;

  const key = schedule.reportKey as ReportKey;
  const by = (schedule.by ?? undefined) as Pivot | undefined;
  // The period the send was due for, so a late sweep still reports the right week.
  const range = periodOf(schedule.cadence, zone, schedule.nextRunAt);
  const report = await runReport(ctx, key, range, { by });
  const period = `${todayKey(zone, range.from)} to ${todayKey(zone, range.to)}`;
  const attachments = [
    { filename: reportFileName(key, by, range.to), content: toCsv(report), contentType: 'text/csv; charset=utf-8' },
  ];
  const body =
    `${report.title}, ${period}: ${report.rows.length} rows, attached as a CSV.\n\n` +
    `${ctx.actor.fullName} set this up to arrive ${schedule.cadence.toLowerCase()}; ` +
    'they can stop it under Reports → Scheduled emails.';
  for (const address of to) await sendMail(address, `${report.title}: ${period}`, body, { attachments });

  await audit(
    { tenantId, source: 'report-schedule' },
    {
      event: 'EXPORT_REQUESTED',
      objectType: 'report',
      recordId: key,
      metadata: {
        report: key,
        ...(by && { by }),
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        rows: report.rows.length,
        scheduleId: id,
        recipients: to.length,
        runAs: schedule.createdById,
      },
    },
  );
  return true;
}
