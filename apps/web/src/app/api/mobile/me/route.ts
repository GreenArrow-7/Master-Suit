import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { loadFieldRules, seesField } from '@/lib/security/fieldSecurity';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { UAE } from '@/services/leads/normalizePhone';
import { workspaceTimezone } from '@/services/hr/attendance';

/**
 * What the phone needs at launch, in the standalone Lead Eagle app's shape.
 * `attendance` reads as nothing to check in at: attendance from the phone is
 * not served here yet (changes/2026-10-19-le-mobile-api.md), and that is the
 * state in which the app offers no check-in button.
 */
export const GET = route(
  { module: 'identity_self', action: 'VIEW', selfService: true, mobile: true },
  async ({ ctx }) => {
    const [tenant, timezone, rules] = await Promise.all([
      prisma.tenant.findFirst({
        where: { id: ctx.tenantId },
        select: { slug: true, displayName: true, currency: true },
      }),
      workspaceTimezone(ctx),
      loadFieldRules(ctx, 'LEAD'),
    ]);
    // "leads:EDIT" → { leads: ['EDIT', …] }, as the app reads a role.
    const permissions: Record<string, string[]> = {};
    for (const key of ctx.actor.permissions.keys()) {
      const [module, action] = key.split(':') as [string, string];
      (permissions[module] ??= []).push(action);
    }
    return {
      user: {
        id: ctx.actor.id,
        fullName: ctx.actor.fullName,
        email: ctx.actor.email,
        role: ctx.actor.roleKey,
        maskContactDetails: !seesField(ctx, 'LEAD', rules, 'phone', LEAD_SENSITIVE_FIELDS),
        permissions,
      },
      workspace: {
        slug: tenant?.slug ?? '',
        name: tenant?.displayName ?? '',
        currency: tenant?.currency ?? 'AED',
        timezone,
        dialCode: UAE,
        // Live call guidance runs in the web call screen, not in this app.
        callAssistEnabled: false,
      },
      attendance: { location: null, enrolled: false },
    };
  },
);
