import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { AppError, Forbidden, NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import {
  DEFAULT_GRANT_MINUTES,
  MAX_GRANT_MINUTES,
  MIN_REASON,
  activeGrant,
  openGrant,
  revokeGrants,
} from '@/lib/auth/platform-access';

/**
 * Break-glass: write access into one customer workspace, for a stated reason and
 * a bounded time.
 *
 * A platform OWNER used to hold every permission in every tenant permanently,
 * from the moment they opened a workspace. Opening one still needs no ceremony —
 * looking at a customer's data to answer their question is the ordinary case.
 * Changing it now needs this.
 *
 * `POST` opens a grant, `GET` reports the live one, `DELETE` hands it back. Each
 * is a `PlatformAuditEvent` on the customer's own trail, because the person whose
 * data it is has the strongest claim to know.
 */

const body = z
  .object({
    reason: z.string().min(1).max(500),
    minutes: z.coerce.number().int().positive().max(MAX_GRANT_MINUTES).optional(),
  })
  .strict();

async function workspaceOr404(workspaceId: string) {
  const workspace = await prisma.tenant.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: { id: true, slug: true },
  });
  if (!workspace) throw NotFound('Workspace');
  return workspace;
}

export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const requestId = ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { workspaceId } = await params;
    const workspace = await workspaceOr404(workspaceId);

    // Unreachable while requirePlatformOwner is `role === 'OWNER'`, and kept
    // anyway. SUPPORT and SECURITY_AUDITOR are read-only by design — that is the
    // reason a customer accepts them looking at their data at all — and if the
    // gate above is ever widened to let them read this endpoint, the widening
    // must not silently hand them a write grant too. A comment here used to
    // claim they already reach this line; they do not.
    if (ctx.platformRole !== 'OWNER') {
      throw Forbidden('Only the platform owner can take write access into a customer workspace.');
    }

    const input = body.parse(await req.json());
    const grant = await openGrant({
      platformUserId: ctx.platformUserId,
      tenantId: workspace.id,
      reason: input.reason,
      minutes: input.minutes,
      requestId,
    });

    await withPlatformTx(async (tx) => {
      await tx.platformAuditEvent.create({
        data: {
          tenantId: workspace.id,
          actorUserId: ctx.platformUserId,
          event: 'PLATFORM_WRITE_ACCESS_OPENED',
          objectType: 'workspace',
          objectId: workspace.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          // The reason is the point of the record. A grant whose justification
          // lives only in somebody's memory is the thing this replaces.
          metadata: { slug: workspace.slug, reason: grant.reason, expiresAt: grant.expiresAt.toISOString() },
        },
      });
    });

    return NextResponse.json({ grant }, { status: 201, headers: { 'x-request-id': requestId } });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json(err.toProblem(requestId), { status: err.status });
    throw err;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const requestId = ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { workspaceId } = await params;
    const grant = await activeGrant(ctx.platformUserId, workspaceId);
    return NextResponse.json(
      {
        grant,
        defaultMinutes: DEFAULT_GRANT_MINUTES,
        maxMinutes: MAX_GRANT_MINUTES,
        // So the console can enforce the same minimum this API does, and say so
        // before the round trip. A form that accepts what the server rejects is
        // a form that teaches people the control is broken.
        //
        // No `mayElevate` alongside it: requirePlatformOwner admits OWNER and
        // nobody else, and the platform layout gates the whole console the same
        // way, so a caller who can read this response can always open a grant.
        // A field that is constant is not a capability check, it is a decoration
        // that would eventually be trusted as one.
        minReason: MIN_REASON,
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json(err.toProblem(requestId), { status: err.status });
    throw err;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const requestId = ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { workspaceId } = await params;
    const workspace = await workspaceOr404(workspaceId);

    const closed = await revokeGrants(ctx.platformUserId, workspace.id);
    // Only audited when something was actually open — a DELETE against nothing
    // is idempotency, not an event, and a trail full of no-ops is a trail nobody
    // reads.
    if (closed > 0) {
      await withPlatformTx(async (tx) => {
        await tx.platformAuditEvent.create({
          data: {
            tenantId: workspace.id,
            actorUserId: ctx.platformUserId,
            event: 'PLATFORM_WRITE_ACCESS_CLOSED',
            objectType: 'workspace',
            objectId: workspace.id,
            requestId,
            ipAddress: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { slug: workspace.slug, closed },
          },
        });
      });
    }

    return NextResponse.json({ closed }, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json(err.toProblem(requestId), { status: err.status });
    throw err;
  }
}
