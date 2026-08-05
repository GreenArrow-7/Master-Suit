import { Forbidden } from '@/lib/errors';
import { resolvePlatformCtx, type PlatformCtx } from '@/lib/auth/session';
import { isPlatformOwner } from '@/lib/auth/platform-policy';

export async function requirePlatformOwner(req: Request, requestId: string): Promise<PlatformCtx> {
  const ctx = await resolvePlatformCtx(req, requestId);
  if (!isPlatformOwner(ctx.platformRole)) {
    throw Forbidden('Platform-owner access is required.');
  }
  return ctx;
}
