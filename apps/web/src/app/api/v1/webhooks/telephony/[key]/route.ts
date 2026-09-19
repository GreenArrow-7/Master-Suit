import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { consume, limits } from '@/lib/security/ratelimit';
import { decryptCredentials } from '@/lib/integrations/connection';
import { telephonyProvider } from '@/lib/integrations/telephony';
import { TERMINAL_EVENTS, type CallEvent, type CallEventKind } from '@/lib/integrations/telephony/types';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { touchLead } from '@/services/leads/touch';

/**
 * Every vendor's callbacks land here, keyed by the connection's `webhookKey` in
 * the path.
 *
 * The key is in the path and not a header because real vendors cannot be told to
 * send a header: Twilio, Plivo, Exotel and Knowlarity all take a URL and nothing
 * else. The header form still works at the parent route for the generic HMAC
 * gateway.
 *
 * Order matters and is the security contract:
 *   rate limit → look up connection → validate the vendor's own signature →
 *   parse → deduplicate → apply.
 * Nothing before validation writes anything, and nothing after it trusts the
 * vendor's status vocabulary — `parseWebhook` normalises it first.
 */

/** Normalised event → the columns it changes on Call. */
const CALL_STATUS: Record<CallEventKind, string | null> = {
  CALL_INITIATED: 'RINGING',
  CALL_RINGING: 'RINGING',
  CALL_CONNECTED: 'IN_PROGRESS',
  CALL_COMPLETED: 'COMPLETED',
  CALL_FAILED: 'FAILED',
  CALL_BUSY: 'MISSED',
  CALL_NO_ANSWER: 'MISSED',
  RECORDING_AVAILABLE: null,
  RECORDING_FAILED: null,
};

/** Only set when the employee has not already recorded their own disposition. */
const CALL_OUTCOME: Partial<Record<CallEventKind, string>> = {
  CALL_BUSY: 'BUSY',
  CALL_NO_ANSWER: 'NO_ANSWER',
};

/**
 * Callbacks arrive out of order often enough that it cannot be treated as an
 * anomaly — a "completed" that overtakes a "ringing" is routine. Rank guards
 * against a late early-state callback reopening a finished call.
 */
const RANK: Record<string, number> = { SCHEDULED: 0, RINGING: 1, IN_PROGRESS: 2, MISSED: 3, FAILED: 3, COMPLETED: 4 };

export async function handleTelephonyWebhook(webhookKey: string, req: Request): Promise<Response> {
  if (!webhookKey) return unauthorized();

  // Before the database is touched. This endpoint cannot authenticate a caller
  // until the connection has been looked up, so without this anyone who learns
  // the URL can drive queries indefinitely.
  try {
    await consume(limits.webhook(webhookKey));
  } catch (err) {
    const retryAfter = (err as { retryAfter?: number }).retryAfter;
    return NextResponse.json(
      { error: 'rate limited' },
      { status: 429, headers: retryAfter ? { 'retry-after': String(retryAfter) } : undefined },
    );
  }

  const rawBody = await req.text();
  const connection = await prisma.integrationConnection.findUnique({ where: { webhookKey } });
  if (!connection || connection.status !== 'CONNECTED') {
    logger.warn({ keyPrefix: webhookKey.slice(0, 6) }, 'telephony webhook for unknown or disconnected connection');
    return unauthorized();
  }

  // The URL the vendor signed is the one we gave it, built from APP_URL — not
  // `req.url`, which behind a proxy is whatever the last hop rewrote it to.
  const incoming = new URL(req.url);
  const request = {
    url: `${env.APP_URL.replace(/\/$/, '')}${incoming.pathname}${incoming.search}`,
    rawBody,
    headers: req.headers,
  };

  let event: CallEvent;
  try {
    const provider = telephonyProvider(
      connection.provider,
      decryptCredentials((connection.credentials ?? {}) as Record<string, unknown>),
      connection.webhookKey,
    );
    if (!provider.validateWebhook(request)) {
      logger.warn({ vendor: connection.provider }, 'telephony webhook failed authentication');
      return unauthorized();
    }
    event = provider.parseWebhook(request);
  } catch (err) {
    logger.warn({ vendor: connection.provider, err: (err as Error).message }, 'telephony webhook rejected');
    // A provider that cannot be constructed is our configuration problem, not a
    // malformed delivery — but the vendor gets the same terse answer either way.
    return NextResponse.json({ error: 'malformed payload' }, { status: 400 });
  }

  // ── Deduplicate ───────────────────────────────────────────────────────────
  // Vendors retry on any non-2xx and several retry on success too. The unique
  // constraint is the whole idempotency story; a duplicate is a fast 200.
  const providerKey = `telephony:${connection.id}`;
  const externalId = event.deliveryId || createHash('sha256').update(rawBody).digest('hex').slice(0, 40);
  try {
    await prisma.webhookEvent.create({
      data: {
        tenantId: connection.tenantId,
        provider: providerKey,
        externalId,
        eventType: event.event,
        payload: { raw: rawBody.slice(0, 8_000) },
      },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ ok: true, skipped: true });
    throw e;
  }

  const finish = (errorMessage?: string) =>
    prisma.webhookEvent.update({
      where: { tenantId_provider_externalId: { tenantId: connection.tenantId, provider: providerKey, externalId } },
      data: { processed: true, processedAt: new Date(), errorMessage },
    });

  let call = await prisma.call.findFirst({
    where: {
      tenantId: connection.tenantId,
      providerName: connection.provider,
      externalCallId: event.externalCallId,
    },
  });

  // An inbound call: no row exists because nobody here placed it. Create it,
  // matched to the lead (or contact) whose number is calling, owned by that
  // record's owner — so the call lands in the right history from its first ring.
  if (!call && event.direction === 'INBOUND' && event.from && !event.event.startsWith('RECORDING')) {
    call = await createInboundCall(connection, event);
  }

  if (!call) {
    // A callback that overtook the response to the create request, or an inbound
    // call from a vendor whose payload names no caller. Recorded and dropped
    // rather than retried forever.
    logger.warn({ vendor: connection.provider }, 'telephony webhook for unknown call');
    await finish('call not found');
    return NextResponse.json({ ok: true, ignored: true });
  }

  await applyCallEvent(call, event);
  if (event.event === 'CALL_COMPLETED') await touchLead(call.tenantId, call.leadId, event.occurredAt);

  if (event.event === 'RECORDING_AVAILABLE' && event.recordingUrl) {
    await storeRecording(connection, call, event);
  }

  await finish();
  return NextResponse.json({ ok: true });
}

