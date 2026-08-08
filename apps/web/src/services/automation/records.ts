import { prisma } from '@/lib/db';

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

export async function updateRecordField(
  tenantId: string,
  objectType: AutomationObjectType,
  recordId: string,
  field: string,
  value: unknown,
) {
  await delegate(objectType).updateMany({ where: { tenantId, id: recordId }, data: { [field]: value } });
}

export async function addTag(tenantId: string, objectType: AutomationObjectType, recordId: string, tag: string) {
  const record = await loadRecord(tenantId, objectType, recordId);
  if (!record) return;
  const tags: string[] = record.tags ?? [];
  if (tags.includes(tag)) return;
  await updateRecordField(tenantId, objectType, recordId, 'tags', [...tags, tag]);
}
