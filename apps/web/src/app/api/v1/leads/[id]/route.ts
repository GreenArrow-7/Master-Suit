import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { loadFieldRules, applyFieldSecurity, seesField, stripUneditableFields } from '@/lib/security/fieldSecurity';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { updateLead, deleteLead } from '@/services/leads/updateLead';
import { assertLeadInScope, leadScope } from '@/lib/security/record-scope';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'VIEW', params },
  async ({ ctx, params }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    const scope = await leadScope(ctx, 'VIEW', { includeUnassigned: true });

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

const patchBody = z
  .object({
    fullName: z.string().min(1).max(160).optional(),
    email: z.string().email().max(254).optional(),
    phone: z.string().max(32).optional(),
    phoneIsWhatsapp: z.boolean().optional(),
    company: z.string().max(160).optional(),
    jobTitle: z.string().max(120).optional(),
    country: z.string().max(80).optional(),
    city: z.string().max(80).optional(),
    nationality: z.string().trim().max(80).nullable().optional(),
    sourceId: z.string().cuid().nullable().optional(),
    campaignName: z.string().trim().max(120).nullable().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    notes: z.string().max(5000).nullable().optional(),
    stageId: z.string().cuid().optional(),
    stageReason: z.string().max(200).optional(),
    // What the stage books as the lead enters it (lib/leads/stageBookings.ts):
    // "YYYY-MM-DDTHH:mm" on the workspace's clock, or an ISO instant.
    visitAt: z.string().max(40).optional(),
    projectId: z.string().cuid().optional(),
    meetingAt: z.string().max(40).optional(),
    ownerId: z.string().cuid().nullable().optional(),
    secondaryOwnerId: z.string().cuid().nullable().optional(),
    /** Custom field values by key (Administration → Custom fields); null clears one. */
    custom: z.record(z.union([z.string().max(1000), z.number(), z.null()])).optional(),
  })
  .strict();

export const PATCH = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    // A number or address this role sees masked is not theirs to overwrite: the
    // rule the lead's other numbers follow (phones/route.ts). A lead outside
    // their scope still answers 404 first, like a missing one.
    const masked = (['phone', 'email'] as const).filter(
      (field) => body[field] !== undefined && !seesField(ctx, 'LEAD', rules, field, LEAD_SENSITIVE_FIELDS),
    );
    if (masked.length) {
      await assertLeadInScope(ctx, params.id, prisma, 'EDIT');
      throw Forbidden(`Your role cannot change this lead’s ${masked.join(' or ')}.`);
    }
    const safe = stripUneditableFields(rules, body);
    const lead = await updateLead(ctx, params.id, safe);
    return applyFieldSecurity(ctx, 'LEAD', rules, lead, LEAD_SENSITIVE_FIELDS);
  },
);

export const DELETE = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    await deleteLead(ctx, params.id);
    return { ok: true };
  },
);
