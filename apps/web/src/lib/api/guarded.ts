import { resolveCtx } from '../auth/session';
import { assertPermission, type Action, type Ctx } from '../security/rbac';
import { assertModuleEntitlement, type ProductModule } from '../security/entitlements';
import { consume, limits, type Limit } from '../security/ratelimit';
import { requireWorkspace } from '../workspace';

/**
 * The security prologue, for routes that cannot use the API kernel.
 *
 * ── Why these routes exist at all ───────────────────────────────────────────
 *
 * `lib/api/handler.ts` always answers JSON. A payslip PDF, a CSV export and a
 * WPS bank file are streams and downloads, so ten routes authenticate,
 * entitle, permit and rate-limit by hand. Each was correct when it was written.
 * The assessment's point is that each is also a place a future edit drops a gate
 * the kernel would have enforced — and it had already happened.
 *
 * ── What the hand-written copies had actually lost ──────────────────────────
 *
 * The assessment named one: the WPS export, which bulk-exports every employee's
 * IBAN and labour-card number and had no rate limit. Reading them all showed it
 * was five — every HR bypass. Payslip PDFs, HR document downloads and uploads,
 * HR report exports and the bank file were all unlimited, so anything holding a
 * valid session could pull the lot as fast as the server would serve it.
 *
 * Not one of them omitted the limit deliberately. They omitted it because it is
 * the fourth line of a prologue somebody retypes each time, and the fourth line
 * is the one that gets forgotten.
 *
 * ── So the limit is not a parameter you can leave out ───────────────────────
 *
 * `limit` defaults to the per-session bucket. There is no "none": a caller that
 * wants a different ceiling passes one, and a caller that forgets gets the
 * default rather than nothing. That is the whole reason this function exists —
 * the other three steps were already being done consistently.
 */
export interface GuardSpec {
  /** The entitlement the workspace must hold. */
  productModule: ProductModule;
  /**
   * Permission module and action.
   *
   * Optional, because a few routes cannot decide it until they have loaded the
   * record — a payslip PDF is "your own, or payroll:VIEW for anyone else's", and
   * `payslipDetail` already enforces exactly that. Those pass nothing here and
   * say in a comment where the check lives instead.
   */
  permission?: readonly [module: string, action: Action];
  /** Defaults to the per-session bucket. See the note above. */
  limit?: Limit;
  /** When the URL carries a workspace slug, the slug to check the session against. */
  workspaceSlug?: string;
}

export async function resolveGuardedCtx(req: Request, requestId: string, spec: GuardSpec): Promise<Ctx> {
  // The order matters and is the kernel's: who are you, may this workspace use
  // this module, may *you* do this, and are you doing it too often. Each step
  // can throw, and each throws before the next runs.
  const ctx = await resolveCtx(req, requestId);
  await assertModuleEntitlement(ctx.tenantId, spec.productModule);

  if (spec.workspaceSlug) await requireWorkspace(ctx, spec.workspaceSlug, spec.productModule);
  if (spec.permission) assertPermission(ctx, spec.permission[0], spec.permission[1]);

  await consume(spec.limit ?? limits.sessionUser(ctx.actor.id));
  return ctx;
}
