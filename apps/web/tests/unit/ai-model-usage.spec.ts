/**
 * Attributing AI spend to the model that produced it.
 *
 * The console could say what a workspace spent but not what it was running, so
 * "which model is this customer on" had no answer — the model was known at the
 * call site, logged, and dropped.
 *
 * The dimension is carried in a *second* metric series rather than added to
 * `ai_tokens:`, because that key is what `assertAiBudget` reads to decide
 * whether to refuse work. These tests pin both halves of that decision: the key
 * survives a round trip, and the model series stays out of the budget series.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_METRIC_PREFIX,
  AI_MODEL_METRIC_PREFIX,
  modelUsageMetric,
  parseModelMetric,
  usageMetric,
} from '@/lib/ai/usage';
import { aggregateModels, type UsageRow } from '@/app/(platform)/platform/ai-usage/aggregate';

const AUGUST = new Date(Date.UTC(2026, 7, 15));
const row = (tenantId: string, metric: string, used: number, measuredAt = AUGUST): UsageRow => ({
  tenantId,
  metric,
  used,
  measuredAt,
});

describe('the model metric key', () => {
  it('round-trips payer, model and period', () => {
    const metric = modelUsageMetric('deployment', 'gemini-2.5-flash', AUGUST);
    expect(metric).toBe('ai_model:deployment:gemini-2.5-flash:2026-08');
    expect(parseModelMetric(metric)).toEqual({
      paidBy: 'deployment',
      model: 'gemini-2.5-flash',
      period: '2026-08',
    });
  });

  it('constrains a vendor string rather than trusting it', () => {
    // Model ids come from a vendor and end up in a unique key. Colons would
    // corrupt the parse; spaces and case would split one model into several.
    expect(modelUsageMetric('workspace', 'Gemini 2.0 Pro', AUGUST)).toBe('ai_model:workspace:gemini-2.0-pro:2026-08');
    expect(modelUsageMetric('workspace', 'weird::model//v1', AUGUST)).toBe('ai_model:workspace:weird-model-v1:2026-08');
  });

  it('keeps a row attributable when the provider reports no model', () => {
    expect(modelUsageMetric('deployment', '', AUGUST)).toBe('ai_model:deployment:unknown:2026-08');
  });

  it('is a different series from the one the budget reads', () => {
    // The guarantee that matters: a mistake in model attribution cannot reach
    // assertAiBudget, because the ceiling's query never matches these rows.
    const budget = usageMetric('deployment', AUGUST);
    const model = modelUsageMetric('deployment', 'gemini-2.5-flash', AUGUST);
    expect(budget.startsWith(AI_METRIC_PREFIX)).toBe(true);
    expect(model.startsWith(AI_METRIC_PREFIX)).toBe(false);
    expect(model.startsWith(AI_MODEL_METRIC_PREFIX)).toBe(true);
  });

  it('ignores anything that is not a model metric', () => {
    expect(parseModelMetric(usageMetric('deployment', AUGUST))).toBeNull();
    expect(parseModelMetric('ai_model:broken')).toBeNull();
  });
});

describe('aggregateModels', () => {
  it('splits a workspace by model, and by whose key paid', () => {
    const out = aggregateModels([
      row('t1', modelUsageMetric('deployment', 'gemini-2.5-flash', AUGUST), 100),
      row('t1', modelUsageMetric('workspace', 'gemini-2.5-flash', AUGUST), 40),
      row('t1', modelUsageMetric('deployment', 'gemini-2.5-pro', AUGUST), 900),
    ]);

    // Heaviest first: the question is "what is this customer running", and the
    // answer is usually the top line.
    expect(out.map((m) => m.model)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);

    const flash = out.find((m) => m.model === 'gemini-2.5-flash')!;
    expect(flash).toMatchObject({ deployment: 100, workspace: 40, total: 140 });
  });

  it('keeps two workspaces on the same model apart', () => {
    const out = aggregateModels([
      row('t1', modelUsageMetric('deployment', 'gemini-2.5-flash', AUGUST), 10),
      row('t2', modelUsageMetric('deployment', 'gemini-2.5-flash', AUGUST), 25),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.tenantId).sort()).toEqual(['t1', 't2']);
  });

  it('reports the most recent timestamp for a model', () => {
    const later = new Date(Date.UTC(2026, 7, 20));
    const out = aggregateModels([
      row('t1', modelUsageMetric('deployment', 'gemini-2.5-flash', AUGUST), 10, AUGUST),
      row('t1', modelUsageMetric('workspace', 'gemini-2.5-flash', AUGUST), 10, later),
    ]);
    expect(out[0].measuredAt).toEqual(later);
  });

  it('skips budget rows entirely, so the two series cannot be double-counted', () => {
    const out = aggregateModels([
      row('t1', usageMetric('deployment', AUGUST), 5_000),
      row('t1', modelUsageMetric('deployment', 'gemini-2.5-flash', AUGUST), 10),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(10);
  });
});
