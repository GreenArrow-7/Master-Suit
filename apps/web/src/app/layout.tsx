import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/lib/branding';
import './globals.css';

/* Four faces, four jobs. The serif is loaded at a single weight because it appears
   in exactly two places — the wordmark and the hero metrics. */

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: 'Unified HRMS and Sales workspace platform.',
};

export const viewport = { themeColor: '#2E0B16' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-density="comfortable">
      <body>{children}</body>
    </html>
  );
}
