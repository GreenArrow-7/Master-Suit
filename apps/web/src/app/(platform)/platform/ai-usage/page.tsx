import { requirePlatformPage } from '@/lib/platform-page';
import { loadAiUsage } from './data';
import AiUsageView from './AiUsageView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI usage' };

/**
 * What the AI is costing, and whose key paid for it.
 *
 * Three steps, in this order and only this order: authorize, read, render.
 *
 * The module exports nothing else. It used to export the page's body so a
 * render test could call it without a request scope, and that left a function
 * on the route module capable of producing the entire protected page with no
 * gate in front of it. The body now lives in `data.ts` and `AiUsageView.tsx`,
 * neither of which can reach protected data on its own: the loader is not a
 * route, and the view is pure. See `BUG-008`.
 */
export default async function AiUsagePage() {
  await requirePlatformPage();
  const data = await loadAiUsage();
  return <AiUsageView {...data} />;
}
