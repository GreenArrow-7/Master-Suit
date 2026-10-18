import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid, NotFound } from '@/lib/errors';
import { WORKSPACE_RETENTION, workspaceRetention, type WorkspaceRetentionKey } from '@/lib/jobs/retention';
import { requireWorkspace } from '@/lib/workspace';
import { WORKSPACE_LOCALES, type WorkspaceLocale } from '@/lib/locale';

/**
 * Company administration that a company administrator can actually perform.
 *
 * The admin area was output-only: company profile, security posture, modules and
 * subscription each rendered a two-column table with no form, no button and no
 * input. A customer who rebranded could not change their own display name.
 *
 * Only the sections a company owns are writable here (company, security, and its
 * data retention — longer than the deployment's, never shorter). Modules and
 * subscription are deliberately absent — those belong to the platform owner, and
 * an endpoint that let a workspace grant itself a module would make the
 * entitlement system decorative.
 */
const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  section: z.enum(['company', 'security', 'retention']),
});

const hex = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'A colour is # and six hex digits, e.g. #2447C7.')
  .transform((value) => value.toUpperCase());

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
  /** The colours the workspace's public pages draw with (M18-09): `#RRGGBB`. */
  primaryColor: hex.optional(),
  accentColor: hex.optional(),
  /** The brokerage's RERA ORN (M12-04): portal feeds, shared pages and proposals print it. */
  reraOrn: z.string().trim().max(40).nullable().optional(),
  /** The workspace's language; Arabic lays it out right to left (NFR-09). */
  locale: z.enum(WORKSPACE_LOCALES.map((l) => l.value) as [WorkspaceLocale, ...WorkspaceLocale[]]).optional(),
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
      /**
       * How many previous passwords may not be reused. Enforced by
       * services/identity/passwordHistory.ts against the PasswordHistory table.
       *
       * Capped at 24 because each entry costs one argon2 verification on every
       * password change — at the configured memory cost, sequentially. 24 is
       * about a second; there is no reason to offer a number that makes changing
       * a password feel broken.
       */
      reuseWindow: z.coerce.number().int().min(0).max(24).optional(),
      /**
       * Days before a password must be replaced. 0 or absent means never.
       *
       * Typed on PasswordPolicy since it was written and settable nowhere, so an
       * administrator could not turn it on even though the type said it existed.
       * Enforced at login and on every workspace page — see `passwordExpired`.
       *
       * The floor of 30 is deliberate: rotation below that is the setting that
       * makes people write passwords down, and offering 1 would let somebody lock
       * their whole company out on a typo.
       */
      maxAgeDays: z.coerce.number().int().min(30).max(3650).nullable().optional(),
    })
    .optional(),
});

/**
 * Days a workspace keeps a data class (M18-11); empty or null follows the deployment.
 * 30 is the deployment's own typo guard (lib/env.ts); the floor that matters is the
 * deployment's window, checked in the handler because it is read at request time.
 */
const retentionDays = z
  .preprocess((value) => (value === '' ? null : value), z.coerce.number().int().min(30).max(36_500).nullable())
  .optional();
const retentionBody = z.object({
  auditLog: retentionDays,
  attendancePunch: retentionDays,
  aiEvent: retentionDays,
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
      // The brand colours, the ORN and the language live on the settings row, which the
      // public pages (agencyOf) and the workspace frame (its `dir`) read.
      const settings = {
        ...(input.primaryColor && { primaryColor: input.primaryColor }),
        ...(input.accentColor && { accentColor: input.accentColor }),
        ...(input.reraOrn !== undefined && { reraOrn: input.reraOrn || null }),
        ...(input.locale && { defaultLocale: input.locale }),
      };
      const { defaultLocale, ...brand } = await prisma.organizationSetting.upsert({
        where: { tenantId: ctx.tenantId },
        create: { tenantId: ctx.tenantId, ...settings },
        update: settings,
        select: { primaryColor: true, accentColor: true, reraOrn: true, defaultLocale: true },
      });
      const company = await prisma.tenant.update({
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
      return { ...company, ...brand, locale: defaultLocale };
    }

    if (params.section === 'retention') {
      const input = retentionBody.parse(body);
      const keys = Object.keys(WORKSPACE_RETENTION) as WorkspaceRetentionKey[];
      // Lengthen only (owner, 18 Oct): a window below the deployment's would be ignored
      // by the sweep, so it is refused rather than stored as a promise nobody keeps.
      const tooShort = keys.flatMap((key) => {
        const days = input[key];
        const floor = WORKSPACE_RETENTION[key].days();
        return typeof days === 'number' && floor !== undefined && days < floor
          ? [
              {
                field: key,
                code: 'below_deployment',
                message: `The deployment keeps this ${floor} days; a workspace may only keep it longer.`,
              },
            ]
          : [];
      });
      if (tooShort.length) throw Invalid(tooShort);

      const existing = await prisma.organizationSetting.findUnique({
        where: { tenantId: ctx.tenantId },
        select: { retentionPolicy: true },
      });
      const policy = { ...((existing?.retentionPolicy ?? {}) as Record<string, unknown>) };
      for (const key of keys) {
        if (input[key] === null) delete policy[key];
        else if (input[key] !== undefined) policy[key] = input[key];
      }
      const saved = await prisma.organizationSetting.upsert({
        where: { tenantId: ctx.tenantId },
        create: { tenantId: ctx.tenantId, retentionPolicy: policy as object },
        update: { retentionPolicy: policy as object },
        select: { retentionPolicy: true },
      });
      return workspaceRetention(saved.retentionPolicy);
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
