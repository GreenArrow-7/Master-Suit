'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js, which is what turns the manifest into an actual "Install
 * app" offer in Chrome — Android will not prompt for a site with no service
 * worker no matter how complete the manifest is.
 *
 * Not gated on NODE_ENV, which is the usual reflex for a service worker. The
 * worker caches no markup and intercepts nothing but failed navigations, so
 * there is no stale-bundle hazard to keep out of development — and
 * `scripts/start-local-prod.mjs` deliberately builds with NODE_ENV=development,
 * so a production-only gate would make the one local server that could exercise
 * this the one server that never does.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Nothing depends on the registration resolving, and a failure here must not
    // surface to the viewer: the application works without it, it just stops
    // being installable.
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return null;
}
