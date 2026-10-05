import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/platform';

import { runRetentionCleanup } from '@/lib/jobs/retention';
import { readJsonBody } from '@/lib/api/read-body';
import { bareRoute } from '@/lib/api/handler';

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
export const POST = bareRoute('/api/v1/admin/retention', async (req, requestId) => {
  await requirePlatformOwner(req, requestId);
  const { dryRun } = await readJsonBody(req, body).catch(() => ({ dryRun: true }));
  const result = await runRetentionCleanup(dryRun);
  return NextResponse.json(result);
});
