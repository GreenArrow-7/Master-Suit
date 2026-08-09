/**
 * Who the buyer is.
 *
 * The spec calls this a multi-step profile, and the steps are the only reason
 * this file exists rather than the route writing the row directly: a profile is
 * filled in across several conversations, so every field is optional, saving a
 * partial answer must work, and something has to be able to say where to pick
 * up. That "where" is derived from the row rather than stored, so it cannot
 * disagree with what is actually answered.
 */
import { Prisma } from '@prisma/client';
import { Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { assertRecordVisible } from '@/lib/security/visibility';
import type { Ctx } from '@/lib/security/rbac';

/** Who a profile is about. Exactly one, matching ClientRequirement. */
export interface Subject {
  leadId?: string | null;
  contactId?: string | null;
}

export const STEPS = ['identity', 'means', 'intent'] as const;
export type Step = (typeof STEPS)[number];

/**
 * What each step is considered to be asking.
 *
 * Deliberately a list of field names rather than three hand-written predicates:
 * adding a field to a step should not mean remembering to also edit the function
 * that decides whether the step is done.
 */
const STEP_FIELDS: Record<Step, readonly string[]> = {
  identity: ['profession', 'employmentType', 'education', 'languages', 'nationality', 'residencyStatus'],
  means: ['annualIncomeMin', 'annualIncomeMax', 'investmentCapacity', 'isMortgageRequired', 'mortgagePreApproved'],
  intent: ['purchaseIntent', 'notes'],
};

const answered = (value: unknown) => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  // Before the string check, not after: these are strings, and letting the
  // generic "non-empty string" rule see them first counted the column defaults
  // as answers and reported every new profile as partly complete.
  if (value === 'UNDECIDED' || value === 'UNDISCLOSED') return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

export interface Completeness {
  steps: { step: Step; answered: number; total: number; done: boolean }[];
  /** Where a wizard should open. Null once nothing is left. */
  nextStep: Step | null;
  percent: number;
}

/** Derived, never stored. A stored percentage drifts the moment a field moves. */
export function completeness(profile: Record<string, unknown> | null): Completeness {
  const steps = STEPS.map((step) => {
    const fields = STEP_FIELDS[step];
    const count = profile ? fields.filter((f) => answered(profile[f])).length : 0;
    return { step, answered: count, total: fields.length, done: count > 0 };
  });

  const total = steps.reduce((n, s) => n + s.total, 0);
  const done = steps.reduce((n, s) => n + s.answered, 0);

  return {
    steps,
    nextStep: steps.find((s) => !s.done)?.step ?? null,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

function subjectWhere(ctx: Ctx, subject: Subject) {
  if (!subject.leadId && !subject.contactId) {
    throw Invalid([{ field: 'leadId', code: 'required', message: 'Say whose profile this is.' }]);
  }
  if (subject.leadId && subject.contactId) {
    // Not a hypothetical: the same buyer under two ids is how a profile ends up
    // answering the same question twice, differently.
    throw Invalid([
      { field: 'contactId', code: 'ambiguous', message: 'A profile belongs to one person — a lead or a contact.' },
    ]);
  }
  return subject.leadId
    ? { tenantId: ctx.tenantId, leadId: subject.leadId, deletedAt: null }
    : { tenantId: ctx.tenantId, contactId: subject.contactId!, deletedAt: null };
}

export type ProfileFields = Omit<
  Prisma.ClientProfileUncheckedCreateInput,
  'id' | 'tenantId' | 'leadId' | 'contactId' | 'createdAt' | 'updatedAt' | 'createdById' | 'updatedById' | 'deletedAt'
>;

export interface UpsertInput {
  ctx: Ctx;
  subject: Subject;
  fields: Partial<ProfileFields>;
}

/**
 * Save whatever has been answered so far.
 *
 * An upsert rather than create-then-edit because the caller is a wizard: step
 * two does not know or care whether step one created the row. Undefined fields
 * are left alone, so saving one step cannot blank another — the difference
 * between "not answered yet" and "answered as nothing" is the whole reason a
 * partial save is safe.
 */
export async function upsertProfile(input: UpsertInput) {
  const { ctx } = input;
  const where = subjectWhere(ctx, input.subject);

  return withTx(ctx.tenantId, async (tx) => {
    const existing = await tx.clientProfile.findFirst({ where });

    if (existing) {
      await assertRecordVisible(ctx, 'clientprofiles', existing, tx, 'EDIT');
      const updated = await tx.clientProfile.update({
        where: { id: existing.id, tenantId: ctx.tenantId },
        data: { ...input.fields, updatedById: ctx.actor.id },
      });
      await audit(
        ctx,
        {
          event: 'RECORD_UPDATED',
          objectType: 'clientprofiles',
          recordId: existing.id,
          previousValue: existing as unknown as Record<string, unknown>,
          newValue: input.fields as Record<string, unknown>,
        },
        tx,
      );
      return { profile: updated, created: false };
    }

    const created = await tx.clientProfile.create({
      data: {
        tenantId: ctx.tenantId,
        leadId: input.subject.leadId ?? null,
        contactId: input.subject.contactId ?? null,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
        ...input.fields,
      },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'clientprofiles',
        recordId: created.id,
        previousValue: {},
        newValue: input.fields as Record<string, unknown>,
      },
      tx,
    );

    return { profile: created, created: true };
  });
}

/** The profile and where a wizard should resume. Null profile is a valid answer. */
export async function profileFor(ctx: Ctx, subject: Subject) {
  const profile = await prisma.clientProfile.findFirst({ where: subjectWhere(ctx, subject) });
  return { profile, completeness: completeness(profile as Record<string, unknown> | null) };
}

export interface DeleteInput {
  ctx: Ctx;
  profileId: string;
}

/** Soft, like leads and listings. Somebody asking to be forgotten is a request
 *  to stop using their answers, not licence to lose the audit trail. */
export async function deleteProfile(input: DeleteInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const existing = await tx.clientProfile.findFirst({
      where: { id: input.profileId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!existing) throw NotFound('Client profile');
    await assertRecordVisible(ctx, 'clientprofiles', existing, tx, 'DELETE');

    const removed = await tx.clientProfile.update({
      where: { id: existing.id, tenantId: ctx.tenantId },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_DELETED',
        objectType: 'clientprofiles',
        recordId: existing.id,
        previousValue: existing as unknown as Record<string, unknown>,
        newValue: {},
      },
      tx,
    );

    return removed;
  });
}
