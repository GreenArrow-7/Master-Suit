import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelCascade, runCascade } from '@/lib/ai/cascade';

vi.mock('@/lib/ai/gemini', () => ({ geminiModel: vi.fn(async () => 'primary-model') }));

const transient = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('model cascade', () => {
  afterEach(() => {
    delete process.env.GEMINI_FALLBACK_MODEL;
  });

  it('is the primary model alone unless a fallback is configured', async () => {
    expect(await modelCascade('t')).toEqual(['primary-model']);
    process.env.GEMINI_FALLBACK_MODEL = 'cheap-model';
    expect(await modelCascade('t')).toEqual(['primary-model', 'cheap-model']);
    process.env.GEMINI_FALLBACK_MODEL = 'primary-model';
    expect(await modelCascade('t')).toEqual(['primary-model']);
  });

  it('answers on the fallback after the primary fails transiently, and reports which model answered', async () => {
    const calls: string[] = [];
    const result = await runCascade(
      'test',
      ['primary-model', 'cheap-model'],
      async (model) => {
        calls.push(model);
        if (model === 'primary-model') throw transient(503);
        return 'ok';
      },
      { maxAttempts: 1 },
    );
    expect(result).toEqual({ value: 'ok', model: 'cheap-model' });
    expect(calls).toEqual(['primary-model', 'cheap-model']);
  });

  it('does not cascade on a non-transient failure', async () => {
    const calls: string[] = [];
    await expect(
      runCascade(
        'test',
        ['primary-model', 'cheap-model'],
        async (model) => {
          calls.push(model);
          throw transient(401);
        },
        { maxAttempts: 1 },
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(calls).toEqual(['primary-model']);
  });

  it('surfaces the last error when every model fails transiently', async () => {
    await expect(
      runCascade(
        'test',
        ['a', 'b'],
        async () => {
          throw transient(429);
        },
        { maxAttempts: 1 },
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
});
