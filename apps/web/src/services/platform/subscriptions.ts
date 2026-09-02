/**
 * The one place that decides what a company has bought.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Deciding "does ABC Real Estate own Sales?" used to be done independently in
 * four places: the workspace PATCH route, the subscription PATCH route, the
 * subscription DELETE route, and — with a *different* rule — the React
 * dashboard. They disagreed, and the disagreements were not cosmetic:
 *
 *  - Cancelling one product cancelled every product. All three write paths
 *    updated entitlements with `where: { tenantId }` and no module filter, so
 *    "cancel Sales" took HR down with it.
 *  - The dashboard tested `state` but not `endsAt`, while the API tested both.
 *    A subscription left ACTIVE past its end date was refused by every endpoint
 *    and still advertised on the landing page.
 *
 * Both are the same bug: commercial truth computed by whoever happened to be
 * writing. So there is exactly one predicate here — `isProductSubscriptionUsable`
 * — and every surface reaches it, directly or through the entitlement rows it
 * derives.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 *   Tenant
 *     └── TenantSubscription        the billing container, one per company
 *           └── SubscriptionModule  one row per product bought  ← AUTHORITATIVE
 *
 *   ModuleEntitlement               runtime projection            ← DERIVED
 *
 * `ModuleEntitlement` is what the request path reads, because it is one indexed
 * row per (tenant, module) behind a 60-second Redis cache. It is not a place to
 * record a commercial decision: write the product subscription and call
 * `syncModuleEntitlements`, which recomputes the projection from scratch.
 */
import type { ModuleKey, SubscriptionState } from '@prisma/client';
import { prisma, withPlatformTx, type TxClient } from '@/lib/db';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { Conflict, NotFound } from '@/lib/errors';

export type Db = TxClient | typeof prisma;

/** The products this platform sells. Mirrors `ProductModule` in lib/security/entitlements.ts. */
export const PRODUCT_MODULES = ['HRMS', 'SALES'] as const satisfies readonly ModuleKey[];

/** The shape the predicate needs — so callers can pass a row from any query. */
export interface ProductSubscriptionTerms {
  state: SubscriptionState;
  startsAt: Date;
  endsAt: Date | null;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
}

/**
 * Whether one purchased product currently grants access.
 *
 * **This is the single validity rule.** The API gate, the product hub, the
 * sidebar, the product switcher and the mobile tab bar all resolve to this
 * function — most of them via the entitlement rows it derives — so a company
 * cannot be told it owns a product on one screen and refused it on the next.
 *
 * `currentPeriodEnd` is deliberately *not* consulted. It is the billing anchor
 * for the next invoice and moves on renewal; a customer three minutes past it
 * has not lost access, they have an invoice due. `endsAt` is the hard stop, and
 * it outranks `state` — a row left ACTIVE by a billing job that failed to run
 * must not outlive the term the customer actually paid for (TEST H).
 */
export function isProductSubscriptionUsable(terms: ProductSubscriptionTerms, now: Date = new Date()): boolean {
  if (terms.state === 'CANCELED' || terms.state === 'SUSPENDED') return false;
  // A product sold with a future start date is not yet access.
  if (terms.startsAt > now) return false;
  // The hard stop, whatever the state column claims.
  if (terms.endsAt && terms.endsAt <= now) return false;
  if (terms.state === 'TRIAL' && terms.trialEndsAt && terms.trialEndsAt <= now) return false;
  if (terms.state === 'GRACE' && terms.graceEndsAt && terms.graceEndsAt <= now) return false;
  return terms.state === 'TRIAL' || terms.state === 'ACTIVE' || terms.state === 'GRACE';
}

/**
 * When access granted by this row runs out, or null for open-ended.
 *
 * Projected onto the entitlement so the request-path check (`endsAt > now` in
 * lib/security/entitlements.ts) expires at the same instant this file would,
 * without having to re-read the subscription on every request.
 */
function accessEndsAt(terms: ProductSubscriptionTerms): Date | null {
  const candidates = [
    terms.endsAt,
    terms.state === 'TRIAL' ? terms.trialEndsAt : null,
    terms.state === 'GRACE' ? terms.graceEndsAt : null,
  ].filter((value): value is Date => value instanceof Date);
  if (candidates.length === 0) return null;
  // The earliest of the applicable limits — whichever bites first.
  return candidates.reduce((earliest, value) => (value < earliest ? value : earliest));
}

