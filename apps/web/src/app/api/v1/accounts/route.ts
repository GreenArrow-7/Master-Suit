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
import { createAccount } from '@/services/accounts/createAccount';

const listQuery = pageQuery.extend({
  q: z.string().max(200).optional(),
  filter: z.string().optional(),
  includeUnassigned: z.coerce.boolean().default(true),
});

const GRID_COLUMNS = {
  id: true,
  reference: true,
  name: true,
  accountType: true,
  industry: true,
  mainPhone: true,
  mainEmail: true,
  ownerId: true,
  status: true,
  customerTier: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const GET = route(
  { module: 'accounts', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const rules = await loadFieldRules(ctx, 'ACCOUNT');
    const scopeWhere = await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: query.includeUnassigned });

    const tree = query.filter
      ? filterTreeSchema.parse(JSON.parse(Buffer.from(query.filter, 'base64url').toString()))
      : null;
    if (tree) assertFilterableFields(rules, referencedFields(tree));

    const cursor = decodeCursor(query.cursor);
    const where = {
      ...scopeWhere,
      ...(tree ? compileFilterTree('ACCOUNT', tree, ctx) : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.account.findMany({
      where,
      select: GRID_COLUMNS,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const page = toPage(rows as any, query.limit);
    return { ...page, data: page.data.map((r) => applyFieldSecurity(ctx, 'ACCOUNT', rules, r)) };
  },
);

const createBody = z
  .object({
    name: z.string().min(1).max(200),
    accountType: z.string().max(80).optional(),
    industry: z.string().max(80).optional(),
    parentAccountId: z.string().cuid().optional(),
    website: z.string().url().max(300).optional(),
    mainPhone: z.string().max(32).optional(),
    mainEmail: z.string().email().max(254).optional(),
    ownerId: z.string().cuid().optional(),
    customerTier: z.string().max(40).optional(),
    tags: z.array(z.string().max(40)).max(20).default([]),
    custom: z.record(z.unknown()).default({}),
  })
  .strict();

export const POST = route(
  { module: 'accounts', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const rules = await loadFieldRules(ctx, 'ACCOUNT');
    const safe = stripUneditableFields(rules, body);
    const account = await createAccount(ctx, safe);
    return applyFieldSecurity(ctx, 'ACCOUNT', rules, account);
  },
);
