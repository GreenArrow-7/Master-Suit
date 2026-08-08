import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { AppError, Conflict } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';

const planSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(2).max(120),
  modules: z.array(z.enum(['HRMS', 'SALES'])).min(1),
  maxUsers: z.number().int().positive().max(100000),
  maxEmployees: z.number().int().positive().max(100000),
  maxStorageMb: z.number().int().positive().max(10000000),
});

export async function GET(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    await requirePlatformOwner(req, requestId);
    const plans = await prisma.subscriptionPlan.findMany({
      include: { planModules: true, planLimits: true, _count: { select: { subscriptions: true } } },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ plans }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId);
  }
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const body = planSchema.parse(await req.json());
    const exists = await prisma.subscriptionPlan.findUnique({ where: { code: body.code } });
    if (exists) throw Conflict('That plan code is already in use.');

    const plan = await withPlatformTx(async (tx) => {
      const created = await tx.subscriptionPlan.create({
        data: {
          code: body.code,
          name: body.name,
          modules: body.modules,
          seatLimit: body.maxUsers,
          storageMb: body.maxStorageMb,
          featureLimits: { maxEmployees: body.maxEmployees },
          planModules: { create: body.modules.map((module) => ({ module, enabled: true })) },
          planLimits: {
            create: [
              { key: 'users', value: body.maxUsers },
              { key: 'employees', value: body.maxEmployees },
              { key: 'storage_mb', value: body.maxStorageMb },
            ],
          },
        },
        include: { planModules: true, planLimits: true },
      });
      await tx.platformAuditEvent.create({
        data: {
          actorUserId: ctx.platformUserId,
          event: 'PLAN_CREATED',
          objectType: 'subscription_plan',
          objectId: created.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { code: created.code, modules: body.modules },
        },
      });
      return created;
    });

    return NextResponse.json({ plan }, { status: 201, headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId);
  }
}

function problem(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return NextResponse.json(error.toProblem(requestId), {
      status: error.status,
      headers: { 'x-request-id': requestId },
    });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { status: 422, title: 'Validation failed', requestId, errors: error.flatten() },
      { status: 422 },
    );
  }
  return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
}
