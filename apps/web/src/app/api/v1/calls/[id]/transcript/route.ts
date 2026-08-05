import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Forbidden } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const createBody = z.object({
  content: z.string().min(1).max(500_000),
  language: z.string().max(10).default('en'),
  provider: z.string().max(50).optional(),
  confidence: z.number().min(0).max(1).optional(),
}).strict();

export const POST = route(
  { module: 'calls', action: 'EDIT', params, body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, params, body }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');

    const consent = await prisma.recordingConsent.findUnique({ where: { callId: params.id } });
    if (!consent?.consentGiven || consent.withdrawnAt) {
      throw Forbidden('Cannot store transcript without active recording consent.');
    }

    const wordCount = body.content.split(/\s+/).filter(Boolean).length;

    return prisma.transcript.upsert({
      where: { callId: params.id },
      create: { tenantId: ctx.tenantId, callId: params.id, wordCount, ...body },
      update: { wordCount, ...body },
    });
  },
);

export const GET = route(
  { module: 'calls', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const transcript = await prisma.transcript.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
    });
    if (!transcript) throw NotFound('Transcript');
    return transcript;
  },
);
