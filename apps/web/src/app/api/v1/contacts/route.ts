import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { pageQuery, decodeCursor, cursorWhere, toPage } from '@/lib/api/pagination';
import { compileFilterTree, filterTreeSchema, referencedFields } from '@/lib/api/filterTree';
import { prisma } from '@/lib/db';
import { loadFieldRules, applyFieldSecurity, stripUneditableFields, assertFilterableFields } from '@/lib/security/fieldSecurity';
import { visibilityWhere } from '@/lib/security/visibility';
import { createContact } from '@/services/contacts/createContact';

const listQuery = pageQuery.extend({
  q: z.string().max(200).optional(),
  filter: z.string().optional(),
  includeUnassigned: z.coerce.boolean().default(true),
});

const GRID_COLUMNS = {
  id: true, reference: true, fullName: true, jobTitle: true, email: true, phone: true,
  accountId: true, ownerId: true, createdAt: true, updatedAt: true,
} as const;

export const GET = route(
  { module: 'contacts', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const rules = await loadFieldRules(ctx, 'CONTACT');
    const scopeWhere = await visibilityWhere(ctx, 'contacts', 'VIEW', { includeUnassigned: query.includeUnassigned });

    const tree = query.filter ? filterTreeSchema.parse(JSON.parse(Buffer.from(query.filter, 'base64url').toString())) : null;
    if (tree) assertFilterableFields(rules, referencedFields(tree));

    const cursor = decodeCursor(query.cursor);
    const where = {
      ...scopeWhere,
      ...(tree ? compileFilterTree('CONTACT', tree, ctx) : {}),
      ...(query.q ? { fullName: { contains: query.q, mode: 'insensitive' as const } } : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.contact.findMany({
      where, select: GRID_COLUMNS, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
    });

    const page = toPage(rows as any, query.limit);
    return { ...page, data: page.data.map((r) => applyFieldSecurity(ctx, 'CONTACT', rules, r)) };
  },
);

const createBody = z.object({
  fullName: z.string().min(1).max(160),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  jobTitle: z.string().max(120).optional(),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(32).optional(),
  accountId: z.string().cuid().optional(),
  ownerId: z.string().cuid().optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  custom: z.record(z.unknown()).default({}),
}).strict();

export const POST = route(
  { module: 'contacts', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const rules = await loadFieldRules(ctx, 'CONTACT');
    const safe = stripUneditableFields(rules, body);
    const contact = await createContact(ctx, safe);
    return applyFieldSecurity(ctx, 'CONTACT', rules, contact);
  },
);
