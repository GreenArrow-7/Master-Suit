import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { assertAnyModuleEntitlement, LEAD_MODULES } from '@/lib/security/entitlements';
import { takeEnquiry } from '@/services/leads/intake';

/**
 * A QR capture form's submission. Anonymous by design, like public forms: the
 * workspace slug and the link's key reach only an active link of an active
 * workspace. The person becomes a lead through the same intake the portals
 * use — attached to the lead that already holds their number or email — and
 * the answer never says which, so the form cannot be used to probe the book.
 */
// The public form's shape, so its page component posts here unchanged.
const body = z
  .object({
    workspace: z.string().min(2).max(64),
    form: z.string().min(2).max(60),
    answers: z
      .object({
        name: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(6).max(32),
        email: z.string().trim().email().max(254).optional().or(z.literal('')),
        message: z.string().trim().max(1000).optional(),
      })
      .strict(),
  })
  .strict();

export const POST = route(
  { module: 'leads', action: 'CREATE', anonymous: true, body, rateLimit: { max: 10, windowSeconds: 60 } },
  async ({ body }) => {
    const tenant = await prisma.tenant.findFirst({
      where: { slug: body.workspace, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    const link = tenant
      ? await prisma.captureLink.findFirst({
          where: { tenantId: tenant.id, key: body.form, isActive: true },
          include: { owner: { select: { status: true } } },
        })
      : null;
    if (!tenant || !link) throw NotFound('Form');
    await assertAnyModuleEntitlement(tenant.id, LEAD_MODULES).catch(() => {
      throw NotFound('Form');
    });

    const { answers } = body;
    await takeEnquiry(
      tenant.id,
      {
        fullName: answers.name,
        email: answers.email?.toLowerCase() || null,
        phones: [answers.phone],
        message: answers.message || null,
        reference: link.campaign,
        details: [],
      },
      {
        label: `QR code: ${link.label}`,
        source: 'PUBLIC_FORM',
        sourceDetail: `capture:${link.key}`,
        // Printed codes outlive jobs: an agent who has left gets nothing more.
        ownerId: link.owner?.status === 'ACTIVE' ? link.ownerId : null,
      },
    );
    await prisma.captureLink.update({
      where: { tenantId: tenant.id, id: link.id },
      data: { submitCount: { increment: 1 } },
    });
    return { ok: true, message: 'Thank you — we will be in touch shortly.' };
  },
);
