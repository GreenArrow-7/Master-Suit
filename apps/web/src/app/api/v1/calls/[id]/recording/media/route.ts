import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { getObject } from '@/lib/storage';

const params = z.object({ id: z.string().cuid() });

/**
 * The only way to the bytes of a call recording.
 *
 * Not a pre-signed URL: a pre-signed URL is a bearer token for a client's
 * conversation that works for anyone who obtains it, cannot be revoked when
 * consent is withdrawn, and writes no audit row on use. Streaming through an
 * authorised handler costs a hop and keeps all three.
 *
 * Consent is re-checked on every read, so withdrawing consent takes effect
 * immediately for playback and not only for future recordings.
 */
export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params, auditEvent: 'RECORDING_ACCESSED' },
  async ({ ctx, params }) => {
    const [recording, consent] = await Promise.all([
      prisma.recording.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } }),
      prisma.recordingConsent.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } }),
    ]);
    if (!recording) throw NotFound('Recording');
    if (!consent?.consentGiven || consent.withdrawnAt) {
      throw Forbidden('This recording is not available: consent was declined or withdrawn.');
    }
    if (recording.storageBucket === 'provider') {
      throw NotFound('Recording media — it has not finished transferring from the telephony provider yet');
    }

    await prisma.recording.update({
      where: { callId: params.id, tenantId: ctx.tenantId },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    });

    const body = await getObject(recording.storageKey);
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': recording.mimeType,
        'content-length': String(body.byteLength),
        'content-disposition': `attachment; filename="call-${params.id}"`,
        // Never in a shared cache, never on disk beyond the tab.
        'cache-control': 'private, no-store',
      },
    });
  },
);
