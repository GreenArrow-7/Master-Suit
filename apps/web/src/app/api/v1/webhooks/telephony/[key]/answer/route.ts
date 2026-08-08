import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { consume, limits } from '@/lib/security/ratelimit';
import { decryptCredentials } from '@/lib/integrations/connection';
import { telephonyProvider } from '@/lib/integrations/telephony';
import { xml } from '@/lib/integrations/telephony/http';

/**
 * Call control for the vendors that fetch it rather than accept it inline.
 *
 * Plivo has no equivalent of Twilio's `Twiml` parameter: the only way to say
 * "bridge this agent to that client" is to host a document Plivo fetches when
 * the agent answers. This is that document.
 *
 * The client's number is **not** a query parameter. It is looked up from the
 * Call row named by `call`, so the endpoint cannot be turned into an open relay
 * that dials an arbitrary number on the tenant's account — the worst an attacker
 * with a valid signature can do is re-read a call they were already able to see.
 */
export async function POST(req: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  if (!key) return refuse();

  try {
    await consume(limits.webhook(key));
  } catch {
    return refuse(429);
  }

  const rawBody = await req.text();
  const connection = await prisma.integrationConnection.findUnique({ where: { webhookKey: key } });
  if (!connection || connection.status !== 'CONNECTED') return refuse();

  const incoming = new URL(req.url);
  const request = {
    url: `${env.APP_URL.replace(/\/$/, '')}${incoming.pathname}${incoming.search}`,
    rawBody,
    headers: req.headers,
  };

  try {
    const provider = telephonyProvider(
      connection.provider,
      decryptCredentials((connection.credentials ?? {}) as Record<string, unknown>),
      connection.webhookKey,
    );
    if (!provider.validateWebhook(request)) return refuse();
  } catch {
    return refuse();
  }

  const callId = incoming.searchParams.get('call') ?? '';
  const call = await prisma.call.findFirst({
    where: { id: callId, tenantId: connection.tenantId, deletedAt: null },
    select: { recipientNumber: true, callerNumber: true },
  });
  if (!call?.recipientNumber || !call.callerNumber) {
    logger.warn({ vendor: connection.provider }, 'answer URL hit for a call with no numbers');
    return refuse(404);
  }

  const record = (connection.metadata as Record<string, unknown> | null)?.recordingEnabled !== false;
  const callbackUrl = `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/telephony/${connection.webhookKey}`;

  const document =
    `<Response><Dial callerId="${xml(call.callerNumber)}"` +
    (record ? ` record="true" callbackUrl="${xml(callbackUrl)}" callbackMethod="POST"` : '') +
    `><Number>${xml(call.recipientNumber)}</Number></Dial></Response>`;

  return new Response(document, {
    status: 200,
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      // Call control is per-call and must never be served from a cache.
      'cache-control': 'no-store',
      etag: `"${createHash('sha256').update(document).digest('hex').slice(0, 16)}"`,
    },
  });
}

const refuse = (status = 401) =>
  new Response('<Response><Hangup/></Response>', {
    status,
    headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
