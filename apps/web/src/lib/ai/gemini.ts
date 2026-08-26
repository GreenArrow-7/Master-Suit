/**
 * Which Gemini key a piece of work runs on.
 *
 * Two sources, in this order:
 *
 *   1. The workspace's own key, connected through Settings → Integrations and
 *      encrypted at rest like every other provider credential.
 *   2. `GEMINI_API_KEY` on the deployment, as a shared fallback.
 *
 * The workspace key wins because it is the one somebody chose. A tenant that
 * brings its own key gets its own quota, its own billing and its own data
 * boundary, and a shared deployment key silently overriding that would be the
 * opposite of what connecting it meant.
 *
 * Neither present means the feature runs in clearly-labelled simulation, never
 * a silent failure — see `simulated.ts`.
 */
import { logger } from '../logger';
import { connectionCredentials, connectionMetadata } from '../integrations/connection';
import type { AiProviderKey } from './provider';

/**
 * Which key, and — the part that matters for budgeting — whose it is.
 *
 * A workspace running on its own key spends its own quota against its own
 * Google bill. A workspace running on the deployment's key spends *ours*, and
 * nothing anywhere counted that: one tenant's backlog could exhaust the budget
 * for every tenant, and no record existed of which one did.
 *
 * So the source travels with the key. `lib/ai/usage.ts` meters both and enforces
 * a ceiling on only one of them — capping a workspace's spend on its own
 * credential would be charging them for a limit they are already paying past.
 */
export type GeminiCredential =
  | { key: string; source: 'workspace' | 'deployment'; provider: AiProviderKey }
  | { key: null; source: 'simulated'; provider: AiProviderKey };

/**
 * Which API the workspace's key speaks.
 *
 * A key is not self-describing. An OpenRouter key posted to Google's endpoint
 * is a 400, and a 400 here means every AI feature falls back to simulation
 * while Settings → Integrations still reads Connected — so the provider is a
 * setting an administrator states beside the key, exactly as `transcription`
 * already asks which engine its key belongs to.
 *
 * The deployment key is always Google: `GEMINI_API_KEY` is the name it has
 * always had and the thing it has always held. Bringing another provider is a
 * per-workspace choice.
 */
export async function geminiProvider(tenantId?: string | null): Promise<AiProviderKey> {
  if (!tenantId) return 'google';
  const settings = await connectionMetadata(tenantId, 'gemini').catch(() => ({}) as Record<string, unknown>);
  return settings.provider === 'openrouter' ? 'openrouter' : 'google';
}

/** Resolved per call rather than cached: a key can be rotated mid-session. */
export async function geminiCredential(tenantId?: string | null): Promise<GeminiCredential> {
  if (tenantId) {
    const credentials = await connectionCredentials(tenantId, 'gemini').catch(() => null);
    if (credentials?.apiKey) {
      const provider = await geminiProvider(tenantId);
      /**
       * OpenRouter has no usable default model, so a key with no model beside it
       * is misconfiguration rather than a fallback.
       *
       * Its ids are namespaced and versioned (`vendor/model-revision`) and the
       * catalogue moves; there is no rolling alias to stand in the way
       * `gemini-flash-latest` does for Google. Guessing one reproduces the
       * failure this codebase has already had once — `gemini-2.0-flash` was
       * hardcoded here, Google retired it, and every feature answered 404 into
       * simulation behind a screen saying Connected. Refusing is louder.
       */
      if (provider === 'openrouter' && !(await configuredModel(tenantId))) {
        logger.warn({ tenantId }, 'openrouter selected with no model configured; running simulated');
        return { key: null, source: 'simulated', provider };
      }
      return { key: credentials.apiKey, source: 'workspace', provider };
    }
  }
  const deployment = process.env.GEMINI_API_KEY;
  return deployment
    ? { key: deployment, source: 'deployment', provider: 'google' }
    : { key: null, source: 'simulated', provider: 'google' };
}

/** The workspace's explicitly chosen model id, or null. */
async function configuredModel(tenantId: string): Promise<string | null> {
  const settings = await connectionMetadata(tenantId, 'gemini').catch(() => ({}) as Record<string, unknown>);
  const model = settings.model;
  return typeof model === 'string' && model.trim() ? model.trim() : null;
}

/** The key alone, for callers that only need to know whether one exists. */
export async function geminiKey(tenantId?: string | null): Promise<string | null> {
  return (await geminiCredential(tenantId)).key;
}

/**
 * The model to ask for.
 *
 * Configurable per workspace because Google retires model ids on its own
 * schedule — when one goes, an administrator can move to the replacement
 * without waiting for a deployment.
 */
export async function geminiModel(tenantId?: string | null): Promise<string> {
  if (tenantId) {
    const model = await configuredModel(tenantId);
    if (model) return model;
  }
  /**
   * A rolling alias, not a pinned id. Google retires numbered models on its own
   * schedule — `gemini-2.0-flash` was the hardcoded default here and had already
   * gone, so every AI feature was quietly answering 404 and falling back to
   * simulation while the integration screen said Connected.
   */
  return process.env.GEMINI_MODEL || 'gemini-flash-latest';
}

/** Whether AI features will use a real model for this workspace. */
export async function geminiConfigured(tenantId?: string | null): Promise<boolean> {
  return Boolean(await geminiKey(tenantId));
}
