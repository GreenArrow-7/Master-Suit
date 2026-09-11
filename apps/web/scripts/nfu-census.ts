/** Read-only census. Nothing here writes. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.NFU_DATABASE_URL ?? process.env.DATABASE_URL }) });
  const rows = await db.$queryRawUnsafe<any[]>(`
    SELECT
      (SELECT count(*) FROM "Lead" WHERE "deletedAt" IS NULL)                       AS leads,
      (SELECT count(*) FROM "Lead" WHERE "nextFollowUpAt" IS NOT NULL AND "deletedAt" IS NULL) AS lead_with_value,
      (SELECT count(*) FROM "Task" WHERE "deletedAt" IS NULL)                        AS tasks,
      (SELECT count(*) FROM "Task" WHERE "deletedAt" IS NULL AND status IN ('OPEN','IN_PROGRESS','RESCHEDULED')) AS tasks_open,
      (SELECT count(*) FROM "Task" WHERE "leadId" IS NULL)                           AS tasks_no_lead,
      (SELECT count(*) FROM "FollowUpTask" WHERE "deletedAt" IS NULL)                AS fut,
      (SELECT count(*) FROM "FollowUpTask" WHERE "deletedAt" IS NULL AND status IN ('OPEN','IN_PROGRESS','RESCHEDULED')) AS fut_open,
      (SELECT count(*) FROM "FollowUpTask" WHERE "leadId" IS NULL)                   AS fut_no_lead,
      (SELECT count(*) FROM "FollowUpTask" f WHERE f."leadId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l.id = f."leadId"))           AS fut_orphan,
      (SELECT count(*) FROM "Task" t WHERE t."leadId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l.id = t."leadId"))           AS task_orphan
  `);
  console.log(JSON.stringify(rows[0], (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  await db.$disconnect();
}
main();
