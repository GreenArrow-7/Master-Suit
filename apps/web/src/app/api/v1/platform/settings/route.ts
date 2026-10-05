import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { EDITABLE_SETTINGS, isEditableSetting, settingCacheKey } from '@/lib/platform-settings';
import { redis } from '@/lib/redis';
import { platformAudit } from '@/lib/security/audit';
import { bareRoute } from '@/lib/api/handler';

const patchSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().min(1).max(200),
});

/** Writes one operator setting after validating it against its own rule. */
export const PATCH = bareRoute('/api/v1/platform/settings', async (req, requestId) => {
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
  // Drop the cached value so the change is live on the next request rather
  // than up to a minute later. A Redis failure here is not worth failing the
  // write for — the entry expires on its own.
  await redis.del(settingCacheKey(body.key)).catch(() => {});

  await platformAudit(ctx, {
    event: 'PLATFORM_SETTING_CHANGED',
    objectType: 'platform_setting',
    objectId: body.key,
    metadata: { before: previous?.value ?? null, after: setting.value },
  });

  return NextResponse.json({ setting });
});
