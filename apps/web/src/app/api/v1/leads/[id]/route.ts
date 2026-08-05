import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { loadFieldRules, applyFieldSecurity, stripUneditableFields } from '@/lib/security/fieldSecurity';
import { visibilityWhere } from '@/lib/security/visibility';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { updateLead, deleteLead } from '@/services/leads/updateLead';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'leads', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });

    // Out-of-tenant and out-of-scope both resolve to null here, which NotFound turns
    // into a 404 — a 403 would confirm the record exists to a caller who can't see it.
    const lead = await prisma.lead.findFirst({
      where: { ...scope, id: params.id },
      include: { stage: true, owner: { select: { id: true, fullName: true, email: true } } },
    });
    if (!lead) throw NotFound('Lead');

    return applyFieldSecurity(ctx, 'LEAD', rules, lead, LEAD_SENSITIVE_FIELDS);
  },
);

const patchBody = z.object({
  fullName: z.string().min(1).max(160).optional(),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(32).optional(),
  company: z.string().max(160).optional(),
  jobTitle: z.string().max(120).optional(),
  country: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  notes: z.string().max(5000).nullable().optional(),
  stageId: z.string().cuid().optional(),
  ownerId: z.string().cuid().nullable().optional(),
}).strict();

export const PATCH = route(
  { module: 'leads', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    const safe = stripUneditableFields(rules, body);
    const lead = await updateLead(ctx, params.id, safe);
    return applyFieldSecurity(ctx, 'LEAD', rules, lead, LEAD_SENSITIVE_FIELDS);
  },
);

export const DELETE = route(
  { module: 'leads', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    await deleteLead(ctx, params.id);
    return { ok: true };
  },
);
