/**
 * The native apps are a WebView pointed at the running apps/web.
 *
 * There is no bundled copy of the site and there cannot be one: apps/web builds
 * with `output: 'standalone'` and renders every screen on the server against a
 * session cookie and a tenant scope (95 of 115 workspace pages read the database
 * directly). Nothing about it can be exported to static files, so `server.url` is
 * the only shape available without rebuilding the interface.
 *
 * It is also the shape that keeps sign-in working. The session is an httpOnly,
 * SameSite=Lax cookie (apps/web/src/lib/auth/session.ts); because the WebView
 * loads the application's own origin rather than a local bundle calling it
 * cross-origin, the cookie is first-party and no token layer is invented for
 * mobile. Passwords are never stored by the app.
 *
 * DEVELOPMENT PROOF OF CONCEPT ONLY. Capacitor's configuration reference says of
 * `server.url`: "This is intended for use with live-reload servers. This is not
 * intended for use in production." (capacitorjs.com/docs/config, v8). Builds made
 * from this file are labelled as such and must not be submitted to a store until
 * a production-supported architecture is chosen.
 *
 * Deliberately absent: `server.allowNavigation` (other hosts open in the system
 * browser, never inside the app), `cleartext`, and mixed content.
 *
 * JavaScript rather than TypeScript on purpose. Capacitor reads a `.ts` config
 * only if TypeScript is installed in this package; `.js` still takes `process.env`.
 *
 * @type {import('@capacitor/cli').CapacitorConfig}
 */

/**
 * The origin the app loads, from MOBILE_SERVER_URL at sync time. HTTPS only, and
 * an origin only: a path, query or credentials in it would be baked into the
 * binary and are refused rather than silently kept.
 */
function serverUrl(raw) {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error(`MOBILE_SERVER_URL must be https: ${url.protocol}`);
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/'))
    throw new Error('MOBILE_SERVER_URL must be a bare https origin, e.g. https://staging.example.com');
  return url.origin;
}

const url = serverUrl(process.env.MOBILE_SERVER_URL);

const config = {
  /**
   * PLACEHOLDER: permanent once either store accepts an upload — Apple and Google
   * both refuse to change a published bundle id. Kept for development builds; set
   * the real reverse domain before any release signing.
   */
  appId: 'com.mastersuite.app',
  // The home-screen label. Mirrors PRODUCT_NAME in apps/web/src/lib/branding.ts.
  appName: 'YOUHAN ONE',
  webDir: 'www',
  // Lets the server tell the app from a phone browser (version gate, support logs)
  // without trusting it for anything: a user agent is not authentication.
  appendUserAgent: 'YouhanOneApp/0.1.0-dev-poc',
  ...(url ? { server: { url, cleartext: false } } : {}),
};

module.exports = config;
