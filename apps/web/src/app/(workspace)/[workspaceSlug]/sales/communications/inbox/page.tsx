import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import PageHeader from '@/components/ui/PageHeader';
import ConversationInbox from '@/components/communications/ConversationInbox';

export const metadata = { title: 'Inbox' };

/**
 * The messaging workspace (§25).
 *
 * A sibling of the Communications log rather than a replacement for it: §38 asks
 * whether a unified inbox or channel inboxes fit better and says not to force a
 * redesign that breaks what exists. The log answers "what was sent to this
 * customer, on every channel" and the grid it is built on is the right shape for
 * that. This answers "what is happening right now, and what do I reply" — a
 * different question that a table cannot ask.
 *
 * The three-column layout is the same reason: an agent needs the customer's CRM
 * context beside the conversation, not one click away (§28).
 */
export default async function InboxPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['communications', 'VIEW'] });

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Communications"
        title="Inbox"
        description="Live customer conversations, with the CRM record beside them."
        breadcrumbs={[{ label: 'Communications' }, { label: 'Inbox' }]}
      />
      <ConversationInbox
        workspaceSlug={workspaceSlug}
        // Resolved server-side: the composer is a client component and cannot
        // evaluate permissions itself.
        canSend={can(ctx, 'communications', 'CREATE')}
      />
    </div>
  );
}
