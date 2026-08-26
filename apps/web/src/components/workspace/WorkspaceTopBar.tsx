'use client';

import { usePathname } from 'next/navigation';
import TopBar from '@/components/nav/TopBar';

export default function WorkspaceTopBar({
  slug,
  workspaceName: _workspaceName,
  plan,
  creatable,
}: {
  slug: string;
  workspaceName: string;
  plan: string;
  /** Permission modules the signed-in role may CREATE, resolved server-side. */
  creatable?: string[];
}) {
  const pathname = usePathname();
  /**
   * The module is the third path segment, `/{slug}/people/...` — not a substring.
   *
   * `pathname.includes('/people')` matched two things it should not have:
   * `/{slug}/sales/people`, a Sales screen, which then rendered the HR top bar;
   * and every screen of any workspace whose slug contains the word, so a tenant
   * slugged `peoplefirst-realty` saw the HR chrome on its Leads list. This is the
   * same test `ModuleTheme` already used, so the three now agree.
   */
  const activeModule = pathname.split('/')[2] === 'people' ? 'people' : 'sales';
  return (
    <TopBar
      basePath={`/${slug}`}
      module={activeModule}
      workspaceName={_workspaceName}
      plan={plan}
      creatable={creatable}
    />
  );
}
