import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { replyToSocialComment, EXTERNAL_CHANNELS } from '@/services/social/replyToComment';

/**
 * Answering a social enquiry. Every rule — permission, whether Meta will accept
 * it, what gets written — lives in the service; this shapes the request.
 */
const params = z.object({ id: z.string().min(1).max(60) });

const body = z
  .object({
    kind: z.enum(['PUBLIC', 'PRIVATE', 'EXTERNAL']),
    body: z.string().trim().min(1).max(8000),
    channel: z.enum(EXTERNAL_CHANNELS).nullish(),
    aiAssisted: z.boolean().optional(),
  })
  .strict()
  // A channel only means something when nothing was sent through Meta.
  .refine((v) => (v.kind === 'EXTERNAL' ? Boolean(v.channel) : !v.channel), {
    message: 'Say how you contacted them, and only when the reply was sent outside Meta.',
  });

export const POST = route(
  { module: 'leads', action: 'EDIT', params, body, auditEvent: 'MESSAGE_SENT' },
  async ({ ctx, params, body }) =>
    replyToSocialComment(ctx, {
      socialCommentId: params.id,
      kind: body.kind,
      body: body.body,
      channel: body.channel ?? null,
      aiAssisted: body.aiAssisted ?? false,
    }),
);
