/**
 * Does this credential actually work?
 *
 * A connection saved without asking is a "Connected" badge that means "somebody
 * typed something". Every provider here gets one cheap authenticated read at
 * save time, so the board reflects the vendor's opinion rather than ours.
 *
 * The switch is deliberate and is not the vendor branching §35 forbids: that
 * rule is about business logic choosing behaviour by vendor. This is a
 * configuration table that happens to be written as code, next to the registry
 * it serves. No caller ever reaches it with a decision to make.
 */
import { basic, vendorFetch } from './telephony/http';

export type VerifyResult = { ok: true; detail?: string } | { ok: false; detail: string } | { ok: null; detail: string };

const unverifiable = (why: string): VerifyResult => ({ ok: null, detail: why });

export async function verifyConnection(provider: string, c: Record<string, string>): Promise<VerifyResult> {
  try {
    switch (provider) {
      case 'twilio': {
        const a = await vendorFetch<{ friendly_name: string; status: string }>({
          vendor: provider,
          url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}.json`,
          headers: { Authorization: basic(c.accountSid, c.authToken) },
        });
        return a.status === 'active'
          ? { ok: true, detail: a.friendly_name }
          : { ok: false, detail: `Twilio account is ${a.status}` };
      }

      case 'plivo': {
        const a = await vendorFetch<{ name: string }>({
          vendor: provider,
          url: `https://api.plivo.com/v1/Account/${encodeURIComponent(c.authId)}/`,
          headers: { Authorization: basic(c.authId, c.authToken) },
        });
        return { ok: true, detail: a.name };
      }

      case 'exotel': {
        const host = (c.subdomain || 'api.exotel.com').replace(/^https?:\/\//, '').replace(/^@/, '');
        await vendorFetch({
          vendor: provider,
          url: `https://${host}/v1/Accounts/${encodeURIComponent(c.accountSid)}`,
          headers: { Authorization: basic(c.apiKey, c.apiToken) },
        });
        return { ok: true };
      }

      case 'meta': {
        const a = await vendorFetch<{ display_phone_number?: string }>({
          vendor: provider,
          url: `https://graph.facebook.com/v21.0/${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number`,
          headers: { Authorization: `Bearer ${c.accessToken}` },
        });
        return { ok: true, detail: a.display_phone_number };
      }

      case 'google': {
        const a = await vendorFetch<{ id?: string }>({
          vendor: provider,
          url: 'https://www.googleapis.com/calendar/v3/calendars/primary',
          headers: { Authorization: `Bearer ${c.accessToken}` },
        });
        return { ok: true, detail: a.id };
      }

      case 'gemini': {
        /**
         * OpenRouter keys are Bearer tokens against an OpenAI-compatible
         * endpoint, so the check that proves a Google key says nothing about
         * one. Verifying the wrong way round is worse than not verifying: the
         * screen would read Connected for a key every feature is about to 400
         * on, which is precisely the state this integration was already found
         * in once.
         */
        if (c.provider === 'openrouter') {
          const credits = await vendorFetch<{ data?: { label?: string; usage?: number; limit?: number | null } }>({
            vendor: provider,
            url: 'https://openrouter.ai/api/v1/key',
            headers: { Authorization: `Bearer ${c.apiKey ?? ''}` },
          });
          if (!c.model) {
            return {
              ok: false,
              detail:
                'Key accepted, but no model is set. OpenRouter has no default — set one, e.g. google/gemini-2.0-flash-001.',
            };
          }
          const remaining =
            typeof credits.data?.limit === 'number'
              ? `${(credits.data.limit - (credits.data.usage ?? 0)).toFixed(2)} credits remaining`
              : 'no credit limit set';
          return { ok: true, detail: `OpenRouter key valid — ${remaining}. Model ${c.model}.` };
        }

        /**
         * ListModels is the only read that proves a key without spending a
         * generation, and it doubles as the answer to Google retiring model
         * ids — the reply says which ones this key can actually use.
         */
        const models = await vendorFetch<{
          models?: { name?: string; supportedGenerationMethods?: string[] }[];
        }>({
          vendor: provider,
          url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(c.apiKey ?? '')}`,
        });
        const usable = (models.models ?? [])
          .filter((m) => m.name?.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
          .map((m) => m.name!.replace('models/', ''));
        if (usable.length === 0) return { ok: false, detail: 'That key cannot generate with any Gemini model.' };

        /**
         * Names, not a count. When a model id retires the failure is a 404 deep
         * inside a feature; the fix is knowing what to put in the Model field,
         * so the health line is where that answer belongs.
         */
        const chosen = usable.find((n) => n === 'gemini-flash-latest') ?? usable[0]!;
        return { ok: true, detail: `${usable.length} models available, e.g. ${chosen}` };
      }

      case 'knowlarity':
        // Their API has no read that does not place a call or scan a day of logs.
        return unverifiable('Knowlarity has no read-only endpoint to test against.');

      case 'transcription':
        // The engine is chosen per workspace and the three supported ones share
        // no health endpoint. The first transcription is the test.
        return unverifiable('Speech-to-text credentials are proven by the first transcription.');

      default:
        return unverifiable('No verification is defined for this provider.');
    }
  } catch (err) {
    // The vendor's status, never the request: the request holds the credential.
    return { ok: false, detail: (err as Error).message.slice(0, 200) };
  }
}
