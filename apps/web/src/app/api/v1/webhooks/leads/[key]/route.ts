import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { consume, limits } from '@/lib/security/ratelimit';
import { decryptCredentials } from '@/lib/integrations/connection';
import { isLeadSource, parseEnquiry, verifyDelivery } from '@/lib/integrations/leadSources';
import { isUniqueViolation } from '@/lib/errors';

/**
 * Enquiries from the property portals and Google Ads lead forms, keyed by the
 * connection's `webhookKey` like the Meta and telephony receivers.
 *
 * The same contract as Meta's: rate limit → look up the connection → verify →
 * store once → queue. Nothing before verification writes anything, and the
 * lead is made by the `webhook` worker (services/leads/intake.ts), so a sender
 * never waits on our database and a failure is retried rather than lost.
 *
 * The answer never says whether the person was already known: a sender that
 * can probe which numbers exist has been handed the customer list.
 */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(req: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  if (!key) return unauthorized();

  try {
    await consume(limits.webhook(key));
  } catch (err) {
    const retryAfter = (err as { retryAfter?: number }).retryAfter;
    return NextResponse.json(
      { error: 'rate limited' },
      { status: 429, headers: retryAfter ? { 'retry-after': String(retryAfter) } : undefined },
    );
  }

  // Raw text: the portals sign the bytes, and re-serialising changes them.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'payload too large' }, { status: 413 });

  const connection = await prisma.integrationConnection.findUnique({ where: { webhookKey: key } });
  // One answer for an unknown key, a disconnected source and a bad signature,
  // so the endpoint is not an oracle for which keys are live.
  if (!connection || connection.status !== 'CONNECTED' || !isLeadSource(connection.provider)) return unauthorized();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('not an object');
  } catch {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
  }

  const { secret } = decryptCredentials((connection.credentials ?? {}) as Record<string, unknown>);
  const signature = req.headers.get('x-signature') ?? req.headers.get('x-hub-signature-256');
  if (!verifyDelivery(connection.provider, secret, raw, payload, signature)) {
    logger.warn(
      { tenantId: connection.tenantId, provider: connection.provider },
      'lead source delivery failed verification',
    );
    return unauthorized();
  }

  const { tenantId } = connection;
  // The sender's idempotency key, else its lead id, else the body's hash: each
  // is what a retry of the same delivery repeats.
  const externalId =
    req.headers.get('idempotency-key')?.slice(0, 200) ||
    parseEnquiry(payload).externalId ||
    createHash('sha256').update(raw, 'utf8').digest('hex');
  const provider = `${connection.provider}:${connection.id}`;

  const job = { tenantId, provider, externalId, source: connection.provider };
  try {
    // Stored before anything interprets it: when a field mapping turns out to
    // be wrong, the fix is a replay rather than leads nobody can prove arrived.
    await prisma.webhookEvent.create({
      // The body as received. Postgres reorders a jsonb object's keys, and the
      // parser reads the sender's order to tell the enquirer from the agent.
      data: { tenantId, provider, externalId, eventType: 'LEAD', payload: raw },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // A retry. The first delivery owns the lead, unless it never reached the
    // queue — which is why the sender is retrying.
    const stored = await prisma.webhookEvent.findUnique({
      where: { tenantId_provider_externalId: { tenantId, provider, externalId } },
      select: { processed: true },
    });
    if (stored?.processed) return NextResponse.json({});
  }

  // `enqueue` logs a queue outage instead of throwing. A 503 makes the sender
  // retry, and the retry re-queues the stored event above; a 200 here would
  // leave it stored and never worked.
  if (!(await enqueue('webhook', 'lead-source.enquiry', job))) {
    return NextResponse.json({ error: 'try again shortly' }, { status: 503 });
  }
  await prisma.integrationConnection
    .update({
      where: { tenantId_provider: { tenantId, provider: connection.provider } },
      data: { lastSyncAt: new Date() },
    })
    .catch(() => {});

  // Google wants 200 and `{}`; the portals accept any 2xx.
  return NextResponse.json({});
}

const unauthorized = () => NextResponse.json({ error: 'invalid webhook authentication' }, { status: 401 });
