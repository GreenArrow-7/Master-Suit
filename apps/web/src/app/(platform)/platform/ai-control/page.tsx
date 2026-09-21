import { requirePlatformPage } from '@/lib/platform-page';
import { loadAiControl } from './data';
import AiControlView from './AiControlView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Control Center' };

/**
 * Authorize, read, render — in that order and only that order, and the module
 * exports nothing else. See `ai-usage/page.tsx` and `BUG-008`: a route module
 * that also exports its own body is a way to reach protected data with no gate
 * in front of it.
 */
export default async function AiControlPage() {
  await requirePlatformPage();
  const data = await loadAiControl();
  return <AiControlView {...data} />;
}
