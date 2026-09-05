import type { MetadataRoute } from 'next';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME, PRODUCT_SHORT_NAME } from '@/lib/branding';

/**
 * Web app manifest — what makes the application installable on Android and iOS.
 *
 * The phone layout already exists (`@media (max-width: 760px)` in globals.css,
 * `viewportFit: 'cover'` in the root layout for the safe-area insets), so this
 * is the only missing piece between the site and a home-screen app: Chrome
 * offers "Install app" once it sees a manifest with a 192px icon and a
 * `standalone` display, and iOS Safari's "Add to Home Screen" reads the same
 * file for the name and chrome-less window.
 *
 * `standalone` drops the browser URL bar, which is also what lets the camera and
 * geolocation grants on the check-in and site-visit screens persist the way they
 * do in a native shell rather than being re-asked per tab.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    // The home-screen label has room for about twelve characters before Android
    // truncates it, which is what the short form exists for.
    short_name: PRODUCT_SHORT_NAME,
    description: PRODUCT_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#020817',
    theme_color: '#020817',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
