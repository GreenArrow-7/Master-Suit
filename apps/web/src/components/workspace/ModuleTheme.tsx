'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Stamps the active product module onto <html> so CSS can re-skin the shell per
 * module. The People/HR module wears HRMS-v21's identity — deep-green sidebar,
 * warm canvas, brass accents — while Sales keeps the burgundy system. Both
 * palettes live in globals.css keyed on this attribute; this only sets it.
 *
 * On <html> rather than a wrapper because the sidebar is rendered by the shared
 * workspace layout, a sibling of the page content, so a content-scoped class
 * could never reach it.
 */
export default function ModuleTheme() {
  const pathname = usePathname();
  const module = pathname.split('/')[2] === 'people' ? 'people' : 'sales';

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.lfModule = module;
    return () => {
      delete root.dataset.lfModule;
    };
  }, [module]);

  return null;
}
