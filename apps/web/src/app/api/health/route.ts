import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

/**
 * Readiness: should a load balancer route traffic to this instance?
 *
 * Checks the two dependencies without which no request can be served — the
 * database and Redis — each under a short deadline, so a probe cannot hang
 * longer than the prober's own timeout and a wedged dependency reads as "not
 * ready" rather than as a stalled probe. Answers are yes/no per dependency:
 * never versions, hosts or connection strings, because this endpoint is
 * unauthenticated by design (the prober has no session).
 *
 * Liveness — "is the process alive at all" — is /api/health/live, which touches
 * nothing. Wiring THIS endpoint into a restart-on-fail healthcheck would
 * restart healthy processes whenever the database blinks; point restart probes
 * at /live and routing probes here.
 */
export async function GET() {
  const deadline = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  const checks: Record<string, 'up' | 'down'> = { database: 'down', redis: 'down' };

  await Promise.allSettled([
    Promise.race([prisma.$queryRaw`SELECT 1`, deadline(2_000)]).then(() => {
      checks.database = 'up';
    }),
    Promise.race([redis.ping(), deadline(2_000)]).then(() => {
      checks.redis = 'up';
    }),
  ]);

  const ready = Object.values(checks).every((v) => v === 'up');
  return NextResponse.json(
    { status: ready ? 'ok' : 'degraded', checks },
    { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
