import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { NotFound, Invalid, Conflict } from '@/lib/errors';
import { callbackSecrets, TelephonyConfigError, UNSIGNED_VENDORS } from '@/lib/integrations/telephony';
import { resolveTelephony } from '@/lib/integrations/telephony/resolve';
import { streamToken } from '@/lib/integrations/telephony/stream';
import { requireVisibleCall } from '@/services/crm/callVisibility';

const params = z.object({ id: z.string().cuid() });

const body = z
  .object({
    /** Ask the vendor to record. Refused unless consent is already on file. */
    record: z.boolean().default(false),
    /**
     * The handset to ring. Defaults to the employee's own number on their user
     * record — the caller should not have to know it, and typing it per call is
     * how the wrong person ends up bridged into a client conversation.
     */
    agentNumber: z.string().min(4).max(30).optional(),
  })
  .strict();

/**
 * Places the outbound leg for a queued call.
 *
 * Which vendor does the placing is a workspace setting, resolved in one place —
 * this route names no vendor. Status, duration and the recording URL arrive
 * later on /api/v1/webhooks/telephony/{webhookKey}.
 */
export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body, auditEvent: 'CALL_STARTED' },
  async ({ ctx, params, body }) => {
    await requireVisibleCall(ctx, params.id);
    const [call, actor] = await Promise.all([
      prisma.call.findFirst({ where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null } }),
      prisma.user.findFirst({ where: { id: ctx.actor.id, tenantId: ctx.tenantId }, select: { phone: true } }),
    ]);
    if (!call) throw NotFound('Call');
    if (!call.recipientNumber) {
      throw Invalid([{ field: 'recipientNumber', code: 'missing', message: 'This call has no number to dial.' }]);
    }
    if (call.externalCallId) throw Conflict('This call has already been placed.');

    const agentNumber = body.agentNumber ?? actor?.phone ?? undefined;
    if (!agentNumber) {
      throw Invalid([
        {
          field: 'agentNumber',
          code: 'missing',
          message: 'Add a phone number to your profile, or supply one for this call, so the platform can ring you.',
        },
      ]);
    }

    let telephony;
    try {
      telephony = await resolveTelephony(ctx.tenantId);
    } catch (err) {
      if (err instanceof TelephonyConfigError) {
        throw Invalid([{ field: 'integration', code: 'not_connected', message: err.message }]);
      }
      throw err;
    }

    // Consent is checked at the point the vendor is told to record, not only at
    // the point the file is stored — the vendor must never hold media the client
    // did not agree to.
    const consent = await prisma.recordingConsent.findFirst({ where: { callId: call.id, tenantId: ctx.tenantId } });
    const consented = Boolean(consent?.consentGiven && !consent.withdrawnAt);
    const wantsRecording = body.record && telephony.recordingEnabled;
    if (wantsRecording && telephony.consentRequired && !consented) {
      throw Invalid([
        { field: 'record', code: 'no_consent', message: 'Record consent before asking the provider to record.' },
      ]);
    }

    // Live coaching: fork the call audio to the realtime engine — only where a
    // public engine URL is configured, the vendor can fork, and consent is on
    // file. Streaming is processing the conversation, same as recording it.
    const stream =
      env.LIVE_STREAM_WS_URL && telephony.provider.capabilities.includes('LIVE_STREAM') && consented
        ? {
            url: `${env.LIVE_STREAM_WS_URL.replace(/\/$/, '')}/twilio-media`,
            parameters: {
              tenantId: ctx.tenantId,
              callId: call.id,
              token: streamToken(ctx.tenantId, call.id),
            },
          }
        : undefined;

    // The callback URL carries the connection key in the path. Vendors that
    // cannot sign their callbacks additionally carry a derived bearer token,
    // because for them the URL is the only credential — see http.urlTokenValid.
    const base = `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/telephony/${telephony.webhookKey}`;
    const callbackUrl = UNSIGNED_VENDORS.includes(telephony.vendor as never)
      ? `${base}?token=${callbackSecrets(telephony.webhookKey).urlToken}&call=${call.id}`
      : `${base}?call=${call.id}`;

    // The caller number is written before the vendor is called, so the answer
    // URL Plivo fetches a second later can read it back.
    await prisma.call.update({
      where: { id: call.id, tenantId: ctx.tenantId },
      data: { callerNumber: telephony.callerNumber, providerName: telephony.vendor },
    });

    try {
      const result = await telephony.provider.initiateCall({
        from: telephony.callerNumber,
        to: call.recipientNumber,
        agentNumber,
        callbackUrl,
        recordingEnabled: wantsRecording,
        stream,
      });

      return prisma.call.update({
        where: { id: call.id, tenantId: ctx.tenantId },
        data: {
          externalCallId: result.externalCallId,
          status: result.event === 'CALL_FAILED' ? 'FAILED' : 'RINGING',
          startedAt: new Date(),
        },
      });
    } catch (err) {
      // A vendor that refused must leave the call dialable again rather than
      // stranded in RINGING with no external id to reconcile against.
      await prisma.call.update({
        where: { id: call.id, tenantId: ctx.tenantId },
        data: { status: 'FAILED', endedAt: new Date() },
      });
      throw err;
    }
  },
);
