import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { NotFound, Invalid, Conflict } from '@/lib/errors';
import { getTelephonyProvider } from '@/lib/integrations/telephony';

const params = z.object({ id: z.string().cuid() });

const body = z.object({
  /** Ask the provider to record. Refused unless consent is already on file. */
  record: z.boolean().default(false),
}).strict();

/**
 * Places the outbound leg for a queued call. Status, duration and the recording URL
 * arrive later on /api/v1/webhooks/telephony, which matches on externalCallId.
 */
export const POST = route(
  { module: 'calls', action: 'EDIT', params, body, auditEvent: 'CALL_STARTED' },
  async ({ ctx, params, body }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');
    if (!call.recipientNumber) {
      throw Invalid([{ field: 'recipientNumber', code: 'missing', message: 'This call has no number to dial.' }]);
    }
    if (call.externalCallId) throw Conflict('This call has already been placed.');

    const integration = await prisma.integrationConnection.findFirst({
      where: { tenantId: ctx.tenantId, status: 'CONNECTED', provider: { not: 'meta' } },
      orderBy: { updatedAt: 'desc' },
    });
    const credentials = (integration?.credentials ?? {}) as Record<string, string>;
    if (!integration || !credentials.callerNumber) {
      throw Invalid([{ field: 'integration', code: 'not_connected', message: 'Connect a telephony provider with a caller number before dialling.' }]);
    }

    // Recording is consent-gated at the point the provider is told to record, not
    // only at the point the file is stored.
    if (body.record) {
      const consent = await prisma.recordingConsent.findUnique({ where: { callId: call.id } });
      if (!consent?.consentGiven || consent.withdrawnAt) {
        throw Invalid([{ field: 'record', code: 'no_consent', message: 'Record consent before asking the provider to record.' }]);
      }
    }

    const webhookSecret = createHmac('sha256', env.WEBHOOK_SIGNING_PEPPER)
      .update(`telephony:${integration.webhookKey}`)
      .digest('base64url');

    const result = await getTelephonyProvider(integration.provider, { webhookSecret }).initiateCall({
      from: credentials.callerNumber,
      to: call.recipientNumber,
      callbackUrl: `${env.APP_URL}/api/v1/webhooks/telephony`,
      recordingEnabled: body.record,
    });

    return prisma.call.update({
      where: { id: call.id, tenantId: ctx.tenantId },
      data: {
        externalCallId: result.externalCallId,
        providerName: integration.provider,
        status: result.status === 'failed' ? 'FAILED' : 'RINGING',
        callerNumber: credentials.callerNumber,
        startedAt: new Date(),
      },
    });
  },
);
