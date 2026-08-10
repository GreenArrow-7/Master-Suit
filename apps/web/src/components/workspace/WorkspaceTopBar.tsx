'use client';

import { usePathname } from 'next/navigation';
import TopBar from '@/components/nav/TopBar';

export default function WorkspaceTopBar({
  slug,
  workspaceName: _workspaceName,
  plan,
}: {
  slug: string;
  workspaceName: string;
  plan: string;
}) {
  const pathname = usePathname();
  return <TopBar basePath={`/${slug}`} module={pathname.includes("/people") ? "people" : "sales"} workspaceName={_workspaceName} plan={plan} />;
}
