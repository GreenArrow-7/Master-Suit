import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { layoutBody, leadFormLayout } from '@/lib/leads/formLayout';

/**
 * The Add lead form's order and hidden fields (M18-04), saved whole from
 * Administration → Settings → Custom Fields. A fixed field sent hidden is kept
 * shown, a field left out keeps its place after the others.
 */
export const PUT = route(
  {
    module: 'settings',
    action: 'MANAGE_CONFIGURATION',
    productModule: LEAD_MODULES,
    body: layoutBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, body }) => {
    const fields = leadFormLayout(body.fields);
    const leadFormLayoutValue = fields.map(({ key, hidden }) => ({ key, hidden }));
    await prisma.organizationSetting.upsert({
      where: { tenantId: ctx.tenantId },
      create: { tenantId: ctx.tenantId, leadFormLayout: leadFormLayoutValue },
      update: { leadFormLayout: leadFormLayoutValue },
    });
    return { fields };
  },
);
