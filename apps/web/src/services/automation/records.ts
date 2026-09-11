import { prisma } from '@/lib/db';
import { assertWritableField } from './writableFields';

/**
 * The handful of object types the automation engine can act on today. Extend as
 * more entities need automation coverage — see docs/04-AUTOMATION-ENGINE.md §1.
 */
const MODELS = {
  LEAD: 'lead',
  OPPORTUNITY: 'opportunity',
  ACCOUNT: 'account',
  CONTACT: 'contact',
} as const;

export type AutomationObjectType = keyof typeof MODELS;

export function isAutomationObjectType(v: string): v is AutomationObjectType {
  return v in MODELS;
}

function delegate(objectType: AutomationObjectType) {
  return (prisma as any)[MODELS[objectType]];
}

export async function loadRecord(tenantId: string, objectType: AutomationObjectType, recordId: string) {
  return delegate(objectType).findFirst({ where: { tenantId, id: recordId } });
}

/**
 * The generic write boundary for automation.
 *
 * `field` arrives from rule configuration and is interpolated into `data`, so
 * this is the one place in the application where an arbitrary column name
 * reaches a `Lead` update. Everything else validates against a `.strict()`
 * schema. See `writableFields.ts` for what is refused and why.
 */
export async function updateRecordField(
  tenantId: string,
  objectType: AutomationObjectType,
  recordId: string,
  field: string,
  value: unknown,
) {
  assertWritableField(objectType, field);
  await delegate(objectType).updateMany({ where: { tenantId, id: recordId }, data: { [field]: value } });
}

export async function addTag(tenantId: string, objectType: AutomationObjectType, recordId: string, tag: string) {
  const record = await loadRecord(tenantId, objectType, recordId);
  if (!record) return;
  const tags: string[] = record.tags ?? [];
  if (tags.includes(tag)) return;
  await updateRecordField(tenantId, objectType, recordId, 'tags', [...tags, tag]);
}
