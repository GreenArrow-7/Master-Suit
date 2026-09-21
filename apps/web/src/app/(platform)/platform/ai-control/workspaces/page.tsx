import { requirePlatformPage } from '@/lib/platform-page';
import { loadWorkspaces } from '@/services/ai/console';
import WorkspacesView from './WorkspacesView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI usage by workspace' };

/** Authorize, read, render — and export nothing else. See `ai-usage/page.tsx`. */
export default async function AiWorkspacesPage() {
  await requirePlatformPage();
  const data = await loadWorkspaces();
  return <WorkspacesView {...data} />;
}
