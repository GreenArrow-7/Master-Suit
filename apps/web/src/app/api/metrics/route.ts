import { timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/db';
import { liveGrantCount } from '@/lib/auth/platform-access';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { increment, render, secretAgeDays, setBuildInfo, setGauge } from '@/lib/metrics';
import { QUEUE_NAMES } from '@/lib/queue';

export const dynamic = 'force-dynamic';

/**
 * Prometheus scrape target.
 *
 * ── Authentication ──────────────────────────────────────────────────────────
 *
 * Gated on `METRICS_TOKEN`, and **404s when that is unset** — the same shape as
 * `/api/v1/dev/outbox`, and for the same reason: an endpoint that is absent
 * cannot be probed for its response to a wrong credential.
 *
 * It needs a token rather than "it's internal, nobody can reach it", because
 * everything on this deployment is reached through one Caddy on one port. What
 * it exposes is not customer data, but it is a map: every route module and
 * action in the product, request volumes, error rates, queue names and depths.
 * That is reconnaissance, and it is free.
 *
 * ── Queue metrics are collected here, not pushed ────────────────────────────
 *
 * Depths and job ages are read from Redis at scrape time rather than
 * incremented by the code that enqueues. The reason is the failure this is meant
 * to catch: the worker container exited on start for months, and *nothing in the
 * web process would have known*. A counter the enqueue path maintains would have
 * looked perfectly healthy throughout — jobs were being enqueued, after all. Only
 * asking Redis "how many are waiting, how old is the oldest, and is anything
 * attached to this queue" shows a queue nobody is draining.
 *
 * `masterapp_queue_workers == 0` on a live queue is that alert, and
 * `masterapp_queue_oldest_waiting_seconds` rising monotonically is its slower,
 * surer cousin.
 */

/** Long enough that a scrape cannot hang the prober; short enough to be honest. */
const COLLECT_TIMEOUT_MS = 3_000;

function authorised(req: Request): boolean {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return false;
  const supplied = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // Length is compared first because timingSafeEqual throws on a mismatch; that
  // leaks the length and nothing else, which the header already does.
  return a.length === b.length && timingSafeEqual(a, b);
}

async function collectQueues(): Promise<void> {
  await Promise.all(
    QUEUE_NAMES.map(async (name) => {
      const queue = new Queue(name, { connection: redis });
      try {
        const [counts, workers, waiting] = await Promise.all([
          queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          queue.getWorkers(),
          // One job, the oldest waiting. Its age is the number that rises when a
          // queue has stopped being drained.
          queue.getJobs(['waiting'], 0, 0, true),
        ]);

        setGauge('masterapp_queue_depth', (counts.waiting ?? 0) + (counts.delayed ?? 0), { queue: name });
        setGauge('masterapp_queue_active', counts.active ?? 0, { queue: name });
        setGauge('masterapp_queue_failed', counts.failed ?? 0, { queue: name });
        setGauge('masterapp_queue_workers', workers.length, { queue: name });

        const oldest = waiting[0]?.timestamp;
        setGauge('masterapp_queue_oldest_waiting_seconds', oldest ? Math.max(0, (Date.now() - oldest) / 1000) : 0, {
          queue: name,
        });
      } finally {
        await queue.close().catch(() => {});
      }
    }),
  );
}

/**
 * Tables that grow with usage and are swept by nothing.
 *
 * `lib/jobs/retention.ts` covers recordings, webhook events, expired sessions,
 * attendance captures and soft-deleted rows. These three it does not touch, and
 * they are append-only: every permission check that writes an audit row, every
 * clock-in, every platform action. Section 18 of the assessment puts them at
 * roughly 1,000 organizations before partitioning is wanted.
 *
 * Whether they should be *deleted* is a compliance question rather than an
 * engineering one — audit trails are usually kept to a schedule somebody's
 * regulator sets — so this reports growth instead of assuming a policy. It makes
 * "when do we need to act" a graph rather than a guess.
 */
const UNBOUNDED_TABLES = ['AuditLog', 'HrAttendancePunch', 'PlatformAuditEvent', 'WebhookEvent', 'Recording'];

/**
 * Estimated rows, from the planner's own statistics.
 *
 * `reltuples` rather than `count(*)`: an exact count is a full scan of the
 * largest tables in the database, on every scrape, which would make the metrics
 * endpoint the heaviest query in the product. The estimate is refreshed by
 * autovacuum and is accurate to a few percent — far more precision than a growth
 * curve needs.
 */
async function collectTableSizes(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ table: string; rows: number; bytes: number }[]>(
    `SELECT c.relname                            AS table,
            GREATEST(c.reltuples, 0)::float8     AS rows,
            pg_total_relation_size(c.oid)::float8 AS bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`,
    UNBOUNDED_TABLES,
  );
  for (const row of rows) {
    setGauge('masterapp_table_rows_estimate', row.rows, { table: row.table });
    setGauge('masterapp_table_bytes', row.bytes, { table: row.table });
  }

  // Steady state is zero. Anything else means somebody on the platform team
  // currently has write access into a customer's workspace — which is legitimate
  // and time-boxed, and is still a thing an operator should be able to see
  // without reading an audit trail.
  setGauge('masterapp_platform_write_grants', await liveGrantCount());
}

