import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform-page';
import { loadWorkspace } from '@/services/ai/console';
import WorkspaceView from './WorkspaceView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workspace AI usage' };

export default async function AiWorkspacePage({ params }: { params: Promise<{ tenantId: string }> }) {
  await requirePlatformPage();
  const { tenantId } = await params;
  const data = await loadWorkspace(tenantId);
  if (!data) notFound();
  return <WorkspaceView {...data} />;
}
