import type { Metadata } from 'next';
import { Fraunces, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { PRODUCT_NAME } from '@/lib/branding';
import { THEME_BOOTSTRAP } from '@/lib/theme';
import './globals.css';

/**
 * The HRMS module's faces, self-hosted.
 *
 * next/font downloads these at build time and serves them from our own origin,
 * which is what the `font-src 'self'` CSP allows — a Google Fonts <link>, the
 * way the source HRMS loaded them, would be blocked.
 *
 * Fraunces is the display serif on the HR screens (page and card headings);
 * Inter Tight is the body face; JetBrains Mono carries the geofence and GPS
 * diagnostics. The Sales module keeps its own sans stack — these are exposed as
 * variables and applied only under the People theme.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--lf-font-fraunces',
  display: 'swap',
});
const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--lf-font-inter-tight',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--lf-font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description:
    'A modular business platform: Sales CRM, People & HR, and multi-tenant platform administration on one login, one permission model and one audit trail.',
};

export const viewport = {
  themeColor: '#2E0B16',
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
      className={`${fraunces.variable} ${interTight.variable} ${jetbrainsMono.variable}`}
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
      <body>{children}</body>
    </html>
  );
}
