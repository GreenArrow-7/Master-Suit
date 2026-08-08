import { NextResponse } from 'next/server';
import { handleTelephonyWebhook } from './[key]/route';

/**
 * The header-keyed form of the telephony webhook.
 *
 * Kept for the generic HMAC gateway, which is the one integration that *can* be
 * told to send a header. Every named vendor uses the path-keyed route next door,
 * because Twilio, Plivo, Exotel and Knowlarity accept a URL and nothing else.
 *
 * The rate limit still happens before any database work — see the handler.
 */
export async function POST(req: Request) {
  const key = req.headers.get('x-integration-key') ?? '';
  if (!key) return NextResponse.json({ error: 'invalid webhook authentication' }, { status: 401 });
  return handleTelephonyWebhook(key, req);
}
