'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Stamps the active product module onto <html>.
 *
 * This used to drive two palettes: Sales wore burgundy, People wore HRMS-v21's
 * deep green and beige with a serif. Under YOUHAN ONE there is one design
 * system and no per-module skin, so the attribute no longer changes a single
 * colour — it survives as the shell's statement of which module is open, which
 * the navigation tests assert against and which any future module-scoped rule
 * (a density, a default column set) should hang off rather than re-deriving.
 *
 * On <html> rather than a wrapper because the sidebar is rendered by the shared
 * workspace layout, a sibling of the page content, so a content-scoped class
 * could never reach it.
 */
export default function ModuleTheme() {
  const pathname = usePathname();
  // Not named `module`: Next reserves that identifier in client bundles.
  const activeModule = pathname.split('/')[2] === 'people' ? 'people' : 'sales';

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.lfModule = activeModule;
    return () => {
      delete root.dataset.lfModule;
    };
  }, [activeModule]);

  return null;
}
