import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as analysisGet } from '@/app/api/v1/calls/[id]/analysis/route';
import { GET as auditGet } from '@/app/api/v1/calls/[id]/audit/route';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { get } from '../helpers/request';

/**
 * §15/§19 as behaviour, not presence:
 *  - a model that answers with something that is not the schema is never shown as
 *    a model's judgement — the call gets the labelled keyword pass instead;
 *  - a provider outage on the primary AND the fallback model ends the same way,
 *    with the reason in the summary;
 *  - a transient primary failure is answered by the fallback model, attributed;
 *  - the transcript is redacted before it reaches the model;
 *  - another tenant's administrator cannot read a call's analysis or audit.
 */
const generateStructured = vi.fn();
vi.mock('@/lib/ai/provider', () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
  generateText: vi.fn(),
  generateWithTools: vi.fn(),
}));
vi.mock('@/lib/ai/gemini', () => ({
  geminiCredential: vi.fn(async () => ({ key: 'test-key', source: 'workspace', provider: 'google' })),
  geminiModel: vi.fn(async () => 'primary-model'),
  geminiProvider: vi.fn(async () => 'google'),
  geminiKey: vi.fn(async () => 'test-key'),
  geminiConfigured: vi.fn(async () => true),
}));

const transient = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const transcript =
  'Agent: hello. Customer: call me on 050 123 4567 or ayesha@example.com, my card is 4111 1111 1111 1111. It is too expensive.';

describe('AI guardrails and fallbacks', () => {
  afterEach(() => {
    generateStructured.mockReset();
    delete process.env.GEMINI_FALLBACK_MODEL;
  });

  it('a non-JSON model answer degrades to the labelled keyword pass, never a fake result', async () => {
    const { analyzeTranscript } = await import('@/lib/ai/analysis');
    generateStructured.mockResolvedValue({ text: 'Sure! Here is my analysis: the customer seems keen.', usage: {} });
    const out = await analyzeTranscript({ tenantId: 't1', transcript });
    expect(out.modelId).toBe('demo-simulation');
    expect(out.result.summary).toMatch(/Model analysis was skipped/);
    expect(out.result.uncertainItems[0]).toMatch(/Keyword analysis only/);
  });

  it('outage on primary and fallback degrades with the reason; a transient primary failure is answered by the fallback', async () => {
    const { analyzeTranscript } = await import('@/lib/ai/analysis');
    process.env.GEMINI_FALLBACK_MODEL = 'cheap-model';

    generateStructured.mockRejectedValue(transient(503));
    const down = await analyzeTranscript({ tenantId: 't1', transcript });
    expect(down.modelId).toBe('demo-simulation');
    expect(down.result.summary).toMatch(/could not be reached/);
    const modelsTried = generateStructured.mock.calls.map((c) => (c[0] as { model: string }).model);
    expect(new Set(modelsTried)).toEqual(new Set(['primary-model', 'cheap-model']));

    generateStructured.mockReset();
    generateStructured.mockImplementation(async (req: { model: string }) => {
      if (req.model === 'primary-model') throw transient(429);
      return {
        text: JSON.stringify({
          summary: 'ok',
          clientNeeds: [],
          objections: ['price'],
          commitments: [],
          buyingSignals: [],
          risks: [],
          nextSteps: [],
          actionItems: [],
          topicsDiscussed: [],
          topicsMissed: [],
          sentiment: 'NEUTRAL',
          sentimentScore: 0.5,
          suggestedStatus: null,
          complianceFlags: [],
          uncertainItems: [],
          qualificationAnswers: [],
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });
    const answered = await analyzeTranscript({ tenantId: 't1', transcript });
    expect(answered.modelId).toBe('cheap-model');
    expect(answered.result.objections).toContain('price');
  }, 60_000);

  it('the transcript reaches the model redacted', async () => {
    const { analyzeTranscript } = await import('@/lib/ai/analysis');
    generateStructured.mockRejectedValue(transient(401));
    await analyzeTranscript({ tenantId: 't1', transcript });
    const prompt = (generateStructured.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).not.toContain('4111 1111 1111 1111');
    expect(prompt).not.toContain('ayesha@example.com');
    expect(prompt).not.toContain('050 123 4567');
    expect(prompt).toContain('too expensive');
  });
});

describe('cross-tenant reads of call intelligence', () => {
  let fixture: Fixture;
  let callId = '';
  beforeAll(async () => {
    fixture = await seedTwoTenants();
    const call = await prisma.call.create({
      data: {
        tenantId: fixture.a.tenantId,
        leadId: fixture.a.leadIds[0],
        callerId: fixture.a.userId,
        status: 'COMPLETED',
      },
    });
    callId = call.id;
  });
  afterAll(async () => {
    await fixture.cleanup();
  });

  it("tenant B's administrator gets 404, not the row, for tenant A's analysis and audit", async () => {
    const a = await get(analysisGet, `/api/v1/calls/${callId}/analysis`, fixture.b.cookie, { id: callId });
    expect(a.status, JSON.stringify(a.body).slice(0, 300)).toBe(404);
    const b = await get(auditGet, `/api/v1/calls/${callId}/audit`, fixture.b.cookie, { id: callId });
    expect(b.status, JSON.stringify(b.body).slice(0, 300)).toBe(404);
  });
});
