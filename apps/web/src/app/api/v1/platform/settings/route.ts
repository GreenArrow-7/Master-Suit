import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { EDITABLE_SETTINGS, isEditableSetting } from '@/lib/platform-settings';

const patchSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().min(1).max(200),
});

/** Writes one operator setting after validating it against its own rule. */
export async function PATCH(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const body = patchSchema.parse(await req.json());
    if (!isEditableSetting(body.key)) {
      throw new AppError(422, 'unknown-setting', `"${body.key}" is not an editable setting.`);
    }

    let parsed: unknown;
    try {
      parsed = EDITABLE_SETTINGS[body.key].parse(body.value);
    } catch (validation) {
      throw new AppError(422, 'invalid-value', validation instanceof Error ? validation.message : 'Invalid value.');
    }

    const previous = await prisma.platformSetting.findUnique({ where: { key: body.key } });
    const setting = await prisma.platformSetting.upsert({
      where: { key: body.key },
      update: { value: String(parsed), updatedBy: ctx.platformUserId },
      create: { key: body.key, value: String(parsed), updatedBy: ctx.platformUserId },
    });
    await prisma.platformAuditEvent.create({
      data: {
        actorUserId: ctx.platformUserId,
        event: 'PLATFORM_SETTING_CHANGED',
        objectType: 'platform_setting',
        objectId: body.key,
        requestId,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { before: previous?.value ?? null, after: setting.value },
      },
    });

    return NextResponse.json({ setting }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
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
}
