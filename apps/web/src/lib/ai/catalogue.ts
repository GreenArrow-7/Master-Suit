import { ENDPOINTS, type AiProviderKey } from './provider';

/**
 * The provider's own list of models, and whether a stored id is on it.
 *
 * The Model box was free text and nothing checked it. A workspace saved its
 * display name, "Google Gemini", as the model id; OpenRouter answered every
 * ONE AI question with 400 "not a valid model ID" while the card read
 * Connected, because the connection test only asked whether the key was live.
 *
 * Three answers, kept apart on purpose: the id is on the list, the id is not
 * (or cannot call tools, which the assistant needs), or the list could not be
 * read. The last is an outage, not a verdict on the id, and must not be
 * reported as one.
 */
export interface CatalogueModel {
  /** What is sent on the wire. */
  id: string;
  /** What a person reads. Never sent. */
  label: string;
  tools: boolean;
}

export type ModelCheck =
  | { ok: true; model: CatalogueModel }
  | { ok: false; reason: 'unknown' | 'no-tools'; suggestions: string[] }
  | { ok: false; reason: 'unavailable'; detail: string };

export class CatalogueUnavailable extends Error {}

const TIMEOUT_MS = 15_000;

async function read(url: string, headers: Record<string, string> = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new CatalogueUnavailable(`the model list could not be reached (${(err as Error).name})`);
  }
  // Status only: a vendor error body can quote the request, key included.
  if (!res.ok) throw new CatalogueUnavailable(`the model list answered ${res.status}`);
  return res.json();
}

/** Throws `CatalogueUnavailable` when the list cannot be read. */
export async function modelCatalogue(provider: AiProviderKey, key: string): Promise<CatalogueModel[]> {
  if (provider === 'openrouter') {
    // Public, but sent with the key so a key-scoped catalogue is what we check against.
    const url = ENDPOINTS.openRouter().replace(/\/chat\/completions$/, '/models');
    const body = await read(url, key ? { Authorization: `Bearer ${key}` } : {});
    return ((body?.data ?? []) as any[])
      .filter((m) => typeof m?.id === 'string')
      .map((m) => ({
        id: m.id,
        label: typeof m.name === 'string' ? m.name : m.id,
        tools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'),
      }));
  }
  // ponytail: first page only (pageSize=1000 covers Google's list today); follow nextPageToken if it ever outgrows it.
  const body = await read(`${ENDPOINTS.googleBase()}?pageSize=1000&key=${encodeURIComponent(key)}`);
  return ((body?.models ?? []) as any[])
    .filter((m) => typeof m?.name === 'string' && m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => {
      const id = m.name.replace(/^models\//, '');
      // generateContent is the method that carries function declarations.
      return { id, label: typeof m.displayName === 'string' ? m.displayName : id, tools: true };
    });
}

export async function checkModel(provider: AiProviderKey, model: string, key: string): Promise<ModelCheck> {
  let list: CatalogueModel[];
  try {
    list = await modelCatalogue(provider, key);
  } catch (err) {
    if (err instanceof CatalogueUnavailable) return { ok: false, reason: 'unavailable', detail: err.message };
    throw err;
  }
  const id = model.trim();
  const found = list.find((m) => m.id === id);
  if (found?.tools) return { ok: true, model: found };
  // A label typed where the id belongs ("Google Gemini") is the case this exists for: offer the ids it names.
  const words = id
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);
  const suggestions = list
    .filter((m) => m.tools && words.some((w) => m.id.toLowerCase().includes(w)))
    .map((m) => m.id)
    .slice(0, 5);
  return { ok: false, reason: found ? 'no-tools' : 'unknown', suggestions };
}

/** One sentence for the person who typed it. */
export function describeCheck(provider: AiProviderKey, model: string, check: Exclude<ModelCheck, { ok: true }>) {
  const vendor = provider === 'openrouter' ? 'OpenRouter' : 'Google';
  if (check.reason === 'unavailable')
    return `${vendor}'s model list could not be checked right now (${check.detail}). Nothing was changed; try again shortly.`;
  const hint = check.suggestions.length ? ` Did you mean ${check.suggestions.join(', ')}?` : '';
  return check.reason === 'no-tools'
    ? `${model} is a ${vendor} model but cannot call tools, which the assistant needs.${hint}`
    : `${model} is not a valid ${vendor} model id. Use the id itself, not its display name.${hint}`;
}
