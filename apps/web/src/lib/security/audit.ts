import { prisma } from '../db';
import type { Ctx } from './rbac';

export type AuditEventName =
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOGIN_FAILED'
  | 'PASSWORD_CHANGED'
  | 'MFA_ENROLLED'
  | 'RECORD_CREATED'
  | 'RECORD_UPDATED'
  | 'RECORD_DELETED'
  | 'RECORD_RESTORED'
  | 'STAGE_CHANGED'
  | 'OWNER_CHANGED'
  | 'PERMISSION_CHANGED'
  | 'EXPORT_REQUESTED'
  | 'IMPORT_STARTED'
  | 'API_KEY_CREATED'
  | 'API_KEY_REVOKED'
  | 'AUTOMATION_MODIFIED'
  | 'INTEGRATION_MODIFIED'
  | 'DOCUMENT_ACCESSED'
  | 'SENSITIVE_FIELD_VIEWED'
  | 'TARGET_CREATED'
  | 'TARGET_UPDATED'
  | 'CALL_STARTED'
  | 'CALL_COMPLETED'
  | 'RECORDING_ACCESSED'
  | 'CONSENT_RECORDED'
  | 'CONSENT_WITHDRAWN'
  | 'AI_ANALYSIS_COMPLETED'
  | 'CALL_AUDIT_COMPLETED';

export interface AuditInput {
  event: AuditEventName;
  objectType?: string;
  recordId?: string;
  fieldKey?: string;
  previousValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Field names that are credentials rather than data.
 *
 * One list, two consumers: the audit writer below refuses to record them, and
 * `lib/api/handler.ts` refuses to serialise them into a response. Adding a
 * column here is the single place that closes both egress paths at once.
 */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  'passwordHash',
  'mfaSecret',
  'mfaRecoveryCodes',
  'tokenHash',
  'keyHash',
  'configEncrypted',
  'signingSecretEnc',
]);

/** Values that must never reach the audit table, even as a "previous value". */
const NEVER_LOG = SECRET_KEYS;

export async function audit(ctx: Ctx, input: AuditInput, tx: any = prisma) {
  if (input.fieldKey && NEVER_LOG.has(input.fieldKey)) return;

  await tx.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.apiKeyId ? null : ctx.actor.id,
      actorApiKeyId: ctx.apiKeyId ?? null,
      actorType: ctx.apiKeyId ? 'API_KEY' : 'USER',
      event: input.event as any,
      objectType: input.objectType ?? null,
      recordId: input.recordId ?? null,
      fieldKey: input.fieldKey ?? null,
      previousValue: redact(input.previousValue) as any,
      newValue: redact(input.newValue) as any,
      metadata: (input.metadata ?? {}) as any,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    },
  });
}

/**
 * Emits one audit row per changed field rather than a single blob, so the audit
 * viewer can answer "who changed the phone number" without parsing JSON.
 */
export async function auditDiff(
  ctx: Ctx,
  objectType: string,
  recordId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  tx: any = prisma,
) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rows: AuditInput[] = [];

  for (const k of keys) {
    if (NEVER_LOG.has(k)) continue;
    if (Object.is(before[k], after[k])) continue;
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;

    const event: AuditEventName =
      k === 'stageId' ? 'STAGE_CHANGED' : k === 'ownerId' ? 'OWNER_CHANGED' : 'RECORD_UPDATED';

    rows.push({ event, objectType, recordId, fieldKey: k, previousValue: before[k], newValue: after[k] });
  }

  for (const r of rows) await audit(ctx, r, tx);
  return rows.length;
}

function redact(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = NEVER_LOG.has(k) ? '[redacted]' : v;
  }
  return out;
}
