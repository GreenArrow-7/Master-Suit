import { route } from '@/lib/api/handler';
import { Invalid } from '@/lib/errors';
import { connectionCredentials } from '@/lib/integrations/connection';
import { getTranscriptionProvider, transcriptionProviderFor } from '@/lib/integrations/transcription';

/**
 * Voice practice: one spoken rep turn → text, through the workspace's own STT
 * provider. The transcript lands in the composer for the rep to read and edit
 * before sending — speech is input, never a bypass of review. The audio is
 * transcribed and discarded; it is the rep's own voice in their own drill, so
 * no client consent is in play.
 */
export const POST = route(
  {
    module: 'calls',
    productModule: 'SALES',
    action: 'EDIT',
    // Speech-to-text is a billed provider call; a stuck key must not fan out.
    rateLimit: { max: 30, windowSeconds: 300 },
  },
  async ({ ctx, req }) => {
    const audio = Buffer.from(await req.arrayBuffer());
    if (audio.length < 1000) return { text: '' };
    if (audio.length > 5_000_000) {
      throw Invalid([{ field: 'body', code: 'too_large', message: 'Audio exceeds 5MB.' }]);
    }

    const credentials = await connectionCredentials(ctx.tenantId, 'transcription');
    const providerKey = transcriptionProviderFor(credentials);
    if (!providerKey) {
      throw Invalid([
        {
          field: 'provider',
          code: 'not_connected',
          message: 'Connect a speech-to-text provider under Administration → Integrations to practise by voice.',
        },
      ]);
    }

    const result = await getTranscriptionProvider(providerKey, credentials ?? {}).transcribe({
      audio,
      mimeType: req.headers.get('content-type') ?? 'audio/webm',
      language: 'en',
    });
    return { text: result.text?.trim() ?? '' };
  },
);
