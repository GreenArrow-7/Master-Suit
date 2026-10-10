import { prisma } from '../db';
import { AppError } from '../errors';
import type { Ctx } from './rbac';
import { can } from './rbac';

export type MaskStrategy = 'HIDE' | 'MASK_ALL' | 'MASK_PARTIAL' | 'MASK_EMAIL';

export interface FieldRule {
  fieldKey: string;
  canView: boolean;
  canEdit: boolean;
  maskStrategy: MaskStrategy | null;
}

/**
 * Field security runs in the serialiser, which is the only place that guarantees it
 * covers every egress path: list APIs, detail APIs, exports, report output, webhook
 * payloads and AI prompts all funnel through here.
 */
export async function loadFieldRules(ctx: Ctx, objectType: string): Promise<Map<string, FieldRule>> {
  const rows = await prisma.fieldPermission.findMany({
    where: { tenantId: ctx.tenantId, roleId: ctx.actor.roleId, objectType },
    select: { fieldKey: true, canView: true, canEdit: true, maskStrategy: true },
  });
  return new Map(rows.map((r) => [r.fieldKey, r as FieldRule]));
}

/** A record's sensitive fields, each with how it reads to a role that may not see it. */
export type SensitiveFields = Readonly<Record<string, MaskStrategy>>;

/**
 * The role editor grants VIEW_SENSITIVE_FIELDS on a module (`leads`), and the
 * serialiser names an object type (`LEAD`). Lower-casing the type checked
 * `lead:VIEW_SENSITIVE_FIELDS`, which no role can be given, so the switch
 * reached nobody and a sensitive field was withheld from every role.
 */
const MODULE_OF: Readonly<Record<string, string>> = {
  LEAD: 'leads',
  CONTACT: 'contacts',
  ACCOUNT: 'accounts',
  OPPORTUNITY: 'opportunities',
};

/**
 * Whether this role reads `field` as stored, neither masked nor absent. A rule
 * row decides first; a sensitive field with no rule follows VIEW_SENSITIVE_FIELDS.
 */
export function seesField(
  ctx: Ctx,
  objectType: string,
  rules: Map<string, FieldRule>,
  field: string,
  sensitiveFields: SensitiveFields = {},
): boolean {
  const rule = rules.get(field);
  if (rule) return rule.canView;
  if (!Object.hasOwn(sensitiveFields, field)) return true;
  return can(ctx, MODULE_OF[objectType] ?? objectType.toLowerCase(), 'VIEW_SENSITIVE_FIELDS');
}

export function applyFieldSecurity<T extends Record<string, unknown>>(
  ctx: Ctx,
  objectType: string,
  rules: Map<string, FieldRule>,
  record: T,
  sensitiveFields: SensitiveFields = {},
): Partial<T> {
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(record)) {
    if (seesField(ctx, objectType, rules, k, sensitiveFields)) {
      out[k] = v;
      continue;
    }
    const rule = rules.get(k);
    const strategy = rule ? (rule.maskStrategy ?? 'HIDE') : sensitiveFields[k];
    // HIDE, or a rule with no strategy: the key is absent entirely.
    if (strategy && strategy !== 'HIDE') out[k] = mask(v, strategy);
  }
  return out as Partial<T>;
}

/** Drops fields the actor may not write, so a crafted payload cannot smuggle them in. */
export function stripUneditableFields<T extends Record<string, unknown>>(rules: Map<string, FieldRule>, payload: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    const rule = rules.get(k);
    if (rule && !rule.canEdit) continue;
    out[k] = v;
  }
  return out as T;
}

/**
 * Filtering or sorting on a hidden field would let a caller recover the masked value
 * by binary search. Reject it rather than silently ignoring the clause.
 */
export function assertFilterableFields(
  rules: Map<string, FieldRule>,
  fields: readonly string[],
  /** Further fields this role sees masked — the sensitive ones, see `seesField`. */
  withheld: (field: string) => boolean = () => false,
) {
  const blocked = fields.filter((f) => rules.get(f)?.canView === false || withheld(f));
  if (blocked.length) {
    throw new AppError(
      403,
      'forbidden',
      `Cannot filter or sort on restricted field${blocked.length > 1 ? 's' : ''}: ${blocked.join(', ')}.`,
    );
  }
}

function mask(value: unknown, strategy: MaskStrategy): string | null {
  if (value == null) return null;
  const s = String(value);
  switch (strategy) {
    case 'MASK_ALL':
      return '•'.repeat(Math.min(s.length, 9));
    case 'MASK_PARTIAL':
      // The first four and the last two, separators as typed: "+971 50 123 4567"
      // reads "+971 •• ••• ••67" — enough to recognise a number, not to dial it.
      // The same reach as a listing owner's mask (lib/inventory/listings.ts).
      return s.length <= 6
        ? '•'.repeat(s.length)
        : `${s.slice(0, 4)}${s.slice(4, -2).replace(/[^\s().-]/g, '•')}${s.slice(-2)}`;
    case 'MASK_EMAIL': {
      const [local, domain] = s.split('@');
      if (!domain) return '•'.repeat(s.length);
      return `${local.slice(0, 1)}${'•'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
    }
    default:
      return null;
  }
}