/** Every product row for a company, newest first. */
export async function getTenantProductSubscriptions(tenantId: string, db: Db = prisma) {
  return db.subscriptionModule.findMany({
    where: { subscription: { tenantId } },
    include: { plan: true, subscription: true },
    orderBy: { createdAt: 'desc' },
  });
}

export interface EffectiveModule {
  module: ModuleKey;
  usable: boolean;
  state: SubscriptionState;
  endsAt: Date | null;
  /** The product row that granted access, when one did. */
  sourceId: string | null;
  planCode: string | null;
}

/**
 * What the company can actually use right now, per product.
 *
 * Several rows may provide the same module — a bundle overlapping a standalone
 * contract, a promotional term beside a paid one — so this asks whether *any*
 * source is usable and reports the one granting the longest access. Expiring one
 * of two sources therefore leaves the module available (TEST I), which the old
 * one-row-per-module shape could not express at all.
 */
export async function getEffectiveModules(
  tenantId: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<Map<ModuleKey, EffectiveModule>> {
  const rows = await db.subscriptionModule.findMany({
    where: { subscription: { tenantId } },
    include: { plan: { select: { code: true } } },
  });

  const result = new Map<ModuleKey, EffectiveModule>();
  for (const productModule of PRODUCT_MODULES) {
    result.set(productModule, {
      module: productModule,
      usable: false,
      state: 'CANCELED',
      endsAt: now,
      sourceId: null,
      planCode: null,
    });
  }

  for (const row of rows) {
    if (!isProductSubscriptionUsable(row, now)) continue;
    const current = result.get(row.module);
    const endsAt = accessEndsAt(row);
    // An open-ended source beats a dated one; otherwise the later end wins.
    const better =
      !current?.usable || current.endsAt === null
        ? current?.usable !== true
        : endsAt === null || endsAt > current.endsAt;
    if (!better) continue;
    result.set(row.module, {
      module: row.module,
      usable: true,
      state: row.state,
      endsAt,
      sourceId: row.id,
      planCode: row.plan?.code ?? null,
    });
  }

  return result;
}

/**
 * Recomputes `ModuleEntitlement` from the product subscriptions. Idempotent.
 *
 * The only supported way to change what a company can reach. Every write path
 * ends here rather than editing entitlements itself, which is what makes
 * "cancel Sales, keep HR" fall out of the model instead of depending on each
 * route remembering a `module` filter.
 *
 * Runs inside the caller's transaction so the products and the projection commit
 * together — a crash between the two would leave the company's access describing
 * a purchase that was rolled back.
 */
export async function syncModuleEntitlements(
  tenantId: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<Map<ModuleKey, EffectiveModule>> {
  const effective = await getEffectiveModules(tenantId, db, now);

  for (const entry of effective.values()) {
    const existing = await db.moduleEntitlement.findUnique({
      where: { tenantId_module: { tenantId, module: entry.module } },
      select: { id: true },
    });

    // A module the company has never bought stays absent rather than being
    // written as a CANCELED row: `assertModuleEntitlement` refuses a missing row
    // and a cancelled one identically, and inventing rows would make "was this
    // ever sold?" unanswerable from the table.
    if (!entry.usable && !existing) continue;

    await db.moduleEntitlement.upsert({
      where: { tenantId_module: { tenantId, module: entry.module } },
      update: { state: entry.state, endsAt: entry.endsAt },
      create: { tenantId, module: entry.module, state: entry.state, endsAt: entry.endsAt },
    });
  }

  return effective;
}

/**
 * Sync, then clear the entitlement cache.
 *
 * Split from `syncModuleEntitlements` because the cache must be cleared *after*
 * the transaction commits, not inside it: a rollback after the delete would
 * leave the next request to re-cache the state that was rolled back.
 */
export async function syncAndInvalidate(tenantId: string, db: Db = prisma, now: Date = new Date()) {
  const effective = await syncModuleEntitlements(tenantId, db, now);
  await invalidateEntitlements(tenantId);
  return effective;
}

/** Terms a caller may set on a product. All optional; absent means unchanged. */
export interface ProductTermsInput {
  planCode?: string | null;
  state?: SubscriptionState;
  startsAt?: Date;
  endsAt?: Date | null;
  trialEndsAt?: Date | null;
  graceEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  externalCustomerId?: string | null;
  externalContractId?: string | null;
  limits?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** The company's billing container, created on first purchase if absent. */
async function requireContainer(tenantId: string, tx: TxClient, planId?: string) {
  const existing = await tx.tenantSubscription.findUnique({ where: { tenantId } });
  if (existing) return existing;

  const fallbackPlan =
    (planId ? await tx.subscriptionPlan.findUnique({ where: { id: planId } }) : null) ??
    (await tx.subscriptionPlan.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } }));
  if (!fallbackPlan) throw Conflict('No subscription plan exists to attach this purchase to.');

  return tx.tenantSubscription.create({
    data: { tenantId, planId: fallbackPlan.id, state: 'ACTIVE' },
  });
}

