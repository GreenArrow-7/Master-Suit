import { prisma } from '../db';
import { Forbidden } from '../errors';
import { logger } from '../logger';
import { recordAiTokens } from '../metrics';
import type { GeminiCredential } from './gemini';
import type { ModelUsage } from './provider';

/**
 * What each workspace spends on the model, and the ceiling on spending ours.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * Nothing counted tokens. Not per workspace, not in aggregate, not at all — so a
 * single tenant transcribing a backlog of calls could exhaust the deployment's
 * Gemini budget for every other tenant on the platform, and afterwards there was
 * no record of which one had. The only cost control in the product was the
 * `ai` worker's concurrency of 2, which limits the *rate* and not the *bill*.
 *
 * ── Meter both, cap one ─────────────────────────────────────────────────────
 *
 * A workspace that has connected its own Gemini key spends its own quota against
 * its own Google bill. Capping that would be charging them for a limit they are
 * already paying past, and it is the opposite of what "bring your own key"
 * offers. Their usage is still recorded — an administrator asking "what is the
 * AI costing us" deserves an answer either way — but the ceiling applies only to
 * the shared deployment key, which is the budget that can actually be exhausted
 * by somebody else.
 *
 * ── Where the number lives ──────────────────────────────────────────────────
 *
 * `WorkspaceUsage` already exists with a `(tenantId, metric)` unique and a
 * `limit` column, seeded at workspace creation for users, employees and storage.
 * It has no period dimension and no payer dimension, so both go in the metric
 * key: `ai_tokens:deployment:2026-08`. That keeps this to no migration, gives
 * history for free, and each month's rows are a natural candidate for the
 * retention sweep later.
 */

/** Whose credential paid for a call. The ceiling applies to one of them. */
export type PaidBy = Exclude<GeminiCredential['source'], 'simulated'>;

