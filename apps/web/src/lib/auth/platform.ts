import { Forbidden } from '@/lib/errors';
import { resolvePlatformCtx, type PlatformCtx } from '@/lib/auth/session';
import { isPlatformOwner } from '@/lib/auth/platform-policy';
import { isSupportRole } from '@/lib/auth/support-actor';

/**
 * The control plane: provisioning workspaces, editing subscriptions and plans,
 * administering platform accounts, taking break-glass write access.
 *
 * OWNER and nobody else, unchanged.
 */
export async function requirePlatformOwner(req: Request, requestId: string): Promise<PlatformCtx> {
  const ctx = await resolvePlatformCtx(req, requestId);
  if (!isPlatformOwner(ctx.platformRole)) {
    throw Forbidden('Platform-owner access is required.');
  }
  return ctx;
}

/**
 * Monitoring: seeing which workspaces you are authorised for, and entering one.
 *
 * ── Why this is a separate gate ─────────────────────────────────────────────
 *
 * SUPPORT and SECURITY_AUDITOR were fully modelled — `buildSupportActor` builds
 * them a read-only actor, `isSupportRole` names them, and a suite of passing
 * tests covers both — and completely unreachable. Every door was
 * `requirePlatformOwner`: the console layout, the workspace list, the `enter`
 * route. Nothing set `activeTenantId` for them and `switchActiveWorkspace`
 * demands a membership they structurally cannot hold.
 *
 * So the only human who could enter a customer workspace was the platform OWNER
 * — the single most privileged identity, and the only one that can elevate to
 * write. Support work was done by the account least suited to doing it, which is
 * the opposite of least privilege.
 *
 * Splitting the gate is what lets a support identity exist in practice rather
 * than only in the schema. It widens *who* may enter; it does not widen *what*
 * they may do, which is `buildSupportActor`'s decision, nor *where* — that is
 * the grant check in `resolveCtx`.
 */
export async function requirePlatformSupport(req: Request, requestId: string): Promise<PlatformCtx> {
  const ctx = await resolvePlatformCtx(req, requestId);
  if (!isSupportRole(ctx.platformRole)) {
    throw Forbidden('Platform monitoring access is required.');
  }
  return ctx;
}
