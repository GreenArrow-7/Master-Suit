import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { requirePageAccess } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
import { leadFormLayout } from '@/lib/leads/formLayout';
import { fieldForScreen, leadFields } from '@/services/leads/customFields';
import FieldEditor from './FieldEditor';
import FormLayout from './FormLayout';

export const metadata = { title: 'Custom fields' };

/**
 * Fields of the workspace's own on every lead (M4-13): text, number, date or a
 * select, filled on the lead's Overview and offered as lead-list columns. A
 * field is switched off, never deleted, so the values on leads stay. Below
 * them, the Add lead form's order and hidden fields (M18-04).
 */
export default async function CustomFieldsPage() {
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['settings', 'VIEW'] });
  const [fields, setting] = await Promise.all([
    leadFields(prisma, ctx.tenantId),
    prisma.organizationSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { leadFormLayout: true } }),
  ]);
  const canEdit = can(ctx, 'settings', 'MANAGE_CONFIGURATION');
  return (
    <>
      <ListHeader
        title="Custom fields"
        description="Fields of your own on every lead, filled on the lead's Overview and offered as columns on the lead list."
        help={
          <p>
            The key and the type are fixed once a field exists. A field that is switched off leaves the lead page and
            the column list; the values already on leads are kept.
          </p>
        }
      />
      <FieldEditor canEdit={canEdit} fields={fields.map(fieldForScreen)} />
      <div style={{ marginTop: 'var(--lf-space-5)' }}>
        <FormLayout canEdit={canEdit} fields={leadFormLayout(setting?.leadFormLayout)} />
      </div>
    </>
  );
}
