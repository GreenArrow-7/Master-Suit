import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';

/**
 * Landing pages had a model and a list page; nothing could create or publish
 * one. A page is a headline, supporting copy and an optional embedded
 * lead-capture form — enough to share a campaign link that converts. Richer
 * block types can extend the same `blocks` JSON later.
 */
const createBody = z
  .object({
    name: z.string().min(2).max(160),
    slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/).optional(),
    headline: z.string().min(2).max(200),
    body: z.string().max(4000).optional(),
    /** A published form to embed; submissions become leads through it. */
    formId: z.string().cuid().optional(),
    publish: z.boolean().default(false),
  })
  .strict();

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export const POST = route(
  { module: 'landingpages', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const slug = body.slug ?? slugify(body.name);
    const exists = await prisma.landingPage.findFirst({
      where: { tenantId: ctx.tenantId, slug },
      select: { id: true },
    });
    if (exists) throw Conflict('A landing page with that slug already exists.');

    if (body.formId) {
      const form = await prisma.form.findFirst({
        where: { tenantId: ctx.tenantId, id: body.formId, deletedAt: null },
        select: { id: true },
      });
      if (!form) throw NotFound('Form');
    }

    return prisma.landingPage.create({
      data: {
        tenantId: ctx.tenantId,
        name: body.name,
        slug,
        seoTitle: body.headline,
        blocks: [
          { type: 'headline', text: body.headline },
          ...(body.body ? [{ type: 'body', text: body.body }] : []),
        ],
        formId: body.formId ?? null,
        state: body.publish ? 'PUBLISHED' : 'DRAFT',
        publishedAt: body.publish ? new Date() : null,
        createdById: ctx.actor.id,
      },
      select: { id: true, slug: true, name: true, state: true },
    });
  },
);
