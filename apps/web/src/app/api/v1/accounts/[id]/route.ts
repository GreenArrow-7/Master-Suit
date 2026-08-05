import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { loadFieldRules, applyFieldSecurity, stripUneditableFields } from '@/lib/security/fieldSecurity';
import { visibilityWhere } from '@/lib/security/visibility';
import { updateAccount, deleteAccount } from '@/services/accounts/updateAccount';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'accounts', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const rules = await loadFieldRules(ctx, 'ACCOUNT');
    const scope = await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true });
    const account = await prisma.account.findFirst({
      where: { ...scope, id: params.id },
      include: { owner: { select: { id: true, fullName: true, email: true } } },
    });
    if (!account) throw NotFound('Account');
    return applyFieldSecurity(ctx, 'ACCOUNT', rules, account);
  },
);

const patchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  accountType: z.string().max(80).optional(),
  industry: z.string().max(80).optional(),
  website: z.string().url().max(300).optional(),
  mainPhone: z.string().max(32).optional(),
  mainEmail: z.string().email().max(254).optional(),
  ownerId: z.string().cuid().nullable().optional(),
  customerTier: z.string().max(40).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PROSPECT']).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
}).strict();

export const PATCH = route(
  { module: 'accounts', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const rules = await loadFieldRules(ctx, 'ACCOUNT');
    const safe = stripUneditableFields(rules, body);
    const account = await updateAccount(ctx, params.id, safe);
    return applyFieldSecurity(ctx, 'ACCOUNT', rules, account);
  },
);

export const DELETE = route(
  { module: 'accounts', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    await deleteAccount(ctx, params.id);
    return { ok: true };
  },
);
