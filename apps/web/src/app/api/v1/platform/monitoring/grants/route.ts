import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
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
  const requestId = ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const input = body.parse(await req.json());
    const subject = await subjectOr404(input.platformUserId);

    if (input.workspaceId) {
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
        tx.platformAuditEvent.create({
          data: {
            // The customer's own trail. Somebody being authorised to watch their
            // workspace is their business before it is ours.
            tenantId: workspace.id,
            actorUserId: ctx.platformUserId,
            event: 'MONITORING_ACCESS_GRANTED',
            objectType: 'platform_user',
            objectId: subject.id,
            requestId,
            ipAddress: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: {
              slug: workspace.slug,
              subject: subject.email,
              reason: grant.reason,
              sensitive: input.sensitive ?? false,
              expiresAt: grant.expiresAt.toISOString(),
            },
          },
        }),
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
      tx.platformAuditEvent.create({
        data: {
          // No tenantId: coverage names no workspace, so there is no single
          // customer trail this belongs on. It is a platform-level act and lives
          // in the platform-level stream.
          actorUserId: ctx.platformUserId,
          event: 'MONITORING_COVERAGE_GRANTED',
          objectType: 'platform_user',
          objectId: subject.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: {
            subject: subject.email,
            reason: coverage.reason,
            expiresAt: coverage.expiresAt.toISOString(),
          },
        },
      }),
    );
    return NextResponse.json({ coverage }, { status: 201, headers: { 'x-request-id': requestId } });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json(err.toProblem(requestId), { status: err.status });
    throw err;
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
  const requestId = ulid();
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
        tx.platformAuditEvent.create({
          data: {
            tenantId: input.workspaceId ?? null,
            actorUserId: ctx.platformUserId,
            event: input.workspaceId ? 'MONITORING_ACCESS_REVOKED' : 'MONITORING_COVERAGE_REVOKED',
            objectType: 'platform_user',
            objectId: subject.id,
            requestId,
            ipAddress: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { subject: subject.email, reason, closed },
          },
        }),
      );
    }

    return NextResponse.json({ closed }, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json(err.toProblem(requestId), { status: err.status });
    throw err;
  }
}

/** What the console needs to render the form without hardcoding the same numbers. */
export async function GET(req: Request) {
  const requestId = ulid();
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
    if (err instanceof AppError) return NextResponse.json(err.toProblem(requestId), { status: err.status });
    throw err;
  }
}
