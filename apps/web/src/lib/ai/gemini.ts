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
import { connectionCredentials, connectionMetadata } from '../integrations/connection';

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
export type GeminiCredential = { key: string; source: 'workspace' | 'deployment' } | { key: null; source: 'simulated' };

/** Resolved per call rather than cached: a key can be rotated mid-session. */
export async function geminiCredential(tenantId?: string | null): Promise<GeminiCredential> {
  if (tenantId) {
    const credentials = await connectionCredentials(tenantId, 'gemini').catch(() => null);
    if (credentials?.apiKey) return { key: credentials.apiKey, source: 'workspace' };
  }
  const deployment = process.env.GEMINI_API_KEY;
  return deployment ? { key: deployment, source: 'deployment' } : { key: null, source: 'simulated' };
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
    const settings = await connectionMetadata(tenantId, 'gemini').catch(() => ({}) as Record<string, unknown>);
    const model = settings.model;
    if (typeof model === 'string' && model.trim()) return model.trim();
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
