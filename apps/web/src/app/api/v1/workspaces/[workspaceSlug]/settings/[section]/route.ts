import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { requireWorkspace } from '@/lib/workspace';

/**
 * Company administration that a company administrator can actually perform.
 *
 * The admin area was output-only: company profile, security posture, modules and
 * subscription each rendered a two-column table with no form, no button and no
 * input. A customer who rebranded could not change their own display name.
 *
 * Only the two sections a company owns are writable here. Modules and
 * subscription are deliberately absent — those belong to the platform owner, and
 * an endpoint that let a workspace grant itself a module would make the
 * entitlement system decorative.
 */
const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  section: z.enum(['company', 'security']),
});

const companyBody = z.object({
  displayName: z.string().min(2).max(120).optional(),
  legalName: z.string().min(2).max(180).optional(),
  industry: z.string().max(100).nullable().optional(),
  timezone: z.string().min(1).max(80).optional(),
  currency: z.string().length(3).optional(),
  companyEmail: z.string().email().nullable().optional().or(z.literal('')),
  companyPhone: z.string().max(40).nullable().optional().or(z.literal('')),
  companyAddress: z.string().max(500).nullable().optional().or(z.literal('')),
  logoUrl: z.string().url().nullable().optional().or(z.literal('')),
});

const securityBody = z.object({
  mfaRequired: z.coerce.boolean().optional(),
  passwordPolicy: z
    .object({
      minLength: z.coerce.number().int().min(8).max(128),
      requireUpper: z.coerce.boolean(),
      requireLower: z.coerce.boolean(),
      requireNumber: z.coerce.boolean(),
      requireSymbol: z.coerce.boolean().optional(),
      reuseWindow: z.coerce.number().int().min(0).max(24).optional(),
    })
    .optional(),
});

export const PATCH = route(
  {
    module: 'settings',
    action: 'MANAGE_CONFIGURATION',
    params: paramsSchema,
    body: z.record(z.string(), z.unknown()),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug);

    if (params.section === 'company') {
      const input = companyBody.parse(body);
      return prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          displayName: input.displayName,
          legalName: input.legalName,
          industry: input.industry || null,
          timezone: input.timezone,
          currency: input.currency?.toUpperCase(),
          companyEmail: input.companyEmail ? input.companyEmail.toLowerCase() : null,
          companyPhone: input.companyPhone || null,
          ...(input.companyAddress === undefined
            ? {}
            : { address: input.companyAddress ? { formatted: input.companyAddress } : {} }),
          ...(input.logoUrl === undefined ? {} : { logoUrl: input.logoUrl || null }),
        },
        select: {
          displayName: true,
          legalName: true,
          industry: true,
          timezone: true,
          currency: true,
          companyEmail: true,
          companyPhone: true,
          logoUrl: true,
        },
      });
    }

    const input = securityBody.parse(body);
    const existing = await prisma.organizationSetting.findUnique({ where: { tenantId: ctx.tenantId } });
    if (!existing) throw NotFound('Workspace settings');

    // Turning `mfaRequired` on is safe now: a user who has not enrolled is given
    // a restricted enrolment grant at login rather than being locked out (P1-3).
    // Before that existed, this toggle would have shut out the whole company.
    return prisma.organizationSetting.update({
      where: { tenantId: ctx.tenantId },
      data: {
        mfaRequired: input.mfaRequired,
        ...(input.passwordPolicy ? { passwordPolicy: input.passwordPolicy } : {}),
      },
      select: { mfaRequired: true, passwordPolicy: true },
    });
  },
);
