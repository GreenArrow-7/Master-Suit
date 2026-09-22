import { z } from 'zod';
import { AppError, Invalid } from '../errors';
import type { Ctx } from '../security/rbac';

/**
 * One filter grammar drives the data grid, Smart Views, dynamic lists, automation
 * conditions, report filters and distribution rules. Written once, tested once.
 *
 * Field names are allow-listed per object before compilation. There is no string
 * interpolation into SQL anywhere below — the output is a Prisma `where` object.
 */

export const comparators = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'starts',
  'ends',
  'between',
  'is_null',
  'is_not_null',
  'relative',
] as const;

const leafSchema = z.object({
  field: z.string().min(1).max(80),
  cmp: z.enum(comparators),
  value: z.unknown().optional(),
});

export type FilterNode = { op: 'AND' | 'OR'; children: FilterNode[] } | z.infer<typeof leafSchema>;

export const filterTreeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([z.object({ op: z.enum(['AND', 'OR']), children: z.array(filterTreeSchema).min(1).max(50) }), leafSchema]),
);

/**
 * Allow-list per object. A field absent here is rejected before reaching SQL.
 *
 * `nullable` mirrors the column's `?` in prisma/schema.prisma, and only
 * `is_null` / `is_not_null` read it. Prisma builds a different filter type for a
 * required column — one with nowhere to put a null — so asking whether a
 * required column is null is not a narrow query, it is a 500. Saying so here
 * turns it into the 400 it always was. tests/unit/filter-field-maps.spec.ts
 * checks every entry against the schema, so this cannot drift from the database.
 *
 * Deliberately absent everywhere: `tenantId`, `deletedAt`, and every free-text
 * or JSON column. The first two are set by the query builders that wrap this and
 * must not be reachable from a caller's filter; the rest are neither indexed nor
 * useful to filter on.
 */
export const FIELD_MAP: Record<
  string,
  Record<string, { path: string; type: 'string' | 'number' | 'date' | 'bool' | 'enum' | 'array'; nullable?: true }>
