import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { requirePageAccess } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
import EmailTemplateEditor from './EmailTemplateEditor';

export const metadata = { title: 'Email templates' };

/**
 * The workspace's email templates (M4-28): what Send email on a lead and Send
 * template on the lead grid offer. Kept by whoever manages the workspace's
 * settings; archived, never deleted, so a sent message still names its template.
 */
export default async function EmailTemplatesPage() {
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['settings', 'VIEW'] });
  const templates = await prisma.messageTemplate.findMany({
    where: { tenantId: ctx.tenantId, channel: 'EMAIL', deletedAt: null },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, subject: true, body: true, isActive: true },
  });
  return (
    <>
      <ListHeader
        title="Email templates"
        description="The emails an agent sends from a lead, or to many leads from the lead list."
        help={
          <p>
            {
              'Write {{1}} for the lead’s first name and {{2}} for the sender’s name. Any other, such as {{3}}, is asked for when the email is sent.'
            }
          </p>
        }
      />
      <EmailTemplateEditor
        canEdit={can(ctx, 'settings', 'MANAGE_CONFIGURATION')}
        templates={templates.map((t) => ({ ...t, subject: t.subject ?? '' }))}
      />
    </>
  );
}
