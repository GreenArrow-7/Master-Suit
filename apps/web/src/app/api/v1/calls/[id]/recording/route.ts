import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Forbidden } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const createBody = z
  .object({
    storageKey: z.string().min(1).max(1000),
    storageBucket: z.string().max(200).optional(),
    mimeType: z.string().max(100).default('audio/webm'),
    sizeBytes: z.number().int().positive().optional(),
    durationSecs: z.number().int().min(0).optional(),
    retainUntil: z.coerce.date().optional(),
  })
  .strict();

export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, params, body }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');

    // Recording must never begin without consent
    const consent = await prisma.recordingConsent.findUnique({
      where: { callId: params.id },
    });
    if (!consent?.consentGiven || consent.withdrawnAt) {
      throw Forbidden('Cannot store recording without active consent.');
    }

    return prisma.recording.upsert({
      where: { callId: params.id },
      create: { tenantId: ctx.tenantId, callId: params.id, ...body },
      update: body,
    });
  },
);

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params, auditEvent: 'RECORDING_ACCESSED' },
  async ({ ctx, params }) => {
    const recording = await prisma.recording.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
    });
    if (!recording) throw NotFound('Recording');

    await prisma.recording.update({
      where: { callId: params.id },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    });

    return {
      id: recording.id,
      storageKey: recording.storageKey,
      storageBucket: recording.storageBucket,
      mimeType: recording.mimeType,
      sizeBytes: recording.sizeBytes,
      durationSecs: recording.durationSecs,
      createdAt: recording.createdAt,
      accessCount: recording.accessCount + 1,
    };
  },
);
