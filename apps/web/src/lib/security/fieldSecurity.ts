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

export function applyFieldSecurity<T extends Record<string, unknown>>(
  ctx: Ctx,
  objectType: string,
  rules: Map<string, FieldRule>,
  record: T,
  sensitiveFields: readonly string[] = [],
): Partial<T> {
  const bypass = can(ctx, objectType.toLowerCase(), 'VIEW_SENSITIVE_FIELDS');
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(record)) {
    const rule = rules.get(k);

    if (!bypass && sensitiveFields.includes(k) && !rule?.canView) continue;
    if (rule && !rule.canView) {
      if (rule.maskStrategy && rule.maskStrategy !== 'HIDE') {
        out[k] = mask(v, rule.maskStrategy);
      }
      continue; // HIDE, or no strategy: the key is absent entirely
    }
    out[k] = v;
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
export function assertFilterableFields(rules: Map<string, FieldRule>, fields: readonly string[]) {
  const blocked = fields.filter((f) => rules.get(f)?.canView === false);
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
      return s.length <= 4
        ? '•'.repeat(s.length)
        : `${s.slice(0, 5)}${'•'.repeat(Math.max(s.length - 7, 1))}${s.slice(-2)}`;
    case 'MASK_EMAIL': {
      const [local, domain] = s.split('@');
      if (!domain) return '•'.repeat(s.length);
      return `${local.slice(0, 1)}${'•'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
    }
    default:
      return null;
  }
}
