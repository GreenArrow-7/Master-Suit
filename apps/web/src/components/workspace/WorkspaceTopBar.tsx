'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import TopBar from '@/components/nav/TopBar';
import { activeNavLabel, buildWorkspaceNav, type NavInput } from '@/lib/nav/workspaceNav';

export default function WorkspaceTopBar({
  slug,
  modules,
  permitted,
  serviceMode = false,
  creatable,
}: NavInput & {
  /** Permission modules the signed-in role may CREATE, resolved server-side. */
  creatable?: string[];
}) {
  const pathname = usePathname();
  const view = useSearchParams().get('view');
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
  // The phone app bar names the page from the model the rail lights, so the
  // two can never disagree about where you are.
  const groups = useMemo(
    () => buildWorkspaceNav({ slug, modules, permitted, serviceMode }),
    [slug, modules, permitted, serviceMode],
  );
  return (
    <TopBar
      basePath={`/${slug}`}
      module={activeModule}
      title={activeNavLabel(groups, pathname, view)}
      creatable={creatable}
    />
  );
}
