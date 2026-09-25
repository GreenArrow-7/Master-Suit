import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { PRODUCT_NAME } from '@/lib/branding';
import ServiceWorkerRegistration from '@/components/pwa/ServiceWorkerRegistration';
import { THEME_BOOTSTRAP } from '@/lib/theme';
import './globals.css';

/**
 * One product face, self-hosted, plus the identifier mono.
 *
 * next/font downloads these at build time and serves them from our own origin,
 * which is what the `font-src 'self'` CSP allows — a Google Fonts <link> would
 * be blocked. That CSP is also why this list is the *only* place a face can be
 * added: tokens.css previously named 'Inter' without anything loading it, so
 * every Sales screen had silently been rendering in Segoe UI.
 *
 * Inter is the whole working UI: headings, tables, controls, forms, body and
 * the brand lockup, which is drawn with weight ("YOUHAN" 600 / "ONE" 500)
 * rather than a second family. Manrope used to be downloaded to set exactly two
 * strings; --yh-font-brand keeps its name and resolves to Inter in tokens.css.
 * JetBrains Mono survives for identifiers only (reference codes, ids, keys);
 * figures are Inter tabular.
 *
 * Fraunces and Inter Tight were the People module's separate serif identity and
 * are gone with it: one product, one type system.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--yh-font-inter',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--yh-font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: 'Sales, people, operations and intelligence connected in one platform.',
};

export const viewport = {
  themeColor: '#f7f8fa',
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
      className={`${inter.variable} ${jetbrainsMono.variable}`}
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
