import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { env } from '@/lib/env';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import { queueHealth } from '@/lib/workerHeartbeat';
import { QUEUE_NAMES } from '@/lib/queue';

export const dynamic = 'force-dynamic';

/**
 * Every row is measured. The previous version reported a hardcoded "Healthy"
 * for the web app, authentication, the HRMS datastore and the public URL — an
 * operator looking at this page during an outage would have been told
 * everything was fine, which is worse than having no page at all.
 */
type Probe = { component: string; status: string; detail: string };

/**
 * A probe must fail fast. The Redis client retries a refused connection
 * indefinitely, so an un-bounded `ping()` never rejects and the page hangs for
 * the whole request — a health page that stops responding during an outage is
 * the same failure as one that lies about it.
 */
const PROBE_TIMEOUT_MS = 2_000;

class ProbeTimeout extends Error {}

async function timed(fn: () => Promise<string>): Promise<{ detail: string; ok: boolean; ms: number }> {
  const started = Date.now();
  try {
    const detail = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new ProbeTimeout()), PROBE_TIMEOUT_MS)),
    ]);
    return { detail, ok: true, ms: Date.now() - started };
  } catch (err) {
    // Never the message: it can carry a connection string, and that carries a
    // password.
    const detail =
      err instanceof ProbeTimeout
        ? `no response within ${PROBE_TIMEOUT_MS} ms`
        : err instanceof Error
          ? err.name
          : 'unknown error';
    return { detail, ok: false, ms: Date.now() - started };
  }
}

export default async function Page() {
  const [db, cache] = await Promise.all([
    timed(async () => `${await prisma.tenant.count({ where: { deletedAt: null } })} workspaces`),
    timed(async () => {
      await redis.ping();
      return 'PING acknowledged';
    }),
  ]);

  /**
   * Queue consumers, from the persisted heartbeat rather than a live query.
   *
   * `queueHasWorkers` would answer "is anything attached right now", which reads
   * the same for a queue nobody has ever run and one whose worker died an hour
   * ago. This board exists for the second case — the worker that was dead in
   * production for months — so it wants the distinction, and the timestamp.
   */
  const queues = await queueHealth(QUEUE_NAMES).catch(() => []);

  const probes: Probe[] = [
    {
      component: 'PostgreSQL',
      status: db.ok ? 'Healthy' : 'Unavailable',
      detail: `${db.detail} · ${db.ms} ms`,
    },
    {
      component: 'Redis',
      status: cache.ok ? 'Healthy' : 'Unavailable',
      detail: `${cache.detail} · ${cache.ms} ms`,
    },
    {
      // Reached only because this request was served, so it is a fact, not a claim.
      component: 'Web application',
      status: 'Healthy',
      detail: `Next.js server responding · ${env.NODE_ENV}`,
    },
    {
      component: 'Public URL',
      status: 'Configured',
      detail: env.APP_URL,
    },
    ...queues.map((queue) => ({
      component: `Worker · ${queue.queue}`,
      status:
        queue.state === 'LIVE'
          ? ('Healthy' as const)
          : queue.state === 'STALE'
            ? ('Unavailable' as const)
            : ('Configured' as const),
      detail:
        queue.state === 'LIVE'
          ? `${queue.instances} consumer${queue.instances === 1 ? '' : 's'} · last beat ${queue.lastSeenAt?.toISOString() ?? 'unknown'}`
          : queue.state === 'STALE'
            ? // The sentence a person can act on: it ran, and it stopped.
              `No consumer. Last seen ${queue.lastSeenAt?.toISOString() ?? 'unknown'}`
            : 'No consumer has ever reported — is the worker process deployed?',
    })),
  ];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1>System health</h1>
      <WorkspaceTable
        headers={['Component', 'Status', 'Detail']}
        rows={probes.map((probe) => [probe.component, probe.status, probe.detail])}
      />
    </div>
  );
}
