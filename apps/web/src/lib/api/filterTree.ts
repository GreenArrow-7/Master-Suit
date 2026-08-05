import { z } from 'zod';
import { AppError } from '../errors';
import type { Ctx } from '../security/rbac';

/**
 * One filter grammar drives the data grid, Smart Views, dynamic lists, automation
 * conditions, report filters and distribution rules. Written once, tested once.
 *
 * Field names are allow-listed per object before compilation. There is no string
 * interpolation into SQL anywhere below — the output is a Prisma `where` object.
 */

export const comparators = [
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'starts', 'ends',
  'between', 'is_null', 'is_not_null', 'relative',
] as const;

const leafSchema = z.object({
  field: z.string().min(1).max(80),
  cmp: z.enum(comparators),
  value: z.unknown().optional(),
});

export type FilterNode =
  | { op: 'AND' | 'OR'; children: FilterNode[] }
  | z.infer<typeof leafSchema>;

export const filterTreeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['AND', 'OR']), children: z.array(filterTreeSchema).min(1).max(50) }),
    leafSchema,
  ]),
);

/** Allow-list per object. A field absent here is rejected before reaching SQL. */
const FIELD_MAP: Record<string, Record<string, { path: string; type: 'string' | 'number' | 'date' | 'bool' | 'enum' | 'array' }>> = {
  LEAD: {
    'fullName': { path: 'fullName', type: 'string' },
    'email': { path: 'email', type: 'string' },
    'phone': { path: 'phoneNormalized', type: 'string' },
    'company': { path: 'company', type: 'string' },
    'city': { path: 'city', type: 'string' },
    'country': { path: 'country', type: 'string' },
    'score': { path: 'score', type: 'number' },
    'grade': { path: 'grade', type: 'string' },
    'priority': { path: 'priority', type: 'enum' },
    'source': { path: 'source', type: 'enum' },
    'stage.key': { path: 'stage.key', type: 'string' },
    'stage.id': { path: 'stageId', type: 'string' },
    'owner.id': { path: 'ownerId', type: 'string' },
    'owner.teamId': { path: 'teamId', type: 'string' },
    'branch.id': { path: 'branchId', type: 'string' },
    'tags': { path: 'tags', type: 'array' },
    'slaState': { path: 'slaState', type: 'enum' },
    'createdAt': { path: 'createdAt', type: 'date' },
    'updatedAt': { path: 'updatedAt', type: 'date' },
    'lastActivityAt': { path: 'lastActivityAt', type: 'date' },
    'nextFollowUpAt': { path: 'nextFollowUpAt', type: 'date' },
    'convertedAt': { path: 'convertedAt', type: 'date' },
    'firstContactedAt': { path: 'firstContactedAt', type: 'date' },
  },
  // OPPORTUNITY, ACCOUNT, TASK, TICKET, ACTIVITY maps follow the same shape.
};

export function referencedFields(node: FilterNode): string[] {
  if ('op' in node) return node.children.flatMap(referencedFields);
  return [node.field];
}

export function compileFilterTree(object: string, node: FilterNode, ctx: Ctx): Record<string, unknown> {
  const map = FIELD_MAP[object];
  if (!map) throw new AppError(400, 'unknown-object', `No filter map registered for ${object}.`);

  if ('op' in node) {
    const children = node.children.map((c) => compileFilterTree(object, c, ctx));
    return node.op === 'AND' ? { AND: children } : { OR: children };
  }

  const spec = map[node.field];
  if (!spec) throw new AppError(400, 'unknown-field', `Cannot filter on "${node.field}".`);

  if (node.cmp === 'is_not_null') return { NOT: nest(spec.path, null) };

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
    case 'eq': return value;
    case 'ne': return { not: value };
    case 'gt': return { gt: coerce(value, type) };
    case 'gte': return { gte: coerce(value, type) };
    case 'lt': return { lt: coerce(value, type) };
    case 'lte': return { lte: coerce(value, type) };
    case 'in': return type === 'array' ? { hasSome: value } : { in: value };
    case 'nin': return { notIn: value };
    case 'contains': return type === 'array' ? { has: value } : { contains: String(value), mode: 'insensitive' };
    case 'starts': return { startsWith: String(value), mode: 'insensitive' };
    case 'ends': return { endsWith: String(value), mode: 'insensitive' };
    case 'between': {
      const [a, b] = value as [unknown, unknown];
      return { gte: coerce(a, type), lte: coerce(b, type) };
    }
    case 'is_null': return null;
    case 'is_not_null': throw new Error('is_not_null handled in compileFilterTree');
    case 'relative': return relativeRange(String(value));
    default: throw new AppError(400, 'unknown-comparator', `Unsupported comparator "${cmp}".`);
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
    case 'today': return { gte: startOfDay(now), lte: days(1) };
    case 'yesterday': return { gte: startOfDay(days(-1)), lte: startOfDay(now) };
    case 'this_week': return { gte: startOfDay(days(-now.getDay())), lte: now };
    case 'last_week': return { gte: startOfDay(days(-now.getDay() - 7)), lte: startOfDay(days(-now.getDay())) };
    case 'this_month': return { gte: new Date(now.getFullYear(), now.getMonth(), 1), lte: now };
    case 'last_month': return { gte: new Date(now.getFullYear(), now.getMonth() - 1, 1), lte: new Date(now.getFullYear(), now.getMonth(), 1) };
    case 'this_quarter': return { gte: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), lte: now };
    case 'this_year': return { gte: new Date(now.getFullYear(), 0, 1), lte: now };
    case 'overdue': return { lte: now };
    default: throw new AppError(400, 'unknown-relative-date', `Unsupported relative date "${token}".`);
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
  return parts.reduceRight<unknown>((acc, part, i) => (i === parts.length - 1 ? { [part]: clause } : { [part]: acc }), {}) as Record<string, unknown>;
}
