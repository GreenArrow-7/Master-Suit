import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const consentBody = z
  .object({
    consentGiven: z.literal(true),
    method: z.enum(['VERBAL', 'WRITTEN', 'ELECTRONIC', 'PRE_AUTHORIZED']),
    consentVersion: z.string().max(50).optional(),
  })
  .strict();

export const POST = route(
  {
    module: 'calls',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: consentBody,
    auditEvent: 'CONSENT_RECORDED',
  },
  async ({ ctx, params, body }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');

    const existing = await prisma.recordingConsent.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
    });
    if (existing?.consentGiven && !existing.withdrawnAt) {
      throw Conflict('Consent already recorded for this call.');
    }

    return prisma.recordingConsent.upsert({
      where: { callId: params.id, tenantId: ctx.tenantId },
      create: {
        tenantId: ctx.tenantId,
        callId: params.id,
        consentGiven: true,
        method: body.method,
        consentedBy: ctx.actor.id,
        consentVersion: body.consentVersion ?? '1.0',
        givenAt: new Date(),
      },
      update: {
        consentGiven: true,
        method: body.method,
        consentedBy: ctx.actor.id,
        consentVersion: body.consentVersion ?? '1.0',
        givenAt: new Date(),
        withdrawnAt: null,
      },
    });
  },
);

export const DELETE = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, auditEvent: 'CONSENT_WITHDRAWN' },
  async ({ ctx, params }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');

    const consent = await prisma.recordingConsent.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
    });
    if (!consent || !consent.consentGiven || consent.withdrawnAt) {
      throw NotFound('Active consent');
    }

    return prisma.recordingConsent.update({
      where: { callId: params.id, tenantId: ctx.tenantId },
      data: { consentGiven: false, withdrawnAt: new Date() },
    });
  },
);
