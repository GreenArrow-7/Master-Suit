/**
 * Pulls a call recording out of the vendor and into our own object storage.
 *
 * Vendor-hosted media is a liability in three directions: the link outlives our
 * access controls, the retention clock is theirs and not ours, and a URL that
 * reaches a browser is a copy of a client conversation we can no longer revoke.
 * So the URL the webhook receives is a pointer to fetch once, never a thing to
 * store and serve (§7).
 *
 * Idempotent: a recording already holding an object key is left alone, so a
 * retried job or a duplicated webhook does not re-download megabytes.
 */
import { env } from '@/lib/env';
import { assertFetchableUrl } from '@/lib/security/outboundUrl';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { putObject } from '@/lib/storage';
import { decryptCredentials } from '@/lib/integrations/connection';
import { telephonyProvider } from '@/lib/integrations/telephony';

export interface IngestRecordingJob {
  tenantId: string;
  callId: string;
  connectionId: string;
  url: string;
}

/** Vendors send a few MB of mp3; anything larger is a misconfiguration, not a call. */
const MAX_BYTES = 200 * 1024 * 1024;

export async function ingestRecording(job: IngestRecordingJob): Promise<{ ingested: boolean; reason?: string }> {
  const recording = await prisma.recording.findFirst({
    where: { callId: job.callId, tenantId: job.tenantId },
  });
  if (!recording) return { ingested: false, reason: 'no recording row' };
  if (recording.storageBucket !== 'provider') return { ingested: false, reason: 'already ingested' };

  // Consent can be withdrawn between the webhook and this job running. The
  // recording must not be copied into our own storage after that.
  const consent = await prisma.recordingConsent.findFirst({
    where: { callId: job.callId, tenantId: job.tenantId },
  });
  if (!consent?.consentGiven || consent.withdrawnAt) {
    await prisma.recording.delete({ where: { callId: job.callId, tenantId: job.tenantId } });
    logger.info({ callId: job.callId }, 'consent withdrawn before ingest — recording reference dropped');
    return { ingested: false, reason: 'consent withdrawn' };
  }

  const connection = await prisma.integrationConnection.findFirst({
    where: { id: job.connectionId, tenantId: job.tenantId },
  });
  if (!connection) return { ingested: false, reason: 'connection removed' };

  const provider = telephonyProvider(
    connection.provider,
    decryptCredentials((connection.credentials ?? {}) as Record<string, unknown>),
    connection.webhookKey,
  );

  /**
   * Where this URL points is not something the vendor gets to decide.
   *
   * It arrived in a webhook, and while that webhook is signed for Twilio and
   * Plivo, Exotel and Knowlarity cannot sign at all — they are authenticated by
   * an unguessable URL key. This process is the worker, inside the Compose
   * network, so an unchecked fetch reaches `postgres:5432`, `minio:9000`, the
   * face engine, and on a cloud host the metadata service on 169.254.169.254.
   *
   * `assertFetchableUrl` requires https, an allowed host, and public addresses
   * for every record the host resolves to. See lib/security/outboundUrl.ts for
   * what that does and does not cover.
   */
  const allowedHosts = [
    ...(provider.mediaHosts?.() ?? []),
    ...env.RECORDING_URL_ALLOWED_HOSTS.split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  ];
  const url = await assertFetchableUrl(job.url, allowedHosts);

  const res = await fetch(url, {
    headers: provider.mediaHeaders?.() ?? {},
    signal: AbortSignal.timeout(120_000),
    // Not optional. An allowed host that 302s to http://169.254.169.254/ walks
    // straight past every check above, because the checks ran against the first
    // URL and `fetch` follows redirects by default.
    redirect: 'error',
  });
  // Thrown, not returned: the queue's backoff is the retry, and vendors publish
  // the media a little after they announce it.
  if (!res.ok) throw new Error(`recording fetch failed: ${res.status}`);

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new Error(`recording is ${declared} bytes, over the ceiling`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > MAX_BYTES) throw new Error('recording exceeded the size ceiling after download');
  if (body.byteLength === 0) throw new Error('recording body was empty');

  const mimeType = res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
  // Sharded by tenant so a per-workspace deletion request is a prefix delete.
  const key = `recordings/${job.tenantId}/${job.callId}.${extension(mimeType)}`;
  await putObject(key, body, mimeType);

  await prisma.recording.update({
    where: { callId: job.callId, tenantId: job.tenantId },
    data: { storageKey: key, storageBucket: null, mimeType, sizeBytes: body.byteLength },
  });

  logger.info({ callId: job.callId, bytes: body.byteLength }, 'recording ingested');

  // The rest of the chain: transcribe → analyse → audit. Enqueued here rather
  // than waited on, so a slow speech vendor cannot make the recording itself
  // look like it failed to arrive.
  await enqueue('ai', 'transcribe', { tenantId: job.tenantId, callId: job.callId });
  return { ingested: true };
}

const extension = (mimeType: string) =>
  ({ 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg' })[
    mimeType
  ] ?? 'audio';
