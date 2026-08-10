import type { Metadata } from 'next';
import { Fraunces, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { PRODUCT_NAME } from '@/lib/branding';
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
  description: 'Unified HRMS and Sales workspace platform.',
};

export const viewport = { themeColor: '#2E0B16' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-density="comfortable"
      className={`${fraunces.variable} ${interTight.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
