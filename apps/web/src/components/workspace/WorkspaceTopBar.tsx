'use client';

import { usePathname } from 'next/navigation';
import TopBar from '@/components/nav/TopBar';

export default function WorkspaceTopBar({
  slug,
  workspaceName: _workspaceName,
  plan,
  creatable,
  modules = [],
}: {
  slug: string;
  workspaceName: string;
  plan: string;
  /** Permission modules the signed-in role may CREATE, resolved server-side. */
  creatable?: string[];
  /** The product modules this workspace is entitled to. */
  modules?: string[];
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
  // Where + Create sends a new lead, call or event: the Real Estate screens when
  // the viewer is working in Real Estate, or when the workspace has no Sales.
  const crmRoot =
    pathname.split('/')[2] === 'realty' || (!modules.includes('SALES') && modules.includes('REAL_ESTATE'))
      ? 'realty'
      : 'sales';
  return (
    <TopBar
      basePath={`/${slug}`}
      module={activeModule}
      workspaceName={_workspaceName}
      plan={plan}
      creatable={creatable}
      crmRoot={crmRoot}
    />
  );
}
