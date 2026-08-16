import { connectionCredentials } from '../integrations/connection';
import { logger } from '../logger';

/**
 * One place that answers "may this tenant talk to Gemini, and as which model?"
 *
 * The key comes from the deployment environment when the operator set one, and
 * otherwise from the tenant's own transcription connection — the same key an
 * administrator pasted into Integrations. Every Gemini feature (transcription,
 * analysis, audits, the assistant, live coaching) resolves through here, so
 * connecting the key once lights all of them up.
 */

const KEY_TTL_MS = 5 * 60_000;
const keyByTenant = new Map<string, { key: string | null; at: number }>();

export async function geminiKeyForTenant(tenantId: string): Promise<string | null> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;

  const cached = keyByTenant.get(tenantId);
  if (cached && Date.now() - cached.at < KEY_TTL_MS) return cached.key;

  // The dedicated Gemini connection is the intended home for the key.
  const own = await connectionCredentials(tenantId, 'gemini').catch(() => null);
  let key = own?.apiKey ?? null;

  if (!key) {
    // Workspaces that connected Gemini as their speech-to-text engine before
    // the AI card existed already pasted the same key there; reuse it rather
    // than asking for it twice.
    const stt = await connectionCredentials(tenantId, 'transcription').catch(() => null);
    const flavour = `${stt?.provider ?? ''} ${stt?.model ?? ''}`.toLowerCase();
    if (stt?.apiKey && (flavour.includes('gemini') || flavour.includes('google'))) key = stt.apiKey;
  }

  keyByTenant.set(tenantId, { key, at: Date.now() });
  return key;
}

/** Drops the cached answer so a just-saved key takes effect immediately. */
export function forgetGeminiKey(tenantId: string) {
  keyByTenant.delete(tenantId);
}

/**
 * Google retires Gemini models on its own clock — two defaults 404ed inside a
 * year, each error naming a successor. Rather than chase the constant in code,
 * ask ListModels what this key can run: keep the preferred model when the list
 * confirms it, otherwise take the newest stable flash generation. Cached per
 * key for the process lifetime.
 */
const modelByKey = new Map<string, string>();

export async function resolveGeminiModel(
  apiKey: string,
  preferred = process.env.GEMINI_MODEL,
): Promise<string> {
  const cached = modelByKey.get(apiKey);
  if (cached) return cached;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) {
    // Discovery denied (network, quota) — the preferred name is still the best
    // guess, and the caller's own request will say if it is wrong.
    return preferred || 'gemini-flash-latest';
  }
  const body = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  const names = (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''));

  let model = preferred && names.includes(preferred) ? preferred : undefined;
  if (!model) {
    // Stable flash models sort newest-first by version; previews churn too fast
    // to depend on.
    model = names
      .filter((n) => /^gemini-[\d.]+-flash$/.test(n))
      .sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]))[0];
  }
  if (!model) throw new Error('This Gemini key lists no model that supports generateContent.');

  modelByKey.set(apiKey, model);
  logger.info({ model, preferred: preferred ?? null }, 'gemini model resolved');
  return model;
}
