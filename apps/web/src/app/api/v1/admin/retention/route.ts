import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { runRetentionCleanup } from '@/lib/jobs/retention';
import { readJsonBody } from '@/lib/api/read-body';

const body = z.object({ dryRun: z.boolean().default(true) }).strict();

/**
 * Data-retention cleanup is a PLATFORM-WIDE maintenance sweep: it deletes across
 * every tenant (expired recordings, old webhook events, 90-day soft-deletes,
 * expired biometric captures) with no tenant filter, by design. It therefore
 * lives on the control plane behind `requirePlatformOwner`, not on a workspace
 * permission. It used to be a kernel route gated by `system:MANAGE_CONFIGURATION`
 * — a permission that is never seeded, so it returned 403 today, but the moment
 * that permission was granted to any workspace admin it would have handed a
 * single tenant an all-tenant delete. Owner-only closes that latent hole.
 */
export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    await requirePlatformOwner(req, requestId);
    const { dryRun } = await readJsonBody(req, body).catch(() => ({ dryRun: true }));
    const result = await runRetentionCleanup(dryRun);
    return NextResponse.json(result, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(err.toProblem(requestId), {
        status: err.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err, requestId }, 'retention cleanup failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
