'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Asks the server again when the URL moves beneath a layout that showed `NotInPlan`.
 *
 * A soft navigation (the bell's `router.push`, a `<Link>`) renders only the
 * segments below the layout the two URLs share, so that layout is not run
 * again: the URL would change under the old heading, and a `/sales/` link to a
 * screen Lead Eagle carries would never reach it. A refresh renders every
 * layout for the new URL.
 *
 * `data-plan-recheck="ready"` on <html> says the watch is mounted: a navigation
 * started before hydration has nobody to notice it, which is what made the
 * Lead Eagle E2E step flaky on a cold build.
 */
export default function RecheckOnNavigate({ path }: { path: string }) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    document.documentElement.dataset.planRecheck = 'ready';
    return () => {
      delete document.documentElement.dataset.planRecheck;
    };
  }, []);
  useEffect(() => {
    if (pathname !== path) router.refresh();
  }, [pathname, path, router]);
  return null;
}
