import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { visibilityWhere } from '@/lib/security/visibility';
import { draftReply } from '@/services/social/draftReply';

/**
 * A suggested answer. Returns text and writes nothing.
 *
 * Separate from the reply endpoint on purpose: there is no request that both
 * drafts and sends, so no bug or retry can turn a suggestion into something a
 * customer received. Sending always takes a second, deliberate act.
 */
const params = z.object({ id: z.string().min(1).max(60) });
const body = z.object({ kind: z.enum(['PUBLIC', 'PRIVATE']) }).strict();

export const POST = route({ module: 'leads', action: 'EDIT', params, body }, async ({ ctx, params, body }) => {
  const visible = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const enquiry = await prisma.socialComment.findFirst({
    where: { ...visible, id: params.id },
    select: { provider: true, authorName: true, commentText: true, intent: true, mediaType: true },
  });
  if (!enquiry) throw NotFound('Social enquiry');

  const tenant = await prisma.tenant.findFirst({
    where: { id: ctx.tenantId },
    select: { displayName: true },
  });

  const draft = await draftReply({ ...enquiry, kind: body.kind, businessName: tenant?.displayName ?? null });
  return draft;
});
