import { resolveWorkspacePage } from '@/lib/workspace-page';
import { ASSISTANT_NAME, ASSISTANT_TAGLINE } from '@/lib/branding';
import PageHeader from '@/components/ui/PageHeader';
import AiLanding from './AiLanding';

export const metadata = { title: ASSISTANT_NAME };

/**
 * Gated exactly as the assistant API is: the Sales entitlement and leads:VIEW
 * (app/api/v1/assistant/route.ts). The rail's item carries the same gate, so a
 * person who can see the link can use the page.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await resolveWorkspacePage(workspaceSlug, { module: 'SALES', permission: ['leads', 'VIEW'] });
  return (
    <div className="lf-page-stack">
      <PageHeader title={ASSISTANT_NAME} description={ASSISTANT_TAGLINE} />
      <AiLanding
        prompts={[
          'What should I focus on today?',
          'Show my overdue follow-ups',
          'Which leads have breached SLA?',
          'Summarize my latest recorded call',
        ]}
      />
    </div>
  );
}