> = {
  LEAD: {
    fullName: { path: 'fullName', type: 'string' },
    email: { path: 'email', type: 'string', nullable: true },
    phone: { path: 'phoneNormalized', type: 'string', nullable: true },
    company: { path: 'company', type: 'string', nullable: true },
    city: { path: 'city', type: 'string', nullable: true },
    country: { path: 'country', type: 'string', nullable: true },
    score: { path: 'score', type: 'number' },
    grade: { path: 'grade', type: 'string', nullable: true },
    priority: { path: 'priority', type: 'enum' },
    source: { path: 'source', type: 'enum' },
    'stage.key': { path: 'stage.key', type: 'string' },
    'stage.id': { path: 'stageId', type: 'string' },
    'owner.id': { path: 'ownerId', type: 'string', nullable: true },
    'owner.teamId': { path: 'teamId', type: 'string', nullable: true },
    'branch.id': { path: 'branchId', type: 'string', nullable: true },
    tags: { path: 'tags', type: 'array' },
    slaState: { path: 'slaState', type: 'enum' },
    createdAt: { path: 'createdAt', type: 'date' },
    updatedAt: { path: 'updatedAt', type: 'date' },
    lastActivityAt: { path: 'lastActivityAt', type: 'date', nullable: true },
    // `nextFollowUpAt` is deliberately absent.
    //
    // It is a derived cache aggregating every owner's obligations, so a filter
    // on it answers questions about other people's schedules — and a filter is
    // a fine oracle: build `nextFollowUpAt < X`, read the count, repeat, and a
    // colleague's due date falls out in a dozen requests without ever rendering
    // it. The overdue and no-next-action views are built from the viewer's own
    // obligations instead; see services/leads/nextFollowUp.ts.
    convertedAt: { path: 'convertedAt', type: 'date', nullable: true },
    firstContactedAt: { path: 'firstContactedAt', type: 'date', nullable: true },
  },
  OPPORTUNITY: {
    name: { path: 'name', type: 'string' },
    reference: { path: 'reference', type: 'string' },
    status: { path: 'status', type: 'enum' },
    amount: { path: 'amount', type: 'number' },
    currency: { path: 'currency', type: 'string' },
    probability: { path: 'probability', type: 'number' },
    source: { path: 'source', type: 'enum' },
    competitor: { path: 'competitor', type: 'string', nullable: true },
    'stage.key': { path: 'stage.key', type: 'string' },
    'stage.id': { path: 'stageId', type: 'string' },
    'pipeline.id': { path: 'pipelineId', type: 'string' },
    'owner.id': { path: 'ownerId', type: 'string', nullable: true },
    'owner.teamId': { path: 'teamId', type: 'string', nullable: true },
    'branch.id': { path: 'branchId', type: 'string', nullable: true },
    'account.id': { path: 'accountId', type: 'string', nullable: true },
    'lead.id': { path: 'leadId', type: 'string', nullable: true },
    'campaign.id': { path: 'campaignId', type: 'string', nullable: true },
    'lossReason.id': { path: 'lossReasonId', type: 'string', nullable: true },
    tags: { path: 'tags', type: 'array' },
    expectedCloseDate: { path: 'expectedCloseDate', type: 'date', nullable: true },
    actualCloseDate: { path: 'actualCloseDate', type: 'date', nullable: true },
    stageEnteredAt: { path: 'stageEnteredAt', type: 'date' },
    lastActivityAt: { path: 'lastActivityAt', type: 'date', nullable: true },
    createdAt: { path: 'createdAt', type: 'date' },
    updatedAt: { path: 'updatedAt', type: 'date' },
  },
  CONTACT: {
    fullName: { path: 'fullName', type: 'string' },
    firstName: { path: 'firstName', type: 'string', nullable: true },
    lastName: { path: 'lastName', type: 'string', nullable: true },
    reference: { path: 'reference', type: 'string' },
    email: { path: 'email', type: 'string', nullable: true },
    phone: { path: 'phoneNormalized', type: 'string', nullable: true },
    jobTitle: { path: 'jobTitle', type: 'string', nullable: true },
    department: { path: 'department', type: 'string', nullable: true },
    decisionRole: { path: 'decisionRole', type: 'string', nullable: true },
    consentStatus: { path: 'consentStatus', type: 'enum' },
    emailOptOut: { path: 'emailOptOut', type: 'bool' },
    'account.id': { path: 'accountId', type: 'string', nullable: true },
    'owner.id': { path: 'ownerId', type: 'string', nullable: true },
    tags: { path: 'tags', type: 'array' },
    createdAt: { path: 'createdAt', type: 'date' },
    updatedAt: { path: 'updatedAt', type: 'date' },
  },
  ACCOUNT: {
    name: { path: 'name', type: 'string' },
    reference: { path: 'reference', type: 'string' },
    accountType: { path: 'accountType', type: 'string', nullable: true },
    industry: { path: 'industry', type: 'string', nullable: true },
    website: { path: 'website', type: 'string', nullable: true },
    status: { path: 'status', type: 'string' },
    customerTier: { path: 'customerTier', type: 'string', nullable: true },
    employeeCount: { path: 'employeeCount', type: 'number', nullable: true },
    annualRevenue: { path: 'annualRevenue', type: 'number', nullable: true },
    'parentAccount.id': { path: 'parentAccountId', type: 'string', nullable: true },
    'owner.id': { path: 'ownerId', type: 'string', nullable: true },
    'owner.teamId': { path: 'teamId', type: 'string', nullable: true },
    'branch.id': { path: 'branchId', type: 'string', nullable: true },
    tags: { path: 'tags', type: 'array' },
    renewalDate: { path: 'renewalDate', type: 'date', nullable: true },
    createdAt: { path: 'createdAt', type: 'date' },
    updatedAt: { path: 'updatedAt', type: 'date' },
  },
  // TASK, TICKET and ACTIVITY have no route offering `filter` yet. Registering a
  // map before a route needs it is how the LEAD-only gap went unnoticed in the
  // other direction: the check-filter-maps gate refuses a route that compiles an
  // object with no map, which is the failure that matters.
};

