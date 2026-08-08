import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { pageQuery, decodeCursor, cursorWhere, toPage } from '@/lib/api/pagination';
import { compileFilterTree, filterTreeSchema, referencedFields } from '@/lib/api/filterTree';
import { prisma } from '@/lib/db';
import {
  loadFieldRules,
  applyFieldSecurity,
  stripUneditableFields,
  assertFilterableFields,
} from '@/lib/security/fieldSecurity';
import { visibilityWhere } from '@/lib/security/visibility';
import { createLead, LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';

/**
 * Reference implementation. Every list endpoint in the platform follows this exact
 * shape: visibility → filter compile → field-security gate → keyset page →
 * serialise through field security. Phases 2-7 copy this file's structure.
 */

const listQuery = pageQuery.extend({
  q: z.string().max(200).optional(),
  filter: z.string().optional(),
  fields: z.string().optional(),
  includeUnassigned: z.coerce.boolean().default(true),
});

const GRID_COLUMNS = {
  id: true,
  reference: true,
  fullName: true,
  email: true,
  phone: true,
  company: true,
  score: true,
  grade: true,
  priority: true,
  stageId: true,
  ownerId: true,
  source: true,
  nextFollowUpAt: true,
  slaState: true,
  lastActivityAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const GET = route(
  { module: 'leads', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');

    const scopeWhere = await visibilityWhere(ctx, 'leads', 'VIEW', {
      includeUnassigned: query.includeUnassigned,
    });

    const tree = query.filter
      ? filterTreeSchema.parse(JSON.parse(Buffer.from(query.filter, 'base64url').toString()))
      : null;
    if (tree) assertFilterableFields(rules, referencedFields(tree));

    const cursor = decodeCursor(query.cursor);

    const where = {
      ...scopeWhere,
      ...(tree ? compileFilterTree('LEAD', tree, ctx) : {}),
      ...(query.q ? { fullName: { contains: query.q, mode: 'insensitive' as const } } : {}),
      ...cursorWhere(cursor),
    };

    // limit + 1 tells us whether another page exists without a second query.
    const rows = await prisma.lead.findMany({
      where,
      select: GRID_COLUMNS,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const page = toPage(rows as any, query.limit);
    return {
      ...page,
      data: page.data.map((r) => applyFieldSecurity(ctx, 'LEAD', rules, r, LEAD_SENSITIVE_FIELDS)),
    };
  },
);

const createBody = z
  .object({
    firstName: z.string().max(80).optional(),
    lastName: z.string().max(80).optional(),
    fullName: z.string().min(1).max(160),
    email: z.string().email().max(254).optional(),
    phone: z.string().max(32).optional(),
    company: z.string().max(160).optional(),
    jobTitle: z.string().max(120).optional(),
    country: z.string().max(80).optional(),
    city: z.string().max(80).optional(),
    source: z
      .enum(['MANUAL', 'QUICK_CREATE', 'IMPORT', 'PUBLIC_FORM', 'LANDING_PAGE', 'API', 'WEBHOOK'])
      .default('MANUAL'),
    sourceDetail: z.string().max(160).optional(),
    campaignId: z.string().cuid().optional(),
    stageId: z.string().cuid().optional(),
    ownerId: z.string().cuid().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    tags: z.array(z.string().max(40)).max(20).default([]),
    custom: z.record(z.unknown()).default({}),
    /** WARN lets the caller proceed past a duplicate match; BLOCK is the default. */
    onDuplicate: z.enum(['BLOCK', 'WARN', 'MERGE']).default('BLOCK'),
  })
  .strict();

export const POST = route(
  { module: 'leads', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    // Fields the actor may not write are dropped before validation reaches the
    // service, so a crafted payload cannot smuggle them past field permissions.
    const safe = stripUneditableFields(rules, body);

    const lead = await createLead(ctx, safe);
    return applyFieldSecurity(ctx, 'LEAD', rules, lead, LEAD_SENSITIVE_FIELDS);
  },
);
