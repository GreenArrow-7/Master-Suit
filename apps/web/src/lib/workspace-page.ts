import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { requireWorkspace } from '@/lib/workspace';
import type { ProductModule } from '@/lib/security/entitlements';

export async function resolveWorkspacePage(workspaceSlug: string, module?: ProductModule) {
  const ctx = await resolveCtx(new Request(`http://internal/${workspaceSlug}`, { headers: await headers() }), ulid());
  const workspace = await requireWorkspace(ctx, workspaceSlug, module);
  return { ctx, workspace };
}
