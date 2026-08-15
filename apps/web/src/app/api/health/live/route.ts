import { NextResponse } from 'next/server';

/**
 * Liveness: is this process alive enough to answer HTTP at all?
 *
 * Deliberately touches nothing — no database, no Redis. A liveness probe that
 * checks dependencies teaches the orchestrator to kill healthy processes during
 * a database blip, turning a partial outage into a total one and a restart
 * storm. "Should this process be restarted" and "should traffic be routed here"
 * are different questions; the second one is /api/health (readiness).
 */
export function GET() {
  return NextResponse.json({ status: 'alive' });
}
