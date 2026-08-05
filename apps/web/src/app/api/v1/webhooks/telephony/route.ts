import { NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { getTelephonyProvider } from '@/lib/integrations/telephony';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-webhook-signature') ?? '';
  const timestamp = req.headers.get('x-webhook-timestamp') ?? '';
  const webhookId = req.headers.get('x-webhook-id') ?? '';
  const integrationKey = req.headers.get('x-integration-key') ?? '';

  if (!signature || !timestamp || !webhookId || !integrationKey) {
    return NextResponse.json({ error: 'invalid webhook authentication' }, { status: 401 });
  }

  const integration = await prisma.integrationConnection.findUnique({
    where: { webhookKey: integrationKey },
  });
  if (!integration || integration.status !== 'CONNECTED') {
    logger.warn({ integrationKeyPrefix: integrationKey.slice(0, 6) }, 'unknown telephony integration');
    return NextResponse.json({ error: 'invalid webhook authentication' }, { status: 401 });
  }

  const webhookSecret = createHmac('sha256', env.WEBHOOK_SIGNING_PEPPER)
    .update(`telephony:${integration.webhookKey}`)
    .digest('base64url');
  const provider = getTelephonyProvider(integration.provider, { webhookSecret });

  if (!provider.verifyWebhookSignature(rawBody, signature, timestamp)) {
    logger.warn({ provider: provider.name }, 'telephony webhook signature invalid');
    return NextResponse.json({ error: 'invalid webhook authentication' }, { status: 401 });
  }

  let payload;
  try {
    payload = provider.parseWebhook(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: 'malformed payload' }, { status: 400 });
  }

  // Idempotent: skip if already processed
  const providerKey = `telephony:${integration.id}`;
  try {
    await prisma.webhookEvent.create({
      data: {
        tenantId: integration.tenantId,
        provider: providerKey,
        externalId: webhookId,
        eventType: payload.status,
        payload: JSON.parse(rawBody),
      },
    });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ ok: true, skipped: true });
    }
    throw e;
  }

  // Find and update the call
  const call = await prisma.call.findFirst({
    where: {
      tenantId: integration.tenantId,
      providerName: integration.provider,
      externalCallId: payload.externalCallId,
    },
  });

  if (!call) {
    logger.warn({ externalCallId: payload.externalCallId }, 'webhook for unknown call');
    await prisma.webhookEvent.update({
      where: {
        tenantId_provider_externalId: {
          tenantId: integration.tenantId, provider: providerKey, externalId: webhookId,
        },
      },
      data: { processed: true, processedAt: new Date(), errorMessage: 'call not found' },
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  const statusMap: Record<string, string> = {
    initiated: 'RINGING',
    ringing: 'RINGING',
    in_progress: 'IN_PROGRESS',
    completed: 'COMPLETED',
    failed: 'FAILED',
  };

  const data: Record<string, unknown> = {};
  const mappedStatus = statusMap[payload.status];
  if (mappedStatus) data.status = mappedStatus;
  if (payload.duration != null) data.durationSecs = payload.duration;
  if (payload.status === 'completed' || payload.status === 'failed') {
    data.endedAt = new Date(payload.timestamp);
  }

  if (Object.keys(data).length > 0) {
    await prisma.call.update({
      where: { tenantId: integration.tenantId, id: call.id },
      data,
    });
  }

  // Store recording reference if provided and consent was given
  if (payload.recordingUrl) {
    const consent = await prisma.recordingConsent.findFirst({
      where: { tenantId: integration.tenantId, callId: call.id },
    });

    if (consent?.consentGiven && !consent.withdrawnAt) {
      await prisma.recording.upsert({
        where: { callId: call.id },
        create: {
          tenantId: call.tenantId,
          callId: call.id,
          storageKey: payload.recordingUrl,
          mimeType: 'audio/wav',
          durationSecs: payload.duration ?? null,
        },
        update: {
          storageKey: payload.recordingUrl,
          durationSecs: payload.duration ?? null,
        },
      });
    } else {
      logger.info({ callId: call.id }, 'recording URL received but no consent — discarded');
    }
  }

  await prisma.webhookEvent.update({
    where: {
      tenantId_provider_externalId: {
        tenantId: integration.tenantId, provider: providerKey, externalId: webhookId,
      },
    },
    data: { processed: true, processedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
