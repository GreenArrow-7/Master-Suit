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
import { createOpportunity } from '@/services/opportunities/createOpportunity';

const listQuery = pageQuery.extend({
  q: z.string().max(200).optional(),
  filter: z.string().optional(),
  includeUnassigned: z.coerce.boolean().default(true),
});

const GRID_COLUMNS = {
  id: true,
  reference: true,
  name: true,
  pipelineId: true,
  stageId: true,
  status: true,
  amount: true,
  currency: true,
  probability: true,
  expectedCloseDate: true,
  ownerId: true,
  accountId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const GET = route(
  { module: 'opportunities', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const rules = await loadFieldRules(ctx, 'OPPORTUNITY');
    const scopeWhere = await visibilityWhere(ctx, 'opportunities', 'VIEW', {
      includeUnassigned: query.includeUnassigned,
    });

    const tree = query.filter
      ? filterTreeSchema.parse(JSON.parse(Buffer.from(query.filter, 'base64url').toString()))
      : null;
    if (tree) assertFilterableFields(rules, referencedFields(tree));

    const cursor = decodeCursor(query.cursor);
    const where = {
      ...scopeWhere,
      ...(tree ? compileFilterTree('OPPORTUNITY', tree, ctx) : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.opportunity.findMany({
      where,
      select: GRID_COLUMNS,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const page = toPage(rows as any, query.limit);
    return { ...page, data: page.data.map((r) => applyFieldSecurity(ctx, 'OPPORTUNITY', rules, r)) };
  },
);

const createBody = z
  .object({
    name: z.string().min(1).max(200),
    leadId: z.string().cuid().optional(),
    accountId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    pipelineId: z.string().cuid().optional(),
    stageId: z.string().cuid().optional(),
    ownerId: z.string().cuid().optional(),
    amount: z.number().min(0).optional(),
    currency: z.string().length(3).optional(),
    expectedCloseDate: z.string().datetime().optional(),
    tags: z.array(z.string().max(40)).max(20).default([]),
    custom: z.record(z.unknown()).default({}),
  })
  .strict();

export const POST = route(
  { module: 'opportunities', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const rules = await loadFieldRules(ctx, 'OPPORTUNITY');
    const safe = stripUneditableFields(rules, body);
    const opportunity = await createOpportunity(ctx, safe);
    return applyFieldSecurity(ctx, 'OPPORTUNITY', rules, opportunity);
  },
);