/** `2026-08`. UTC, so a workspace's month does not depend on its timezone. */
function period(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * `ai_tokens:deployment:2026-08` — spend, by month, **by whose key paid**.
 *
 * ── Why the source is in the key ───────────────────────────────────────────
 *
 * It used not to be, and the module comment above described a rule the code did
 * not implement. Both sources incremented one `ai_tokens:2026-08` row, and
 * `assertAiBudget` compared that combined figure against a ceiling it says
 * "applies only to the shared deployment key". So a workspace on its own key,
 * spending its own money against its own Google bill, walked its own ceiling
 * down — and the first time it fell back to the deployment key (a rotation, a
 * disconnect) it was refused on an allowance it had never touched.
 *
 * Splitting the key is also what makes the platform console able to answer the
 * question it is asked: *what is the AI costing **us***. One number summing
 * "our spend" and "their spend" answers neither.
 */
export function usageMetric(paidBy: PaidBy, at: Date = new Date()): string {
  return `ai_tokens:${paidBy}:${period(at)}`;
}

/**
 * The pre-split key. Rows under it are real spend that cannot be attributed
 * retroactively, so they are read and shown as their own line rather than
 * folded into either side or quietly dropped.
 */
export function legacyUsageMetric(at: Date = new Date()): string {
  return `ai_tokens:${period(at)}`;
}

/** Matches every ai_tokens row, in any of the three shapes. */
export const AI_METRIC_PREFIX = 'ai_tokens:';

/**
 * `ai_model:deployment:gemini-2.5-flash:2026-08` — the same spend, split by the
 * model that produced it.
 *
 * ── Why a second row rather than a richer key ───────────────────────────────
 *
 * The obvious move is to put the model into `ai_tokens:` and sum across models
 * wherever the total is needed. That would put the model dimension directly in
 * the path of `assertAiBudget`, which reads the deployment total to decide
 * whether to refuse work. A mistake there does not show up as a wrong number on
 * a report — it either stops charging a heavy tenant or starts refusing a light
 * one. So `ai_tokens:` is left exactly as it was, and attribution is additive:
 * if these rows are wrong, a chart is wrong and nothing is denied.
 *
 * The model is already known at the call site and was being logged and dropped.
 *
 * Model ids are vendor strings and they churn (see the Gemini model retirements
 * this codebase has already survived), so a retired id keeps its history here
 * instead of being folded into whatever replaced it.
 */
export const AI_MODEL_METRIC_PREFIX = 'ai_model:';

/**
 * Model ids arrive from a vendor and end up in a unique key, so they are
 * constrained rather than trusted: lowercased, anything exotic collapsed to a
 * hyphen, and truncated. `unknown` keeps a row attributable to a workspace even
 * when the provider reports no model at all.
 */
export function modelUsageMetric(paidBy: PaidBy, model: string, at: Date = new Date()): string {
  const safe = (model || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${AI_MODEL_METRIC_PREFIX}${paidBy}:${safe || 'unknown'}:${period(at)}`;
}

/** Pulls `{ paidBy, model, period }` back out of a model metric key. */
export function parseModelMetric(metric: string): { paidBy: string; model: string; period: string } | null {
  if (!metric.startsWith(AI_MODEL_METRIC_PREFIX)) return null;
  const rest = metric.slice(AI_MODEL_METRIC_PREFIX.length);
  // The model is the middle, and may itself contain no colons by construction.
  const parts = rest.split(':');
  if (parts.length < 3) return null;
  const [paidBy, model, periodPart] = [parts[0], parts.slice(1, -1).join(':'), parts[parts.length - 1]];
  return { paidBy, model, period: periodPart };
}

/** The plan limit key an operator sets on a SubscriptionPlan to cap this. */
export const AI_TOKEN_LIMIT_KEY = 'ai_tokens_monthly';

/**
 * The workspace's ceiling for this month, or null for "no limit configured".
 *
 * Read from the plan rather than from `WorkspaceUsage.limit`, because a plan
 * change should move every subscriber's ceiling at once. Absent means unlimited:
 * a platform that has not decided on a number must not refuse work because of a
 * default somebody guessed.
 */
async function monthlyLimit(tenantId: string): Promise<number | null> {
  const subscription = await prisma.tenantSubscription.findUnique({
    where: { tenantId },
    select: { plan: { select: { planLimits: { where: { key: AI_TOKEN_LIMIT_KEY }, select: { value: true } } } } },
  });
  const value = subscription?.plan?.planLimits[0]?.value;
  return typeof value === 'number' && value > 0 ? value : null;
}

/**
 * Deployment-key spend only — the budget the ceiling is about.
 *
 * A workspace's own-key spend is deliberately not counted here. Doing so was
 * the bug: it charged a tenant against an allowance for a bill they were
 * already paying themselves.
 */
async function deploymentUsedThisMonth(tenantId: string): Promise<number> {
  const row = await prisma.workspaceUsage.findUnique({
    where: { tenantId_metric: { tenantId, metric: usageMetric('deployment') } },
    select: { used: true },
  });
  return row?.used ?? 0;
}

/**
 * Refuses further model work when the workspace is over its monthly ceiling.
 *
 * Called *before* the request that would be billed, which is the only useful
 * place: after it, the tokens are already spent.
 *
 * Deliberately not exact. Usage is recorded after each response, so a burst of
 * concurrent jobs can carry a workspace some way past its ceiling before the
 * first of them records anything. Making it exact would mean reserving tokens
 * up front against an estimate nobody can compute — the response length is not
 * knowable in advance. A ceiling that stops a runaway within one batch is the
 * control that was wanted; a quota system that bills to the token is not.
 */
export async function assertAiBudget(tenantId: string | null | undefined, credential: GeminiCredential): Promise<void> {
  // Their key, their bill. And simulation costs nothing to anybody.
  if (!tenantId || credential.source !== 'deployment') return;

  const limit = await monthlyLimit(tenantId);
  if (limit === null) return;

  const used = await deploymentUsedThisMonth(tenantId);
  if (used < limit) return;

  logger.warn({ tenantId, used, limit }, 'ai budget exhausted for the month');
  throw Forbidden(
    `This workspace has used its monthly AI allowance (${limit.toLocaleString()} tokens). ` +
      'It resets at the start of next month, or connect your own Gemini key in Settings → Integrations for your own quota.',
  );
}

/**
 * Records what a call actually cost.
 *
 * Never throws. Metering is bookkeeping that happens after the model has already
 * answered and the caller already has their result; failing the feature because
 * a counter did not increment would trade a working answer for an accurate
 * ledger, which is the wrong way round.
 *
 * `upsert` on the compound unique, so the first call of a month creates the row
 * and every later one increments it. `limit` is stamped alongside so the platform
 * console can render "used of allowance" without joining back to the plan.
 */
export async function recordAiUsage(
  tenantId: string | null | undefined,
  credential: GeminiCredential,
  usage: Partial<ModelUsage> | undefined,
  context: { feature: string; model: string },
): Promise<void> {
  if (!tenantId || credential.source === 'simulated') return;

  const tokens = usage?.totalTokens ?? (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
  if (!tokens) return;

  // Logged whatever happens next, so the attribution survives even if the write
  // does not — a log line is the only thing that was here before, and it had no
  // token count in it.
  logger.info(
    { tenantId, tokens, model: context.model, feature: context.feature, keySource: credential.source },
    'ai usage',
  );
  // Deliberately not labelled by tenant: a per-tenant series here would grow
  // unbounded with the customer list. The database row carries the attribution;
  // this is the platform-wide spend curve.
  recordAiTokens(context.feature, credential.source, tokens);

  try {
    const metric = usageMetric(credential.source);
    await prisma.workspaceUsage.upsert({
      where: { tenantId_metric: { tenantId, metric } },
      create: { tenantId, metric, used: tokens, limit: await monthlyLimit(tenantId), measuredAt: new Date() },
      update: { used: { increment: tokens }, measuredAt: new Date() },
    });
  } catch (err) {
    logger.warn({ err, tenantId }, 'could not record ai usage');
  }

  /**
   * The same tokens again, attributed to the model.
   *
   * Its own try/catch, and second: the row above is what the ceiling reads, so
   * a failure to record the breakdown must not cost the deployment its
   * accounting. `limit` is deliberately left null here — the allowance belongs
   * to the workspace's month, not to one model within it, and copying it onto
   * every model row would invite a reader to treat six ceilings as real.
   */
  try {
    const metric = modelUsageMetric(credential.source, context.model);
    await prisma.workspaceUsage.upsert({
      where: { tenantId_metric: { tenantId, metric } },
      create: { tenantId, metric, used: tokens, limit: null, measuredAt: new Date() },
      update: { used: { increment: tokens }, measuredAt: new Date() },
    });
  } catch (err) {
    logger.warn({ err, tenantId, model: context.model }, 'could not record ai model usage');
  }
}