async function resolvePlanId(planCode: string | null | undefined, tx: TxClient): Promise<string | null | undefined> {
  if (planCode === undefined) return undefined;
  if (planCode === null) return null;
  const plan = await tx.subscriptionPlan.findFirst({ where: { code: planCode, active: true } });
  if (!plan) throw NotFound('Subscription plan');
  return plan.id;
}

/**
 * Sells a company one product.
 *
 * Adding a second product must not touch the company's identity: no Tenant, no
 * PlatformUser and no WorkspaceMembership is created or duplicated here, which
 * is asserted by TEST J. Purchasing Sales for a company that already runs HR
 * adds one row to `SubscriptionModule` and nothing else.
 */
export async function createProductSubscription(
  tenantId: string,
  module: ModuleKey,
  terms: ProductTermsInput,
  tx: TxClient,
) {
  const planId = await resolvePlanId(terms.planCode, tx);
  const container = await requireContainer(tenantId, tx, planId ?? undefined);

  const created = await tx.subscriptionModule.create({
    data: {
      subscriptionId: container.id,
      module,
      planId: planId ?? container.planId,
      state: terms.state ?? 'ACTIVE',
      startsAt: terms.startsAt ?? new Date(),
      endsAt: terms.endsAt ?? null,
      trialEndsAt: terms.trialEndsAt ?? null,
      graceEndsAt: terms.graceEndsAt ?? null,
      currentPeriodEnd: terms.currentPeriodEnd ?? null,
      externalCustomerId: terms.externalCustomerId ?? null,
      externalContractId: terms.externalContractId ?? null,
      ...(terms.limits ? { limits: terms.limits as object } : {}),
      ...(terms.metadata ? { metadata: terms.metadata as object } : {}),
    },
  });

  await syncModuleEntitlements(tenantId, tx);
  return created;
}

/** Edits one product's terms, leaving every other product alone. */
export async function updateProductSubscription(productSubscriptionId: string, terms: ProductTermsInput, tx: TxClient) {
  const current = await tx.subscriptionModule.findUnique({
    where: { id: productSubscriptionId },
    include: { subscription: { select: { tenantId: true } } },
  });
  if (!current) throw NotFound('Product subscription');

  const planId = await resolvePlanId(terms.planCode, tx);

  const updated = await tx.subscriptionModule.update({
    where: { id: current.id },
    data: {
      ...(planId === undefined ? {} : { planId }),
      ...(terms.state === undefined ? {} : { state: terms.state }),
      ...(terms.startsAt === undefined ? {} : { startsAt: terms.startsAt }),
      ...(terms.endsAt === undefined ? {} : { endsAt: terms.endsAt }),
      ...(terms.trialEndsAt === undefined ? {} : { trialEndsAt: terms.trialEndsAt }),
      ...(terms.graceEndsAt === undefined ? {} : { graceEndsAt: terms.graceEndsAt }),
      ...(terms.currentPeriodEnd === undefined ? {} : { currentPeriodEnd: terms.currentPeriodEnd }),
      ...(terms.externalCustomerId === undefined ? {} : { externalCustomerId: terms.externalCustomerId }),
      ...(terms.externalContractId === undefined ? {} : { externalContractId: terms.externalContractId }),
      ...(terms.limits === undefined ? {} : { limits: terms.limits as object }),
      ...(terms.metadata === undefined ? {} : { metadata: terms.metadata as object }),
      // Re-activating clears the tombstone; cancelling stamps it.
      ...(terms.state === 'CANCELED' ? { canceledAt: new Date() } : terms.state ? { canceledAt: null } : {}),
    },
  });

  await syncModuleEntitlements(current.subscription.tenantId, tx);
  return updated;
}

