import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { AppError, NotFound } from '@/lib/errors';
import { aiProviderKey } from '@/lib/ai/provider';
import { CatalogueUnavailable, modelCatalogue } from '@/lib/ai/catalogue';
import { connectionMetadata, savedCredentials } from '@/lib/integrations/connection';

const params = z.object({ provider: z.literal('gemini') });
// The Provider box may have been changed and not saved yet; list for what is on screen.
const query = z.object({ provider: z.string().max(40).optional() });

/**
 * The models the Model box offers: tool-capable ids from the selected
 * provider's own catalogue. Read with this workspace's stored key (Google's
 * list needs one); the key itself is never returned.
 */
export const GET = route(
  { module: 'integrations', action: 'MANAGE_CONFIGURATION', params, query },
  async ({ ctx, query }) => {
    const stored = await connectionMetadata(ctx.tenantId, 'gemini');
    const provider = aiProviderKey(query.provider) ?? aiProviderKey(stored.provider) ?? 'google';
    const { apiKey = '' } = await savedCredentials(ctx.tenantId, 'gemini');
    if (provider === 'google' && !apiKey) throw NotFound('A saved Google key to list models with');
    try {
      const models = (await modelCatalogue(provider, apiKey)).filter((m) => m.tools);
      return { provider, models: models.map(({ id, label }) => ({ id, label })) };
    } catch (err) {
      if (err instanceof CatalogueUnavailable) throw new AppError(503, 'catalogue-unavailable', err.message);
      throw err;
    }
  },
);
