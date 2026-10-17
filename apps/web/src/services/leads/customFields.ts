import type { LeadCustomFieldDefinition } from '@prisma/client';
import { prisma, type TxClient } from '@/lib/db';
import { formatTypedDate, parseTypedDate } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import type { ColumnDef } from '@/lib/grid/columns';

type Db = TxClient | typeof prisma;

/**
 * Tenant-defined fields on a lead (Lead Eagle audit row M4-13), defined under
 * Administration → Custom fields and filled on the lead's Overview.
 *
 * A value lives twice, as createLead has always written it: in `Lead.customData`
 * under the field's key (what the screens read) and as a typed
 * LeadCustomFieldValue row. Keys are lower-case, so they never meet the
 * system's own camelCase entries in `customData` (`metaLeadgen`,
 * `socialEnquiry`, `leadEagle`). A field is switched off (`isHidden`), never
 * deleted: values written under it stay on the leads. Field-level security
 * (`isSensitive`) is not applied to these yet.
 */
export const CUSTOM_FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'DROPDOWN'] as const;
export const CUSTOM_FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** The workspace's lead fields in their order; `activeOnly` leaves out the switched-off ones. */
export function leadFields(db: Db, tenantId: string, { activeOnly = false } = {}) {
  return db.leadCustomFieldDefinition.findMany({
    where: { tenantId, objectType: 'LEAD', ...(activeOnly && { isHidden: false }) },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

/** A definition as the API and the screens read it. */
export function fieldForScreen(def: LeadCustomFieldDefinition) {
  return {
    id: def.id,
    key: def.key,
    label: def.label,
    type: def.type,
    options: Array.isArray(def.options) ? (def.options as string[]) : [],
    isRequired: def.isRequired,
    isActive: !def.isHidden,
    displayOrder: def.displayOrder,
  };
}

export type LeadField = ReturnType<typeof fieldForScreen>;

const refuse = (field: string, message: string): never => {
  throw new AppError(422, 'validation-failed', message, [{ field: `custom.${field}`, code: 'invalid', message }]);
};

/** A value for `def`, checked by its type: the stored form, or null to clear it. */
export function fieldValue(def: Pick<LeadField, 'key' | 'label' | 'type' | 'options' | 'isRequired'>, raw: unknown) {
  const text = raw == null ? '' : String(raw).trim();
  if (!text) return def.isRequired ? refuse(def.key, `${def.label} is required.`) : null;
  switch (def.type) {
    case 'NUMBER': {
      const n = Number(text);
      if (!Number.isFinite(n)) return refuse(def.key, `${def.label} must be a number.`);
      // The value column is Decimal(20,6): anything larger fails the insert.
      return Math.abs(n) < 1e14 ? n : refuse(def.key, `${def.label} is too large.`);
    }
    case 'DATE':
      return parseTypedDate(text) === text ? text : refuse(def.key, `${def.label} must be a real date (YYYY-MM-DD).`);
    case 'DROPDOWN':
      return def.options.includes(text)
        ? text
        : refuse(def.key, `${def.label} must be one of: ${def.options.join(', ')}.`);
    default:
      return text.length <= 500 ? text : refuse(def.key, `${def.label} is at most 500 characters.`);
  }
}

/** The typed column a value is kept in (LeadCustomFieldValue). */
export function columnFor(type: string, value: unknown) {
  switch (type) {
    case 'NUMBER':
    case 'CURRENCY':
    case 'PERCENTAGE':
      return { valueNumber: value as any };
    case 'CHECKBOX':
      return { valueBool: Boolean(value) };
    case 'DATE':
    case 'DATETIME':
      return { valueDate: new Date(value as string) };
    case 'MULTI_SELECT':
    case 'GEO_POINT':
    case 'FORMULA':
      return { valueJson: value as any };
    default:
      return { valueText: value == null ? null : String(value) };
  }
}

/**
 * `customData` with `input` applied: each key an active field of the
 * workspace, each value checked by type, null or '' clearing it. Writes the
 * typed value rows in `tx`; the caller writes `customData` and audits the diff.
 */
export async function withCustomValues(
  tx: TxClient,
  tenantId: string,
  leadId: string,
  current: unknown,
  input: Record<string, unknown>,
) {
  const keys = Object.keys(input);
  const defs = await tx.leadCustomFieldDefinition.findMany({
    where: { tenantId, objectType: 'LEAD', isHidden: false, key: { in: keys } },
  });
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const next: Record<string, unknown> = { ...((current ?? {}) as Record<string, unknown>) };
  for (const key of keys) {
    const def = byKey.get(key);
    if (!def) return refuse(key, `There is no custom field ${key}.`);
    const value = fieldValue(fieldForScreen(def), input[key]);
    await tx.leadCustomFieldValue.deleteMany({ where: { tenantId, leadId, definitionId: def.id } });
    if (value === null) {
      delete next[key];
      continue;
    }
    next[key] = value;
    await tx.leadCustomFieldValue.create({
      data: { tenantId, leadId, definitionId: def.id, ...columnFor(def.type, value) },
    });
  }
  return next;
}

/**
 * A new lead's `custom` (POST /api/v1/leads) checked against the workspace's
 * fields: a key a field defines is checked by its type and kept typed, ''
 * dropped; a key no field defines is kept as given, as the create API always
 * has. Returns `customData` and the typed value rows.
 *
 * `required` (a person creating it, M18-03) also refuses each active required
 * field left out or empty. Without it, as for an API key, the import and the
 * intake, a lead that leaves a field out still lands.
 */
export async function customForCreate(
  db: Db,
  tenantId: string,
  input: Record<string, unknown>,
  { required = false } = {},
) {
  const data = { ...input };
  const rows: ({ definitionId: string } & ReturnType<typeof columnFor>)[] = [];
  const keys = Object.keys(input);
  if (!keys.length && !required) return { data, rows };
  const defs = await db.leadCustomFieldDefinition.findMany({
    where: {
      tenantId,
      objectType: 'LEAD',
      OR: [{ key: { in: keys } }, ...(required ? [{ isRequired: true, isHidden: false }] : [])],
    },
  });
  for (const def of defs) {
    const value = fieldValue(
      { ...fieldForScreen(def), isRequired: required && def.isRequired && !def.isHidden },
      input[def.key],
    );
    if (value === null) delete data[def.key];
    else {
      data[def.key] = value;
      rows.push({ definitionId: def.id, ...columnFor(def.type, value) });
    }
  }
  return { data, rows };
}

/** A field's value as a grid cell or a fact shows it. */
export function shownValue(value: unknown) {
  return value == null || value === '' ? null : String(value);
}

/** The lead grid's custom-field columns (`cf:<key>`), offered under Columns; none shown by default. */
export async function customColumns(tenantId: string): Promise<ColumnDef[]> {
  const fields = await leadFields(prisma, tenantId, { activeOnly: true });
  return fields.map((def) => ({
    key: `cf:${def.key}`,
    label: def.label,
    hideMobile: true,
    ...(def.type === 'DATE' && { date: true }),
  }));
}

/** Each row's values for the custom columns, by key, and nothing else of `customData`. */
export function customCells(columns: ColumnDef[], customData: unknown) {
  const data = (customData ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    columns
      .filter((c) => c.key.startsWith('cf:'))
      .map((c) => {
        const value = shownValue(data[c.key.slice(3)]);
        // A date reads DD/MM/YYYY, as on the Overview.
        return [c.key, c.date && value ? formatTypedDate(value) || value : value];
      }),
  );
}
