import { timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { increment, render, setBuildInfo, setGauge } from '@/lib/metrics';
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

export async function GET(req: Request) {
  if (!authorised(req)) return new Response(null, { status: 404 });

  // A scrape must never be the thing that takes the process down, and Redis
  // being unreachable is exactly when somebody is looking at this page. Report
  // what was gathered rather than failing the whole response.
  try {
    await Promise.race([
      collectQueues(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('collect timed out')), COLLECT_TIMEOUT_MS)),
    ]);
  } catch (err) {
    logger.warn({ err }, 'metrics: queue collection failed');
    increment('masterapp_errors_total', {
      module: 'metrics',
      action: 'COLLECT',
      code: 'queue-unreachable',
      status: '0',
    });
  }

  // Always present, so a scrape returning no series is distinguishable from a
  // process that is down — which are the same empty body otherwise.
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
