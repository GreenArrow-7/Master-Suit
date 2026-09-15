'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { buildNavigation, findActive, tabTarget, type NavInput } from '@/lib/nav/workspaceNav';

/**
 * The tabs of the work area the current page belongs to.
 *
 * Links, not an ARIA tablist: each tab is a real page with its own URL, so the
 * browser's back and forward buttons, bookmarks and "open in new tab" all work,
 * and the current one is announced with aria-current. An area with a single
 * screen shows no strip — a lone tab is decoration.
 *
 * Only the tabs the viewer may open are listed; the page behind each still
 * enforces access itself.
 */
export default function WorkAreaTabs(props: NavInput) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { slug, modules, permitted, serviceMode, peopleOversight, platformStaff } = props;
  const sections = useMemo(
    () => buildNavigation({ slug, modules, permitted, serviceMode, peopleOversight, platformStaff }),
    [slug, modules, permitted, serviceMode, peopleOversight, platformStaff],
  );
  const search = new URLSearchParams(searchParams.toString());
  const active = findActive(sections, pathname, search);
  if (!active || active.area.tabs.length < 2) return null;

  return (
    <nav className="lf-tabs lf-area-tabs" aria-label={`${active.area.label} screens`}>
      {active.area.tabs.map((tab) => {
        const current = tab === active.tab;
        return (
          <Link
            key={tab.href}
            className="lf-tab"
            href={tabTarget(tab, active.area, pathname, search)}
            aria-current={current ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
