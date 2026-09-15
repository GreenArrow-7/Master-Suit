/**
 * Columns an automation rule may not write.
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 *
 * `update_field` passes `spec.field` straight through to
 * `updateRecordField`, which builds `data: { [field]: value }`. Every other
 * write path into `Lead` validates against a `.strict()` Zod schema naming the
 * columns it accepts — the REST PATCH, the CSV import, `createLead`. This one
 * accepted any column name at all.
 *
 * The column that made it matter is `Lead.nextFollowUpAt`. It is derived from
 * the open obligations on the lead and maintained under the lead's row lock by
 * every writer (see `services/leads/nextFollowUp.ts`); a rule configured with
 * `field: "nextFollowUpAt"` overwrites the derived value, recomputes nothing,
 * and leaves every overdue surface reporting a number no obligation supports.
 * The drift canary would report it the next morning, which is detection, not
 * prevention.
 *
 * ── Why a refusal and not a silent drop ─────────────────────────────────────
 *
 * A rule naming a column it may not write is misconfigured, and the engine
 * already takes that position: `runAction` throws on an unknown action rather
 * than no-opping, "so the node fails loudly instead of silently". Dropping the
 * write instead would leave somebody watching a rule that appears to run and
 * changes nothing.
 *
 * ── Deliberately narrow ─────────────────────────────────────────────────────
 *
 * This is a release-freeze guard, not a permissions model for automation. It
 * names the derived column this package introduced plus the identity and audit
 * columns that could never be a legitimate rule target.
 *
 * It does **not** block `score`, `grade`, `slaState`, `slaDueAt` or
 * `lastActivityAt`, which are also maintained by workers and carry the same
 * class of risk. Blocking them would remove a capability a customer may be
 * relying on, and removing capability quietly to make a release look tidy is
 * the thing this release is not doing. They are recorded as a known gap in the
 * release matrix instead.
 *
 * Measured on the validation database at the time of writing: **0
 * `AutomationVersion` rows, so 0 configured `update_field` targets** — no rule
 * anywhere is affected by this guard today. That is one observation of current
 * data, not a guarantee about a customer's workspace, which is why the guard
 * exists rather than the observation being taken as sufficient.
 */
import type { AutomationObjectType } from './records';

/** Never writable by a rule, on any object: identity, tenancy and audit. */
const STRUCTURAL: readonly string[] = [
  'id',
  'tenantId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdById',
  'updatedById',
];

/** Additionally protected, per object type. */
const DERIVED: Record<AutomationObjectType, readonly string[]> = {
  // Derived from the union of open Task and FollowUpTask rows on the lead.
  LEAD: ['nextFollowUpAt', 'reference'],
  OPPORTUNITY: [],
  ACCOUNT: [],
  CONTACT: [],
};

export function protectedFields(objectType: AutomationObjectType): readonly string[] {
  return [...STRUCTURAL, ...DERIVED[objectType]];
}

export function isProtectedField(objectType: AutomationObjectType, field: string): boolean {
  return protectedFields(objectType).includes(field);
}

/** Thrown by `updateRecordField`; surfaces as a failed automation node. */
export class ProtectedFieldError extends Error {
  constructor(objectType: AutomationObjectType, field: string) {
    super(
      `Automation may not write ${objectType}.${field}: it is maintained by the application. ` +
        (field === 'nextFollowUpAt'
          ? 'The next follow-up date is derived from the open tasks and follow-ups on the lead — ' +
            'create or reschedule one of those instead.'
          : 'Choose a field the rule is allowed to set.'),
    );
    this.name = 'ProtectedFieldError';
  }
}

export function assertWritableField(objectType: AutomationObjectType, field: string): void {
  if (isProtectedField(objectType, field)) throw new ProtectedFieldError(objectType, field);
}