export function referencedFields(node: FilterNode): string[] {
  if ('op' in node) return node.children.flatMap(referencedFields);
  return [node.field];
}

/**
 * Fields that were filterable and are not any more.
 *
 * Named so a saved view built against one fails with an explanation rather than
 * a shrug. See `WITHDRAWN_NEXT_FOLLOW_UP` for the compatibility path the Smart
 * Views screen takes with the same information.
 */
export const WITHDRAWN_FIELDS: Record<string, string> = {
  'LEAD.nextFollowUpAt':
    'Filtering on the next follow-up date was withdrawn: the stored value aggregates every ' +
    'owner’s obligations, so a filter on it answered questions about other people’s ' +
    'schedules. Use the Overdue or No Next Action views, which are built from the obligations ' +
    'you are allowed to see.',
};

export function compileFilterTree(object: string, node: FilterNode, ctx: Ctx): Record<string, unknown> {
  const map = FIELD_MAP[object];
  if (!map) throw new AppError(400, 'unknown-object', `No filter map registered for ${object}.`);

  if ('op' in node) {
    const children = node.children.map((c) => compileFilterTree(object, c, ctx));
    return node.op === 'AND' ? { AND: children } : { OR: children };
  }

  const spec = map[node.field];
  if (!spec) {
    // A field that used to be filterable gets its own message, because "cannot
    // filter on X" reads like a typo when the truth is that it was withdrawn
    // and there is somewhere else to go.
    const withdrawn = WITHDRAWN_FIELDS[`${object}.${node.field}`];
    if (withdrawn) throw new AppError(400, 'withdrawn-field', withdrawn);
    throw new AppError(400, 'unknown-field', `Cannot filter on "${node.field}".`);
  }

  if (node.cmp === 'is_null' || node.cmp === 'is_not_null') {
    // A scalar list is never null — it is empty. `{ tags: null }` is not a
    // question Prisma can answer, and asking it returned a 500 to the caller
    // rather than a 400 explaining the mistake.
    if (spec.type === 'array') {
      throw new AppError(400, 'unsupported-comparator', `"${node.field}" is a list; use "in" or "contains".`);
    }
    if (!spec.nullable) {
      throw new AppError(400, 'unsupported-comparator', `"${node.field}" is always set and can never be null.`);
    }
    // `{ NOT: { createdAt: null } }` reads as the negation of a null check but
    // Prisma rejects it outright — inside NOT, a null value means "argument not
    // provided", so every is_not_null filter in the product 500'd. The nested
    // `not` is the form Prisma actually defines, and it nests correctly through
    // a relation path like `stage.key` too.
    return nest(spec.path, node.cmp === 'is_null' ? null : { not: null });
  }

  const value = resolveToken(node.value, ctx);
  const clause = buildClause(node.cmp, value, spec.type);
  return nest(spec.path, clause);
}

/** `$currentUser` and `$currentUserTeams` keep saved views portable between users. */
function resolveToken(value: unknown, ctx: Ctx): unknown {
  if (value === '$currentUser') return ctx.actor.id;
  if (value === '$currentUserTeams') return [...ctx.actor.teamIds];
  if (value === '$currentUserBranch') return ctx.actor.branchId;
  return value;
}

function buildClause(cmp: string, value: unknown, type: string): unknown {
  switch (cmp) {
    case 'eq':
      return value;
    case 'ne':
      return { not: value };
    case 'gt':
      return { gt: coerce(value, type) };
    case 'gte':
      return { gte: coerce(value, type) };
    case 'lt':
      return { lt: coerce(value, type) };
    case 'lte':
      return { lte: coerce(value, type) };
    case 'in':
      return type === 'array' ? { hasSome: value } : { in: value };
    case 'nin':
      return { notIn: value };
    case 'contains':
      return type === 'array' ? { has: value } : { contains: String(value), mode: 'insensitive' };
    case 'starts':
      return { startsWith: String(value), mode: 'insensitive' };
    case 'ends':
      return { endsWith: String(value), mode: 'insensitive' };
    case 'between': {
      const [a, b] = value as [unknown, unknown];
      return { gte: coerce(a, type), lte: coerce(b, type) };
    }
    // is_null and is_not_null never reach here — compileFilterTree answers both
    // before a clause is built, because both need the field's *path*, not just
    // a comparison to graft onto it.
    case 'is_null':
    case 'is_not_null':
      throw new Error(`${cmp} is handled in compileFilterTree`);
    case 'relative':
      return relativeRange(String(value));
    default:
      throw new AppError(400, 'unknown-comparator', `Unsupported comparator "${cmp}".`);
  }
}