/**
 * Who answers an inbound call in the CRM: the owner of the lead or contact with
 * that number; otherwise the most senior active user, so the call is still
 * recorded and can be re-linked by hand. Nothing is created when the workspace
 * has no active user at all.
 */
async function createInboundCall(connection: { id: string; tenantId: string; provider: string }, event: CallEvent) {
  const tenantId = connection.tenantId;
  const phoneNormalized = normalizePhone(event.from!);
  const [lead, contact] = await Promise.all([
    phoneNormalized
      ? prisma.lead.findFirst({
          where: { tenantId, phoneNormalized, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, ownerId: true },
        })
      : null,
    phoneNormalized
      ? prisma.contact.findFirst({
          where: { tenantId, phoneNormalized, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, ownerId: true, accountId: true },
        })
      : null,
  ]);
  const ownerId = lead?.ownerId ?? contact?.ownerId ?? null;
  const callerId =
    ownerId ??
    (
      await prisma.user.findFirst({
        where: { tenantId, status: 'ACTIVE', deletedAt: null },
        orderBy: { role: { rank: 'asc' } },
        select: { id: true },
      })
    )?.id;
  if (!callerId) {
    logger.warn({ vendor: connection.provider, tenantId }, 'inbound call with no user to record it against');
    return null;
  }
  const created = await prisma.call.create({
    data: {
      tenantId,
      callerId,
      leadId: lead?.id ?? null,
      contactId: contact?.id ?? null,
      accountId: contact?.accountId ?? null,
      direction: 'INBOUND',
      status: 'RINGING',
      externalCallId: event.externalCallId,
      providerName: connection.provider,
      callerNumber: event.from,
      recipientNumber: event.to ?? null,
      startedAt: event.occurredAt,
    },
  });
  logger.info(
    { vendor: connection.provider, callId: created.id, matched: lead ? 'lead' : contact ? 'contact' : 'none' },
    'inbound call created',
  );
  return created;
}

async function applyCallEvent(
  call: { id: string; tenantId: string; status: string; outcome: string | null },
  event: CallEvent,
) {
  const nextStatus = CALL_STATUS[event.event];
  const data: Record<string, unknown> = {};

  if (nextStatus && (RANK[nextStatus] ?? 0) >= (RANK[call.status] ?? 0)) {
    data.status = nextStatus;
    if (event.event === 'CALL_CONNECTED') data.answeredAt = event.occurredAt;
    if (TERMINAL_EVENTS.includes(event.event)) data.endedAt = event.occurredAt;
  }

  if (event.durationSecs != null) data.durationSecs = event.durationSecs;

  const outcome = CALL_OUTCOME[event.event];
  if (outcome && !call.outcome) data.outcome = outcome;

  if (Object.keys(data).length === 0) return;
  await prisma.call.update({ where: { id: call.id, tenantId: call.tenantId }, data });
}

/**
 * Consent is re-checked here, not only at dial time.
 *
 * A client can withdraw during the call. The vendor was told to record when the
 * call started and will deliver the media regardless; refusing to persist a
 * reference to it is the point at which that withdrawal takes effect on our side.
 */
async function storeRecording(
  connection: { id: string; tenantId: string; provider: string },
  call: { id: string; tenantId: string },
  event: CallEvent,
) {
  const consent = await prisma.recordingConsent.findFirst({
    where: { callId: call.id, tenantId: call.tenantId },
  });
  if (!consent?.consentGiven || consent.withdrawnAt) {
    logger.info({ callId: call.id }, 'recording available but consent is absent or withdrawn — discarded');
    return;
  }

  // `storageKey` holds the vendor URL only until the ingest job replaces it with
  // our own object key. `storageBucket: 'provider'` marks that state, and the
  // download route refuses to serve a recording still in it — a vendor URL must
  // never reach a browser (§7).
  const recording = await prisma.recording.upsert({
    where: { callId: call.id, tenantId: call.tenantId },
    create: {
      tenantId: call.tenantId,
      callId: call.id,
      storageKey: event.recordingUrl!,
      storageBucket: 'provider',
      mimeType: 'audio/mpeg',
      durationSecs: event.durationSecs ?? null,
    },
    update: { durationSecs: event.durationSecs ?? null },
  });

  if (recording.storageBucket === 'provider') {
    await enqueue('media', 'recording.ingest', {
      tenantId: call.tenantId,
      callId: call.id,
      connectionId: connection.id,
      url: event.recordingUrl,
    });
  }
}

const unauthorized = () => NextResponse.json({ error: 'invalid webhook authentication' }, { status: 401 });

export async function POST(req: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  return handleTelephonyWebhook(key, req);
}