/** Moves one product onto another plan. The company's other products keep theirs. */
export async function changeProductPlan(productSubscriptionId: string, planCode: string, tx: TxClient) {
  return updateProductSubscription(productSubscriptionId, { planCode }, tx);
}

/**
 * Cancels ONE product.
 *
 * The behaviour this whole change exists for: cancelling Sales leaves HR
 * running, leaves the tenant, the identity and the membership untouched, and
 * removes exactly one module's access (TEST E / TEST F).
 *
 * The row is kept and stamped rather than deleted — it is billing history, and
 * a deleted row cannot answer "when did they stop paying for this?".
 */
export async function cancelProductSubscription(productSubscriptionId: string, tx: TxClient, at: Date = new Date()) {
  const current = await tx.subscriptionModule.findUnique({
    where: { id: productSubscriptionId },
    include: { subscription: { select: { tenantId: true } } },
  });
  if (!current) throw NotFound('Product subscription');

  const canceled = await tx.subscriptionModule.update({
    where: { id: current.id },
    data: { state: 'CANCELED', canceledAt: at, endsAt: current.endsAt ?? at },
  });

  await syncModuleEntitlements(current.subscription.tenantId, tx, at);
  return canceled;
}

/** Puts a cancelled or suspended product back into service. */
export async function reactivateProductSubscription(
  productSubscriptionId: string,
  tx: TxClient,
  terms: ProductTermsInput = {},
) {
  return updateProductSubscription(productSubscriptionId, { state: 'ACTIVE', endsAt: null, ...terms }, tx);
}

/**
 * Cancels every product providing one module for a company.
 *
 * The module-level verb the console needs: "this company no longer has Sales",
 * whatever combination of bundles and standalone contracts was providing it.
 * Scoped to the module, so the company's other products are untouched.
 */
export async function cancelModuleForTenant(tenantId: string, module: ModuleKey, tx: TxClient, at: Date = new Date()) {
  const rows = await tx.subscriptionModule.findMany({
    where: { subscription: { tenantId }, module, state: { not: 'CANCELED' } },
    select: { id: true },
  });
  for (const row of rows) {
    await tx.subscriptionModule.update({
      where: { id: row.id },
      data: { state: 'CANCELED', canceledAt: at, endsAt: at },
    });
  }
  await syncModuleEntitlements(tenantId, tx, at);
  return rows.length;
}

/**
 * Brings a company's products in line with an explicit list of modules.
 *
 * What the console's module checkboxes mean: everything ticked should be
 * available, everything unticked should not. Ticking a module the company has
 * never owned sells it; unticking one cancels only that module's rows.
 */
export async function setTenantModules(
  tenantId: string,
  modules: readonly ModuleKey[],
  terms: ProductTermsInput,
  tx: TxClient,
  at: Date = new Date(),
) {
  const wanted = new Set(modules);

  for (const productModule of PRODUCT_MODULES) {
    const existing = await tx.subscriptionModule.findMany({
      where: { subscription: { tenantId }, module: productModule },
      orderBy: { createdAt: 'desc' },
    });

    if (!wanted.has(productModule)) {
      await cancelModuleForTenant(tenantId, productModule, tx, at);
      continue;
    }

    const live = existing.filter((row) => row.state !== 'CANCELED');
    if (live.length === 0) {
      await createProductSubscription(tenantId, productModule, terms, tx);
      continue;
    }
    // Already sold: apply whatever terms the caller stated to the live rows.
    for (const row of live) {
      await updateProductSubscription(row.id, terms, tx);
    }
  }

  return syncModuleEntitlements(tenantId, tx, at);
}

/**
 * Convenience wrapper for callers outside a transaction.
 *
 * `withPlatformTx` because these rows are the control plane's, and reconciling
 * one company's products may legitimately be triggered from a context that has
 * no `app.tenant_id`.
 */
export function reconcileTenant(tenantId: string, at: Date = new Date()) {
  return withPlatformTx(async (tx) => syncModuleEntitlements(tenantId, tx, at)).then(async (effective) => {
    await invalidateEntitlements(tenantId);
    return effective;
  });
}
