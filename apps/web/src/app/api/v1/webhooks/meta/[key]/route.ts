import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { consume, limits } from '@/lib/security/ratelimit';
import { decryptCredentials } from '@/lib/integrations/connection';
import { MetaWhatsAppProvider } from '@/lib/integrations/whatsapp';
import { normalizeMetaWebhook, type NormalizedMetaEvent } from '@/lib/integrations/meta/events';

/**
 * Meta's callbacks — WhatsApp, Lead Ads, Instagram — keyed by the connection's
 * `webhookKey` in the path, the same shape the telephony receiver uses.
 *
 * The key in the path is *not* authentication. Meta cannot be told to send a
 * custom header, so the key only says which tenant to look up; the app secret
 * signature is what proves the payload came from Meta (§14: never trust an
 * inbound webhook because it contains a tenant id).
 *
 * Order matters and is the security contract, unchanged from telephony:
 *   rate limit → look up connection → verify signature → normalise →
 *   deduplicate → apply.
 * Nothing before verification writes anything.
 */

/**
 * The subscription handshake.
 *
 * Meta GETs the endpoint once when the subscription is created and expects the
 * challenge echoed as plain text. This proves *we* configured the endpoint; it
 * says nothing about any later payload, which is why it uses a different secret
 * and a different method from signature verification.
 */
export async function GET(req: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const params = new URL(req.url).searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode !== 'subscribe' || !token || !challenge) return unauthorized();

  const provider = await providerFor(key);
  if (!provider || !provider.verifySubscription(token)) {
    logger.warn({ keyPrefix: key.slice(0, 6) }, 'meta subscription handshake rejected');
    return unauthorized();
  }

  // Plain text, not JSON: Meta compares the body byte for byte.
  return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
}

export async function POST(req: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  if (!key) return unauthorized();

  // Before the database is touched: this endpoint cannot authenticate a caller
  // until the connection is looked up, so without this anyone who learns the URL
  // can drive queries indefinitely.
  try {
    await consume(limits.webhook(key));
  } catch (err) {
    const retryAfter = (err as { retryAfter?: number }).retryAfter;
    return NextResponse.json(
      { error: 'rate limited' },
      { status: 429, headers: retryAfter ? { 'retry-after': String(retryAfter) } : undefined },
    );
  }

  // Raw text, never a parsed-and-reserialised object: the signature is over
  // bytes, and re-serialising reorders keys and drops whitespace.
  const rawBody = await req.text();

  const connection = await prisma.integrationConnection.findUnique({ where: { webhookKey: key } });
  if (!connection || connection.status !== 'CONNECTED') {
    logger.warn({ keyPrefix: key.slice(0, 6) }, 'meta webhook for unknown or disconnected connection');
    return unauthorized();
  }

  const provider = metaProvider(connection.credentials);
  const signature = req.headers.get('x-hub-signature-256') ?? '';
  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    logger.warn({ tenantId: connection.tenantId }, 'meta webhook failed signature verification');
    return unauthorized();
  }

  let events: NormalizedMetaEvent[];
  try {
    events = normalizeMetaWebhook(JSON.parse(rawBody));
  } catch {
    // Signed by Meta but unparseable. A 400 would be retried forever, so this is
    // recorded and accepted.
    logger.warn({ tenantId: connection.tenantId }, 'meta webhook body was not JSON');
    return NextResponse.json({ ok: true, ignored: true });
  }

  const providerKey = `meta:${connection.id}`;
  let stored = 0;
  let duplicate = 0;
  for (const event of events) {
    // The unique constraint is the whole idempotency story (§16). Meta retries
    // on any non-2xx and redelivers on success often enough that a duplicate is
    // routine rather than an anomaly.
    try {
      await prisma.webhookEvent.create({
        data: {
          tenantId: connection.tenantId,
          provider: providerKey,
          externalId: event.externalId,
          eventType: event.kind,
          // Truncated, and only the normalised event: §57 says not to keep raw
          // provider payloads indefinitely, and these carry message bodies.
          payload: JSON.parse(JSON.stringify(event)),
        },
      });
      stored += 1;
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        // Already seen. Not re-enqueued: the first delivery owns the CRM write,
        // and queuing it again is how one retried callback becomes two leads.
        duplicate += 1;
        continue;
      }
      throw e;
    }

    // Enqueued only after the row is committed, so the worker can always find
    // the event it is asked to stamp.
    await enqueue('webhook', 'meta.event', {
      tenantId: connection.tenantId,
      connectionId: connection.id,
      provider: providerKey,
      externalId: event.externalId,
      event,
    });
  }

  logger.info(
    { tenantId: connection.tenantId, received: events.length, stored, duplicate },
    'meta webhook accepted',
  );

  // Accepted and queued, not applied. §52 and §63: a provider must never wait on
  // our database work, and a failure has to be retryable rather than lost inside
  // this request.
  return NextResponse.json({ ok: true, received: events.length, stored, duplicate });
}

function metaProvider(credentials: unknown) {
  const config = decryptCredentials((credentials ?? {}) as Record<string, unknown>);
  return new MetaWhatsAppProvider({
    accessToken: config.accessToken ?? '',
    phoneNumberId: config.phoneNumberId ?? '',
    appSecret: config.appSecret,
    webhookVerifyToken: config.webhookVerifyToken,
  });
}

async function providerFor(key: string) {
  if (!key) return null;
  const connection = await prisma.integrationConnection.findUnique({ where: { webhookKey: key } });
  if (!connection) return null;
  return metaProvider(connection.credentials);
}

const unauthorized = () => NextResponse.json({ error: 'invalid webhook authentication' }, { status: 401 });
