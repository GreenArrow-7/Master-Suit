import { headers } from 'next/headers';

/**
 * Whether a request comes from the YOUHAN ONE iPhone/iPad app.
 *
 * The app's WebView appends `YouhanOneApp/<version>` to its user agent
 * (apps/mobile/capacitor.config.js). Android's carries "Android"; an iPad's
 * WKWebView reports itself as a Mac, so iOS is "the app, and not Android".
 *
 * App Store guideline 3.1.1: inside the iOS app nothing may sell, price or
 * point at buying the service (plans, trials, sign-up, subscription). The
 * service is sold to companies outside the app (3.1.3(c), Enterprise Services).
 */
export const isIosAppUserAgent = (ua: string | null | undefined): boolean =>
  !!ua && ua.includes('YouhanOneApp/') && !ua.includes('Android');

export async function inIosApp(): Promise<boolean> {
  return isIosAppUserAgent((await headers()).get('user-agent'));
}
