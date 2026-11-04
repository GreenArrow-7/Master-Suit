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
import { connectionCredentials, connectionMetadata, connectionState } from '../integrations/connection';
import { aiProviderKey, type AiProviderKey } from './provider';

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
  | { key: null; source: 'simulated'; provider: AiProviderKey; reason?: SimulationReason };

/**
 * Why no key was resolved. Absent means the plain case: nobody connected one
 * and the deployment holds none either.
 */
export type SimulationReason =
  /** The workspace connected a key and the connection is not CONNECTED. */
  | 'connection-broken'
  /** OpenRouter chosen with no model beside it; there is no usable default. */
  | 'no-model';

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
  // Read through `aiProviderKey`, not compared: rows saved before the Provider
  // box was validated hold the vendor's own spelling ("Open Router").
  return aiProviderKey(settings.provider) ?? 'google';
}

/** Resolved per call rather than cached: a key can be rotated mid-session. */
export async function geminiCredential(tenantId?: string | null): Promise<GeminiCredential> {
  if (tenantId) {
    /**
     * A broken connection is not an absent one.
     *
     * `connectionCredentials` answers null for a connection in ERROR exactly as
     * it does for a provider nobody ever connected, and the fallback below then
     * ran for both. So a workspace that had chosen its own key, and whose
     * connection had since been marked broken, silently had its prompts and its
     * bill moved onto the deployment's Google account — the one outcome the
     * comment at the top of this file promises will not happen — and was then
     * refused by a deployment budget ceiling it had never agreed to, with its
     * own key sitting unused in the row.
     *
     * The choice is honoured instead: no fallback, and the reason travels so
     * the feature can say that the connection needs re-testing rather than
     * reporting an outage. Nothing switches credentials to make a call succeed.
     *
     * ERROR only, deliberately. DISCONNECTED is the status a row carries before
     * it has ever been verified as well as after it is switched off, so it does
     * not mean "this was working and now is not"; `gemini-key.spec.ts` pins the
     * deployment key as the answer there, and widening this rule to cover it
     * would overturn that decision as a side effect of fixing a different one.
     */
    const state = await connectionState(tenantId, 'gemini').catch(() => null);
    if (state?.status === 'ERROR' && state.storedKeys.includes('apiKey')) {
      logger.warn({ tenantId, status: state.status }, 'gemini connection holds a key but is not connected');
      return { key: null, source: 'simulated', provider: await geminiProvider(tenantId), reason: 'connection-broken' };
    }

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
        return { key: null, source: 'simulated', provider, reason: 'no-model' };
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
