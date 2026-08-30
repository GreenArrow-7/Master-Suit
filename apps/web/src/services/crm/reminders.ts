/**
 * The reminders nobody was being sent.
 *
 * `notifyCrm` covers the events that have a writer behind them — a lead created,
 * reassigned, moved a stage; a call missed or completed. Reminders have no
 * writer: the thing that makes a follow-up due at 3pm is 3pm arriving. Without a
 * sweep, a task with a due date was a row in a list that quietly went overdue,
 * which is most of what a CRM's bell is *for*.
 *
 * Runs on the `maintenance` queue beside the retention sweep, and spans tenants
 * the same way that one does: through `withPlatformTx`, which sets the
 * `app.platform_admin` flag the RLS policies name. A cross-tenant read through
 * the ordinary client matches zero rows and reports success — the exact bug
 * retention.ts documents at its top.
 *
 * ── Not double-sending ────────────────────────────────────────────────────
 *
 * The obvious design gives every reminded row a `remindedAt` column and a
 * migration. It does not need one: a notification *is* the record that somebody
 * was told, so the sweep asks whether one already exists for this recipient,
 * this kind and this record. That makes the job idempotent under retries,
 * overlapping runs and a changed schedule, with no new state to keep correct.
 */
import { withPlatformTx } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * How far ahead to look.
 *
 * Comfortably wider than the run interval, so a late or skipped run still
 * catches the window it missed rather than dropping those reminders on the
 * floor. The existence check above is what makes the overlap free.
 */
const LOOKAHEAD_MINUTES = 45;

/** Suppression window for the "already told them" check. */
const ALREADY_TOLD_HOURS = 24;

interface DueRow {
  tenantId: string;
  userId: string;
  recordId: string;
  objectType: string;
  title: string;
  body: string | null;
}

export interface ReminderSweepResult {
  followUps: number;
  calls: number;
}

/**
 * One pass. Returns what it wrote, so the worker log says something more useful
 * than "ok".
 */
export async function runReminderSweep(): Promise<ReminderSweepResult> {
  const [followUps, calls] = await Promise.all([sweepDueTasks(), sweepDueCallFollowUps()]);
  return { followUps, calls };
}

/**
 * Open tasks coming due, addressed to whoever owns them.
 *
 * The destination is the task's lead where it has one — "your follow-up on
 * Marco Haddad is due" is only actionable if it opens Marco Haddad. Tasks with
 * no lead point at the task list, which is the best that exists: there is no
 * task detail screen.
 */
async function sweepDueTasks(): Promise<number> {
  const rows = await withPlatformTx((tx) =>
    tx.$queryRawUnsafe<DueRow[]>(
      `SELECT t."tenantId",
              t."ownerId"                                   AS "userId",
              COALESCE(t."leadId", t.id)                    AS "recordId",
              CASE WHEN t."leadId" IS NULL THEN 'tasks' ELSE 'lead' END AS "objectType",
              t.title,
              l."fullName"                                  AS body
         FROM "Task" t
         LEFT JOIN "Lead" l
                ON l.id = t."leadId" AND l."tenantId" = t."tenantId" AND l."deletedAt" IS NULL
        WHERE t.status = 'OPEN'
          AND t."deletedAt" IS NULL
          AND t."ownerId" IS NOT NULL
          AND t."dueAt" >= now()
          AND t."dueAt" < now() + ($1 || ' minutes')::interval
          AND NOT EXISTS (
                SELECT 1 FROM "Notification" n
                 WHERE n."tenantId" = t."tenantId"
                   AND n."userId"   = t."ownerId"
                   AND n.kind       = 'follow_up.due'
                   AND n."recordId" = COALESCE(t."leadId", t.id)
                   AND n."createdAt" > now() - ($2 || ' hours')::interval)
        LIMIT 500`,
      String(LOOKAHEAD_MINUTES),
      String(ALREADY_TOLD_HOURS),
    ),
  );

  return writeReminders(rows, 'follow_up.due', (row) => ({
    title: row.title,
    body: row.body ? `Due soon · ${row.body}` : 'Due soon',
  }));
}

/**
 * Calls with a follow-up time arriving.
 *
 * `Call.followUpAt` is the only forward-looking timestamp the model carries —
 * there is no `scheduledAt` — so this is what "call reminder" can honestly mean
 * today. It points at the lead for the same reason the task sweep does.
 */
async function sweepDueCallFollowUps(): Promise<number> {
  const rows = await withPlatformTx((tx) =>
    tx.$queryRawUnsafe<DueRow[]>(
      `SELECT c."tenantId",
              COALESCE(l."ownerId", c."callerId")           AS "userId",
              COALESCE(c."leadId", c.id)                    AS "recordId",
              CASE WHEN c."leadId" IS NULL THEN 'call' ELSE 'lead' END AS "objectType",
              c."recipientNumber"                           AS title,
              l."fullName"                                  AS body
         FROM "Call" c
         LEFT JOIN "Lead" l
                ON l.id = c."leadId" AND l."tenantId" = c."tenantId" AND l."deletedAt" IS NULL
        WHERE c."deletedAt" IS NULL
          AND c."followUpAt" IS NOT NULL
          AND c."followUpAt" >= now()
          AND c."followUpAt" < now() + ($1 || ' minutes')::interval
          AND COALESCE(l."ownerId", c."callerId") IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM "Notification" n
                 WHERE n."tenantId" = c."tenantId"
                   AND n."userId"   = COALESCE(l."ownerId", c."callerId")
                   AND n.kind       = 'call.reminder'
                   AND n."recordId" = COALESCE(c."leadId", c.id)
                   AND n."createdAt" > now() - ($2 || ' hours')::interval)
        LIMIT 500`,
      String(LOOKAHEAD_MINUTES),
      String(ALREADY_TOLD_HOURS),
    ),
  );

  return writeReminders(rows, 'call.reminder', (row) => ({
    title: `Call follow-up due: ${row.body ?? row.title}`,
    body: row.body ? row.title : null,
  }));
}

/**
 * Written through Prisma rather than as part of the SELECT above.
 *
 * An `INSERT … SELECT` would be one round trip, but `Notification.id` defaults to
 * a cuid generated in the client, so the SQL would have to mint ids of a
 * different shape than every other row in the table. One extra statement is
 * cheaper than two id formats.
 */
async function writeReminders(
  rows: DueRow[],
  kind: string,
  render: (row: DueRow) => { title: string; body: string | null },
): Promise<number> {
  if (!rows.length) return 0;

  await withPlatformTx((tx) =>
    tx.notification.createMany({
      data: rows.map((row) => {
        const { title, body } = render(row);
        return {
          tenantId: row.tenantId,
          userId: row.userId,
          kind,
          title,
          body,
          objectType: row.objectType,
          recordId: row.recordId,
          priority: 'HIGH' as const,
          channels: ['in_app'],
        };
      }),
    }),
  );

  logger.info({ kind, count: rows.length }, 'reminder sweep wrote notifications');
  return rows.length;
}
