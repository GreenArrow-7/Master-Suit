import { handleTelephonyWebhook } from './[key]/route';

/**
 * The header-keyed form of the telephony webhook.
 *
 * Kept for the generic HMAC gateway, which is the one integration that *can* be
 * told to send a header. Every named vendor uses the path-keyed route next door,
 * because Twilio, Plivo, Exotel and Knowlarity accept a URL and nothing else.
 *
 * An absent key is refused, and the rate limit taken before any database work,
 * in the handler.
 */
export async function POST(req: Request) {
  return handleTelephonyWebhook(req.headers.get('x-integration-key') ?? '', req);
}
