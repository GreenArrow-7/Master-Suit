import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import { completeness, deleteProfile, profileFor, upsertProfile } from '@/services/clients/profile';

const EMPLOYMENT = [
  'SALARIED',
  'SELF_EMPLOYED',
  'BUSINESS_OWNER',
  'PROFESSIONAL',
  'RETIRED',
  'STUDENT',
  'NOT_WORKING',
  'UNDISCLOSED',
] as const;
const EDUCATION = ['SCHOOL', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'DOCTORATE', 'OTHER', 'UNDISCLOSED'] as const;
const INTENT = ['END_USE', 'INVESTMENT', 'BOTH', 'UNDECIDED'] as const;

const listQuery = z
  .object({
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    purchaseIntent: z.enum(INTENT).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** One person's profile when a subject is given, otherwise the list. */
export const GET = route(
  { module: 'clientprofiles', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    if (query.leadId || query.contactId) {
      return profileFor(ctx, { leadId: query.leadId, contactId: query.contactId });
    }

    const scope = await visibilityWhere(ctx, 'clientprofiles', 'VIEW');
    const rows = await prisma.clientProfile.findMany({
      where: { ...scope, deletedAt: null, ...(query.purchaseIntent ? { purchaseIntent: query.purchaseIntent } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: query.limit,
    });

    // The wizard's resume point travels with each row, so a list can show how
    // far along each profile is without a second call per row.
    return { data: rows.map((p) => ({ ...p, completeness: completeness(p as unknown as Record<string, unknown>) })) };
  },
);

const upsertBody = z
  .object({
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),

    profession: z.string().max(120).nullish(),
    employmentType: z.enum(EMPLOYMENT).nullish(),
    education: z.enum(EDUCATION).nullish(),
    languages: z.array(z.string().min(2).max(16)).max(12).optional(),
    nationality: z.string().max(80).nullish(),
    residencyStatus: z.string().max(80).nullish(),

    purchaseIntent: z.enum(INTENT).optional(),

    annualIncomeMin: z.coerce.number().nonnegative().nullish(),
    annualIncomeMax: z.coerce.number().nonnegative().nullish(),
    investmentCapacity: z.coerce.number().nonnegative().nullish(),
    currency: z.string().length(3).optional(),

    isMortgageRequired: z.boolean().nullish(),
    mortgagePreApproved: z.boolean().nullish(),

    notes: z.string().max(4000).nullish(),
  })
  .strict()
  .refine((v) => v.annualIncomeMin == null || v.annualIncomeMax == null || v.annualIncomeMax >= v.annualIncomeMin, {
    path: ['annualIncomeMax'],
    message: 'The top of the band is below the bottom of it.',
  });

/**
 * Saving a step.
 *
 * One verb for create and update because the caller is a wizard and step two
 * does not know whether step one made the row. Absent keys are left alone, so
 * saving one step never blanks another.
 */
export const POST = route(
  {
    module: 'clientprofiles',
    productModule: 'SALES',
    action: 'CREATE',
    body: upsertBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, body }) => {
    const { leadId, contactId, ...fields } = body;
    return upsertProfile({ ctx, subject: { leadId, contactId }, fields });
  },
);

const deleteBody = z.object({ profileId: z.string().cuid() }).strict();

export const DELETE = route(
  {
    module: 'clientprofiles',
    productModule: 'SALES',
    action: 'DELETE',
    body: deleteBody,
    auditEvent: 'RECORD_DELETED',
  },
  async ({ ctx, body }) => deleteProfile({ ctx, profileId: body.profileId }),
);
