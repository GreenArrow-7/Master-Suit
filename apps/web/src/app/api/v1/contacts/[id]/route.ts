import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { loadFieldRules, applyFieldSecurity, stripUneditableFields } from '@/lib/security/fieldSecurity';
import { visibilityWhere } from '@/lib/security/visibility';
import { updateContact, deleteContact } from '@/services/contacts/updateContact';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'contacts', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const rules = await loadFieldRules(ctx, 'CONTACT');
    const scope = await visibilityWhere(ctx, 'contacts', 'VIEW', { includeUnassigned: true });
    const contact = await prisma.contact.findFirst({
      where: { ...scope, id: params.id },
      include: {
        account: { select: { id: true, name: true } },
        owner: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!contact) throw NotFound('Contact');
    return applyFieldSecurity(ctx, 'CONTACT', rules, contact);
  },
);

const patchBody = z
  .object({
    fullName: z.string().min(1).max(160).optional(),
    jobTitle: z.string().max(120).optional(),
    email: z.string().email().max(254).optional(),
    phone: z.string().max(32).optional(),
    accountId: z.string().cuid().nullable().optional(),
    ownerId: z.string().cuid().nullable().optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'contacts', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const rules = await loadFieldRules(ctx, 'CONTACT');
    const safe = stripUneditableFields(rules, body);
    const contact = await updateContact(ctx, params.id, safe);
    return applyFieldSecurity(ctx, 'CONTACT', rules, contact);
  },
);

export const DELETE = route(
  { module: 'contacts', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    await deleteContact(ctx, params.id);
    return { ok: true };
  },
);
