import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';

/** Referenced by the Dockerfile HEALTHCHECK. Unauthenticated by design, and it
 *  reports only liveness — never version numbers or connection strings. */
export async function GET() {
  const checks: Record<string, 'up' | 'down'> = { database: 'down', redis: 'down' };

  await prisma.$queryRaw`SELECT 1`.then(() => { checks.database = 'up'; }).catch(() => {});
  await redis.ping().then(() => { checks.redis = 'up'; }).catch(() => {});

  const healthy = Object.values(checks).every((v) => v === 'up');
  return NextResponse.json({ status: healthy ? 'ok' : 'degraded', checks }, { status: healthy ? 200 : 503 });
}
