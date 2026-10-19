import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { mergeWhere } from '@/lib/api/where';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { applyFieldSecurity, loadFieldRules, seesField } from '@/lib/security/fieldSecurity';
import { leadScope, workListScope } from '@/lib/security/record-scope';
import { OPEN_FOLLOW_UP } from '@/lib/leads/followUpDue';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';

/**
 * The phone's Today: the caller's own open follow-ups on leads they reach, due
 * order, in the standalone Lead Eagle app's shape. Overdue is due before today
 * began on the workspace's clock, as the Follow-ups list reads it; a number the
 * role reads masked is not sent.
 */
export const GET = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'VIEW', mobile: true },
  async ({ ctx }) => {
    const [rules, timeZone, mine, leads] = await Promise.all([
      loadFieldRules(ctx, 'LEAD'),
      workspaceTimezone(ctx),
      workListScope(ctx, 'leads', true),
      leadScope(ctx, 'VIEW', { includeUnassigned: true }),
    ]);
    const found = await prisma.followUpTask.findMany({
      where: mergeWhere(mine, OPEN_FOLLOW_UP, {
        deletedAt: null,
        lead: { is: mergeWhere(leads, { deletedAt: null }) },
      }),
      orderBy: { dueAt: 'asc' },
      take: 100,
      select: {
        id: true,
        kind: true,
        dueAt: true,
        description: true,
        lead: {
          select: {
            id: true,
            reference: true,
            fullName: true,
            phone: true,
            phoneNormalized: true,
            stage: { select: { name: true, color: true } },
          },
        },
      },
    });
    const sees = seesField(ctx, 'LEAD', rules, 'phone', LEAD_SENSITIVE_FIELDS);
    const todayBegan = dayBounds(todayKey(timeZone), timeZone).from;
    return {
      rows: found.flatMap(({ lead, ...row }) =>
        lead
          ? [
              {
                id: row.id,
                type: row.kind,
                dueAt: row.dueAt.toISOString(),
                overdue: row.dueAt < todayBegan,
                note: row.description,
                lead: {
                  id: lead.id,
                  reference: lead.reference,
                  fullName: applyFieldSecurity(ctx, 'LEAD', rules, { fullName: lead.fullName }).fullName ?? '',
                  phone: sees ? lead.phone : null,
                  dialable: sees ? (lead.phoneNormalized ?? lead.phone) : null,
                  statusName: lead.stage.name,
                  statusColor: lead.stage.color,
                },
              },
            ]
          : [],
      ),
    };
  },
);
