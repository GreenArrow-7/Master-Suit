import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import {
  DEFAULT_COVERAGE_MINUTES,
  DEFAULT_READ_GRANT_MINUTES,
  MAX_COVERAGE_MINUTES,
  MAX_READ_GRANT_MINUTES,
  MIN_REASON,
  openCoverage,
  openGrant,
  revokeCoverage,
  revokeGrants,
} from '@/lib/auth/platform-access';
import { platformAudit } from '@/lib/security/audit';
import { toResponse } from '@/lib/api/handler';

/**
 * Who may monitor which customers.
 *
 * The counterpart to the break-glass endpoint next door, and deliberately a
 * different one. Break-glass is something the platform owner takes *for
 * themselves*, in the moment, to repair data: caller and subject are the same
 * person. A monitoring authorisation is something the owner *gives to somebody
 * else*, in advance, so it names a subject and is refused when the two are the
 * same — see `openCoverage`.
 *
 * Owner-only. A support identity that could widen its own reach would make every
 * other control here decorative.
 *
 * `workspaceId` present opens a READ grant for that one workspace.
 * `workspaceId` absent opens coverage of every workspace — the explicit,
 * bounded, separately-revocable form of company-wide access, and never a role or
 * a flag on the account.
 */
const body = z
  .object({
    platformUserId: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
    reason: z.string().min(1).max(500),
    minutes: z.coerce.number().int().positive().max(MAX_READ_GRANT_MINUTES).optional(),
    /**
     * Recordings, transcripts and stored documents. Absent means no, and that
     * is the point: the wider authorisation has to be typed, not inherited.
     */
    sensitive: z.boolean().optional(),
  })
  .strict();

const revokeBody = z
  .object({
    platformUserId: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

/** The subject has to exist, be usable, and be somebody monitoring means something for. */
async function subjectOr404(platformUserId: string) {
  const subject = await prisma.platformUser.findFirst({
    where: { id: platformUserId, deletedAt: null },
    select: { id: true, email: true, platformRole: true, status: true },
  });
  if (!subject) throw NotFound('Platform identity');
  return subject;
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const input = body.parse(await req.json());
    const subject = await subjectOr404(input.platformUserId);

    if (input.workspaceId) {
      // Same rule openCoverage enforces. Break-glass is the one self-issued
      // elevation, and it has its own route and audit mode.
      if (subject.id === ctx.platformUserId) {
        throw Forbidden('Monitoring access has to be granted by somebody else.');
      }
      const workspace = await prisma.tenant.findFirst({
        where: { id: input.workspaceId, deletedAt: null },
        select: { id: true, slug: true },
      });
      if (!workspace) throw NotFound('Workspace');

      const grant = await openGrant({
        platformUserId: subject.id,
        tenantId: workspace.id,
        kind: 'READ',
        sensitive: input.sensitive ?? false,
        reason: input.reason,
        minutes: input.minutes ?? DEFAULT_READ_GRANT_MINUTES,
        requestId,
      });

      await withPlatformTx((tx) =>
        platformAudit(
          ctx,
          {
            // The customer's own trail. Somebody being authorised to watch their
            // workspace is their business before it is ours.
            tenantId: workspace.id,
            event: 'MONITORING_ACCESS_GRANTED',
            objectType: 'platform_user',
            objectId: subject.id,
            metadata: {
              slug: workspace.slug,
              subject: subject.email,
              reason: grant.reason,
              sensitive: input.sensitive ?? false,
              expiresAt: grant.expiresAt.toISOString(),
            },
          },
          tx,
        ),
      );
      return NextResponse.json({ grant }, { status: 201, headers: { 'x-request-id': requestId } });
    }

    const coverage = await openCoverage({
      platformUserId: subject.id,
      grantedById: ctx.platformUserId,
      sensitive: input.sensitive ?? false,
      reason: input.reason,
      minutes: Math.min(input.minutes ?? DEFAULT_COVERAGE_MINUTES, MAX_COVERAGE_MINUTES),
      requestId,
    });

    await withPlatformTx((tx) =>
      platformAudit(
        ctx,
        {
          // No tenantId: coverage names no workspace, so there is no single
          // customer trail this belongs on. It is a platform-level act and lives
          // in the platform-level stream.
          event: 'MONITORING_COVERAGE_GRANTED',
          objectType: 'platform_user',
          objectId: subject.id,
          metadata: {
            subject: subject.email,
            reason: coverage.reason,
            expiresAt: coverage.expiresAt.toISOString(),
          },
        },
        tx,
      ),
    );
    return NextResponse.json({ coverage }, { status: 201, headers: { 'x-request-id': requestId } });
  } catch (err) {
    return toResponse(err, requestId, { route: '/api/v1/platform/monitoring/grants' });
  }
}

/**
 * Ends it. Named workspace, or all coverage when none is named.
 *
 * Revoking a READ grant takes effect on the subject's very next request, not at
 * their next sign-in: `resolveCtx` re-asks `mayEnterWorkspace` every time. That
 * is the property that makes this a revocation rather than a note to self.
 */
export async function DELETE(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const input = revokeBody.parse(await req.json());
    const subject = await subjectOr404(input.platformUserId);
    const reason = input.reason?.trim() || 'Revoked by the platform owner';

    const closed = input.workspaceId
      ? await revokeGrants(subject.id, input.workspaceId, 'READ')
      : await revokeCoverage(subject.id, reason);

    if (closed > 0) {
      await withPlatformTx((tx) =>
        platformAudit(
          ctx,
          {
            tenantId: input.workspaceId ?? null,
            event: input.workspaceId ? 'MONITORING_ACCESS_REVOKED' : 'MONITORING_COVERAGE_REVOKED',
            objectType: 'platform_user',
            objectId: subject.id,
            metadata: { subject: subject.email, reason, closed },
          },
          tx,
        ),
      );
    }

    return NextResponse.json({ closed }, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    return toResponse(err, requestId, { route: '/api/v1/platform/monitoring/grants' });
  }
}

/** What the console needs to render the form without hardcoding the same numbers. */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    await requirePlatformOwner(req, requestId);
    return NextResponse.json(
      {
        minReason: MIN_REASON,
        workspace: { defaultMinutes: DEFAULT_READ_GRANT_MINUTES, maxMinutes: MAX_READ_GRANT_MINUTES },
        coverage: { defaultMinutes: DEFAULT_COVERAGE_MINUTES, maxMinutes: MAX_COVERAGE_MINUTES },
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    return toResponse(err, requestId, { route: '/api/v1/platform/monitoring/grants' });
  }
}