/**
 * How old the face-service shared secret is, in days.
 *
 * The face sidecar's only authentication is one bearer token, and until
 * `apps/face/tokens.py` learned to accept an outgoing token alongside the
 * current one there was no way to change it without failing every check-in
 * mid-shift. The mechanism exists now; this is what makes anyone use it.
 *
 * Deliberately a metric rather than a timer. Rotating restarts the service
 * attendance depends on, twice, so it is an attended operation — but "attended"
 * degrades into "never" unless something notices. `FaceServiceTokenStale` is
 * that something.
 *
 * A deployment that has never rotated has no stamp, and is reported as the
 * threshold plus one rather than skipped: an absent series looks exactly like a
 * scrape that failed, and would leave the alert green forever on precisely the
 * deployments that need it most.
 */
function collectSecretAges(): void {
  const overdue = env.FACE_TOKEN_MAX_AGE_DAYS + 1;
  setGauge('masterapp_secret_age_days', secretAgeDays(env.FACE_SERVICE_TOKEN_ROTATED_AT, overdue), {
    secret: 'face_service_token',
  });
  // Published alongside it so the alert expression carries no hard-coded number
  // and a deployment that shortens its window is respected without editing the
  // rule file, which is mounted read-only.
  setGauge('masterapp_secret_max_age_days', env.FACE_TOKEN_MAX_AGE_DAYS, { secret: 'face_service_token' });
}

/**
 * How much of the database's connection budget is in use.
 *
 * This is the signal the PgBouncer overlay is the remedy for, and it did not
 * exist — so the decision to put a pooler in front of the database was a guess
 * either way. `infra/pgbouncer.ini` says plainly that a pooler is probably not
 * needed yet, and estimates the headroom at roughly a thousand organizations;
 * an estimate is what you use when you have no measurement.
 *
 * Read from `pg_stat_activity` at scrape time rather than counted by the pool,
 * for the reason the queue gauges are read from Redis: the application's own
 * view is of its own two pools, and the thing that runs out is Postgres's
 * `max_connections` — shared with migrations, `psql`, the backup job and
 * anything else on the host.
 *
 * The role is NOSUPERUSER, so `state` is NULL for backends belonging to other
 * roles. Those are counted under `unknown` rather than dropped: a connection
 * this process cannot classify still consumes a slot, and the total is what the
 * alert is about.
 */
async function collectConnections(): Promise<void> {
  const states = await prisma.$queryRawUnsafe<{ state: string | null; count: bigint }[]>(
    `SELECT state, count(*)::bigint AS count
       FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state`,
  );
  let total = 0;
  for (const row of states) {
    total += Number(row.count);
    setGauge('masterapp_db_connections', Number(row.count), { state: row.state ?? 'unknown' });
  }
  setGauge('masterapp_db_connections_total', total);

  const [limit] = await prisma.$queryRawUnsafe<{ setting: string }[]>(
    `SELECT setting FROM pg_settings WHERE name = 'max_connections'`,
  );
  // Published rather than hard-coded in the alert, so a deployment that raises
  // max_connections is respected without editing a rule file mounted read-only.
  setGauge('masterapp_db_connections_max', Number(limit?.setting ?? 0));
}

/**
 * The retention window on each append-only table, in days. Zero means none.
 *
 * These three tables grow monotonically and nothing deleted from them until the
 * sweep in lib/jobs/retention.ts learned to — but only when given a number, and
 * the number is a compliance answer nobody may pick on a deployment's behalf.
 * "Nobody has decided yet" is therefore a real and open state, and this is what
 * stops it being an invisible one.
 *
 * Zero is unambiguous here precisely because the schema sets a floor of 30: a
 * window of zero days cannot be configured, so zero can only mean unset.
 */
function collectRetentionWindows(): void {
  const windows: Record<string, number | undefined> = {
    AuditLog: env.AUDIT_LOG_RETENTION_DAYS,
    HrAttendancePunch: env.ATTENDANCE_PUNCH_RETENTION_DAYS,
    PlatformAuditEvent: env.PLATFORM_AUDIT_RETENTION_DAYS,
  };
  for (const [table, days] of Object.entries(windows)) {
    setGauge('masterapp_retention_window_days', days ?? 0, { table });
  }
}

export async function GET(req: Request) {
  if (!authorised(req)) return new Response(null, { status: 404 });

  // A scrape must never be the thing that takes the process down, and Redis
  // being unreachable is exactly when somebody is looking at this page. Report
  // what was gathered rather than failing the whole response.
  try {
    await Promise.race([
      Promise.all([collectQueues(), collectTableSizes(), collectConnections()]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('collect timed out')), COLLECT_TIMEOUT_MS)),
    ]);
  } catch (err) {
    logger.warn({ err }, 'metrics: collection failed');
    increment('masterapp_errors_total', {
      module: 'metrics',
      action: 'COLLECT',
      code: 'collect-failed',
      status: '0',
    });
  }

  // Always present, so a scrape returning no series is distinguishable from a
  // process that is down — which are the same empty body otherwise.
  // Read from configuration, not from the database or Redis, so it is published
  // even on the scrape where collection above timed out.
  collectSecretAges();
  collectRetentionWindows();

  setGauge('masterapp_up', 1);
  // And which commit is answering. The first question during an incident, and
  // one this deployment could not answer at all before.
  setBuildInfo();

  return new Response(render(), {
    status: 200,
    headers: {
      // The 0.0.4 text format, which is what every Prometheus-compatible scraper
      // negotiates by default.
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
