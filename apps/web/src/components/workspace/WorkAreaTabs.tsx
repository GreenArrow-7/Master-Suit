'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
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
 *
 * An area can hold more tabs than fit (Settings has fourteen), so the strip
 * scrolls. On every navigation — first load, direct link, click, back/forward —
 * the active tab is brought into the strip by moving the strip's own scroll
 * position, never the page's, and without touching focus. `data-more` names the
 * edges that have tabs beyond them, for the edge indicators.
 */
export default function WorkAreaTabs(props: NavInput) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { slug, modules, permitted, serviceMode, peopleOversight } = props;
  const sections = useMemo(
    () => buildNavigation({ slug, modules, permitted, serviceMode, peopleOversight }),
    [slug, modules, permitted, serviceMode, peopleOversight],
  );
  const query = searchParams.toString();
  const search = new URLSearchParams(query);
  const active = findActive(sections, pathname, search);
  const strip = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = strip.current;
    if (!nav) return;
    const tab = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (tab) {
      const box = nav.getBoundingClientRect();
      const at = tab.getBoundingClientRect();
      if (at.left < box.left || at.right > box.right) nav.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
    }
    const mark = () => {
      const more = [
        nav.scrollLeft > 1 && 'start',
        nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1 && 'end',
      ].filter(Boolean);
      if (more.length) nav.dataset.more = more.join(' ');
      else delete nav.dataset.more;
    };
    mark();
    nav.addEventListener('scroll', mark, { passive: true });
    const resized = new ResizeObserver(mark);
    resized.observe(nav);
    return () => {
      nav.removeEventListener('scroll', mark);
      resized.disconnect();
    };
  }, [pathname, query]);

  if (!active || active.area.tabs.length < 2) return null;

  return (
    <nav ref={strip} className="lf-tabs lf-area-tabs" aria-label={`${active.area.label} screens`}>
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
