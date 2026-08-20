import { prisma } from '../db';
import { Forbidden } from '../errors';
import { logger } from '../logger';
import type { GeminiCredential } from './gemini';

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
 * It has no period dimension, so the month goes in the metric key:
 * `ai_tokens:2026-08`. That keeps this to no migration, gives history for free,
 * and each month's row is a natural candidate for the retention sweep later.
 */

/** `ai_tokens:2026-08`. UTC, so a workspace's month does not depend on its timezone. */
export function usageMetric(at: Date = new Date()): string {
  return `ai_tokens:${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The plan limit key an operator sets on a SubscriptionPlan to cap this. */
export const AI_TOKEN_LIMIT_KEY = 'ai_tokens_monthly';

/** Gemini's own accounting, as returned on every generateContent response. */
export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

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

async function usedThisMonth(tenantId: string): Promise<number> {
  const row = await prisma.workspaceUsage.findUnique({
    where: { tenantId_metric: { tenantId, metric: usageMetric() } },
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

  const used = await usedThisMonth(tenantId);
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
  usage: UsageMetadata | undefined,
  context: { feature: string; model: string },
): Promise<void> {
  if (!tenantId || credential.source === 'simulated') return;

  const tokens = usage?.totalTokenCount ?? (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0);
  if (!tokens) return;

  // Logged whatever happens next, so the attribution survives even if the write
  // does not — a log line is the only thing that was here before, and it had no
  // token count in it.
  logger.info(
    { tenantId, tokens, model: context.model, feature: context.feature, keySource: credential.source },
    'ai usage',
  );

  try {
    const metric = usageMetric();
    await prisma.workspaceUsage.upsert({
      where: { tenantId_metric: { tenantId, metric } },
      create: { tenantId, metric, used: tokens, limit: await monthlyLimit(tenantId), measuredAt: new Date() },
      update: { used: { increment: tokens }, measuredAt: new Date() },
    });
  } catch (err) {
    logger.warn({ err, tenantId }, 'could not record ai usage');
  }
}
