import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { PRODUCT_NAME } from '@/lib/branding';
import ServiceWorkerRegistration from '@/components/pwa/ServiceWorkerRegistration';
import { THEME_BOOTSTRAP } from '@/lib/theme';
import './globals.css';

/**
 * The two YOUHAN faces, self-hosted, plus the diagnostics mono.
 *
 * The files are committed in ./fonts, each beside its family's OFL licence:
 * the Latin subset Google Fonts serves, one variable file per family that covers
 * every weight. They used to come through next/font/google, which fetches them
 * from Google on every `next dev` start and every `next build`. On 6 Oct 2026
 * a Turbopack error in that fetch, seen in one CI run and not in the runs
 * around it, made every page answer 500. The build no longer reaches Google.
 *
 * next/font serves them from our own origin, which is what the `font-src 'self'`
 * CSP allows — a Google Fonts <link> would be blocked. That CSP is also why this
 * list is the *only* place a face can be added: tokens.css previously named
 * 'Inter' without anything loading it, so every Sales screen had silently been
 * rendering in Segoe UI.
 *
 * One src entry per weight, as Google's stylesheet declared them, so a weight
 * that is not listed resolves to the same face it always did. Latin only:
 * Cyrillic, Greek and most Latin Extended letters render in the fallback.
 *
 * Inter is the product face — headings, tables, controls, forms, body: one
 * family for the whole working UI. Manrope is the marketing site's face and
 * appears here only in the brand lockup (the wordmark beside the YH mark, the
 * login headline); two weights, nothing else. JetBrains Mono carries figures,
 * the geofence and the GPS diagnostics.
 *
 * Fraunces and Inter Tight were the People module's separate serif identity and
 * are gone with it: one product, one type system.
 */
const manrope = localFont({
  src: [
    { path: './fonts/manrope-latin.woff2', weight: '600' },
    { path: './fonts/manrope-latin.woff2', weight: '700' },
  ],
  variable: '--yh-font-manrope',
  display: 'swap',
});
const inter = localFont({
  src: [
    { path: './fonts/inter-latin.woff2', weight: '400' },
    { path: './fonts/inter-latin.woff2', weight: '500' },
    { path: './fonts/inter-latin.woff2', weight: '600' },
  ],
  variable: '--yh-font-inter',
  display: 'swap',
});
const jetbrainsMono = localFont({
  src: [
    { path: './fonts/jetbrains-mono-latin.woff2', weight: '400' },
    { path: './fonts/jetbrains-mono-latin.woff2', weight: '500' },
  ],
  variable: '--yh-font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: 'Sales, people, operations and intelligence connected in one platform.',
};

export const viewport = {
  themeColor: '#020817',
  width: 'device-width',
  initialScale: 1,
  /**
   * `cover` is what makes `env(safe-area-inset-*)` report real numbers. Without
   * it the insets are all zero, so the bottom tab bar sits under the iPhone
   * home indicator and the padding written to clear it does nothing.
   */
  viewportFit: 'cover' as const,
  // Deliberately not maximum-scale: pinch-zoom is an accessibility feature and
  // locking it to keep a layout tidy takes that away from people who need it.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-density="comfortable"
      className={`${manrope.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      // The stored theme is applied by the script below before first paint, so
      // this attribute is intentionally absent here rather than set to 'light':
      // rendering light and correcting it after hydration is the flash.
      suppressHydrationWarning
    >
      <head>
        {/*
         * Runs before anything paints. Deferring this to an effect means every
         * page load shows the light theme for a frame and then swaps — a white
         * flash on each navigation for anyone using Dark Classic or Glassy.
         *
         * The script reads localStorage and sets one attribute. It cannot throw:
         * the whole body is wrapped, because storage access itself raises in a
         * private window or with site data blocked.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