function relativeRange(token: string): { gte?: Date; lte?: Date } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

  const lastN = /^last_(\d+)_days$/.exec(token);
  if (lastN) return { gte: startOfDay(days(-Number(lastN[1]))), lte: now };
  const nextN = /^next_(\d+)_days$/.exec(token);
  if (nextN) return { gte: now, lte: days(Number(nextN[1])) };

  switch (token) {
    case 'today':
      return { gte: startOfDay(now), lte: days(1) };
    case 'yesterday':
      return { gte: startOfDay(days(-1)), lte: startOfDay(now) };
    case 'this_week':
      return { gte: startOfDay(days(-now.getDay())), lte: now };
    case 'last_week':
      return { gte: startOfDay(days(-now.getDay() - 7)), lte: startOfDay(days(-now.getDay())) };
    case 'this_month':
      return { gte: new Date(now.getFullYear(), now.getMonth(), 1), lte: now };
    case 'last_month':
      return {
        gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        lte: new Date(now.getFullYear(), now.getMonth(), 1),
      };
    case 'this_quarter':
      return { gte: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), lte: now };
    case 'this_year':
      return { gte: new Date(now.getFullYear(), 0, 1), lte: now };
    case 'overdue':
      return { lte: now };
    default:
      throw new AppError(400, 'unknown-relative-date', `Unsupported relative date "${token}".`);
  }
}

function coerce(value: unknown, type: string) {
  if (type === 'date') return new Date(value as string);
  if (type === 'number') return Number(value);
  return value;
}

/** 'stage.key' → { stage: { key: <clause> } } */
function nest(path: string, clause: unknown): Record<string, unknown> {
  const parts = path.split('.');
  return parts.reduceRight<unknown>(
    (acc, part, i) => (i === parts.length - 1 ? { [part]: clause } : { [part]: acc }),
    {},
  ) as Record<string, unknown>;
}

/**
 * A `filter` query parameter, as the list routes receive it: base64url over
 * JSON, decoded into a validated tree.
 *
 * ── Why this is a function and not four copies of one expression ────────────
 *
 * It was four copies — leads, accounts, contacts and opportunities each wrote
 *
 *     filterTreeSchema.parse(JSON.parse(Buffer.from(query.filter, 'base64url').toString()))
 *
 * and `Buffer.from(x, 'base64url')` does not reject a string that is not
 * base64url. It silently drops every character outside the alphabet and decodes
 * whatever is left. `?filter=overdue` therefore became the five bytes
 * `a2 f7 ab 76 e7`, `toString()` turned those into replacement characters, and
 * `JSON.parse` threw a `SyntaxError` that nothing caught: a 500, an alarm, and
 * `PrismaClientKnownRequestError` in the customer's browser console for what is
 * simply a malformed parameter.
 *
 * `overdue` is not a hypothetical. It is the spelling the screens and the CSV
 * export use for the same parameter, and the dashboard's own attention links
 * carry it.
 *
 * So: one decoder, one place to be wrong, and a 422 that names the field
 * instead of a 500 that names a database driver.
 */
export function decodeFilterTree(raw: string): FilterNode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw Invalid([
      {
        field: 'filter',
        code: 'invalid',
        message: 'filter must be a base64url-encoded filter tree.',
      },
    ]);
  }
  const result = filterTreeSchema.safeParse(parsed);
  if (!result.success) {
    throw Invalid([
      {
        field: 'filter',
        code: 'invalid',
        message: 'filter is not a valid filter tree.',
      },
    ]);
  }
  return result.data;
}
