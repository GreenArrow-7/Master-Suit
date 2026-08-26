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
         * Which vendor the key is *from*, checked before asking anyone.
         *
         * A key carries its origin in its prefix, and the commonest failure here
         * is a good key pointed at the wrong service. Google answers an
         * OpenRouter token with a flat "API key not valid", which reads as a
         * dead key and sends people to re-issue one that was fine.
         */
        const mismatch = keyVendorMismatch(c.apiKey ?? '', c.provider);
        if (mismatch) return { ok: false, detail: mismatch };

        /**
         * OpenRouter keys are Bearer tokens against an OpenAI-compatible
         * endpoint, so the check that proves a Google key says nothing about
         * one. Verifying the wrong way round is worse than not verifying: the
         * screen would read Connected for a key every feature is about to 400
         * on, which is precisely the state this integration was already found
         * in once.
         */
        if (c.provider === 'openrouter') {
          if (!c.model) {
            return {
              ok: false,
              detail:
                'OpenRouter selected but no model is set. It has no default — set one, e.g. google/gemini-2.0-flash-001.',
            };
          }
          /**
           * `vendor: 'openrouter'`, not the registry key. The failure message a
           * reader sees is `<vendor> returned <status>`, and "gemini returned
           * 403" does not say which service refused — so it cannot distinguish
           * a rejected OpenRouter token from a Google key with the Generative
           * Language API switched off, which are opposite fixes.
           */
          const credits = await vendorFetch<{ data?: { label?: string; usage?: number; limit?: number | null } }>({
            vendor: 'openrouter',
            url: 'https://openrouter.ai/api/v1/key',
            headers: { Authorization: `Bearer ${c.apiKey ?? ''}` },
          });
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
          // Named for the service actually asked, for the same reason as above.
          vendor: 'google-ai-studio',
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
    /**
     * The vendor's status *and* its own explanation — never the request, which
     * holds the credential.
     *
     * The status line alone was all that reached the screen, so "gemini returned
     * 403" was shown while the response body said precisely what was wrong. The
     * status names a category; the body names the mistake.
     *
     * Credential values are stripped first: some vendors echo the offending
     * token back, and an integrations screen is where people take screenshots.
     */
    const e = err as { message?: string; detail?: string };
    const detail = redactSecrets([e.message ?? 'Verification failed', e.detail].filter(Boolean).join(' — '), c).slice(
      0,
      240,
    );
    /**
     * A bare status is where this stops being useful. 403 has one overwhelming
     * cause on each side and they are opposite fixes, so the line says which —
     * an operator reading "gemini returned 403" has to go and find that out,
     * and the first place they look is usually the wrong one.
     */
    if (detail.includes('403')) {
      if (detail.startsWith('openrouter')) {
        return {
          ok: false,
          detail: `${detail} — OpenRouter refused the key. It is usually revoked, out of credit, or from a different account.`,
        };
      }
      if (detail.startsWith('google-ai-studio')) {
        return {
          ok: false,
          detail: `${detail} — Google refused the key. Usually the Generative Language API is not enabled on its project, or the key has an HTTP-referrer/IP restriction that a server cannot satisfy. If this key came from OpenRouter, set Provider to openrouter.`,
        };
      }
    }
    return { ok: false, detail };
  }
}

/** Removes any supplied credential value from text destined for a screen. */
function redactSecrets(text: string, credentials: Record<string, string>): string {
  let out = text;
  for (const value of Object.values(credentials)) {
    // Short values are settings like a country code; blanking those would mangle
    // the sentence while protecting nothing.
    if (typeof value === 'string' && value.length >= 8) out = out.split(value).join('[redacted]');
  }
  return out;
}

/**
 * Names a key that belongs to a different service than the one selected.
 *
 * Only unambiguous prefixes are matched. Google does not document a stable shape
 * for every key it issues, so anything not positively identified as somebody
 * else's is passed through to the vendor, which is the real authority on whether
 * it works.
 */
function keyVendorMismatch(apiKey: string, provider: string | undefined): string | undefined {
  const key = apiKey.trim();
  if (!key) return 'No API key is saved for this connection.';
  const usingOpenRouter = provider === 'openrouter';

  if (key.startsWith('sk-or-')) {
    return usingOpenRouter
      ? undefined
      : 'That is an OpenRouter key, but Provider is google. Set Provider to "openrouter" and Model to an OpenRouter id, e.g. google/gemini-2.0-flash-001.';
  }
  if (usingOpenRouter) return undefined; // OpenRouter accepts several key shapes.
  if (key.startsWith('sk-ant-'))
    return 'That is an Anthropic API key. A Google key comes from AI Studio and starts with "AIza".';
  if (key.startsWith('sk-'))
    return 'That is an OpenAI-style key. Either set Provider to "openrouter", or use a Google AI Studio key starting with "AIza".';
  if (key.startsWith('ya29.'))
    return 'That is an OAuth access token, not an API key. Google AI Studio keys start with "AIza".';
  return undefined;
}
