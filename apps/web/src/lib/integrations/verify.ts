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
