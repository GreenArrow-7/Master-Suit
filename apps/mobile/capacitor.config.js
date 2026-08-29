/**
 * The store binaries are a WebView pointed at the running apps/web.
 *
 * There is no bundled copy of the site and there cannot be one: apps/web builds
 * with `output: 'standalone'` and renders every screen on the server against a
 * session cookie and a tenant scope. Nothing about it can be exported to static
 * files, so `server.url` is not a shortcut here, it is the only shape available.
 *
 * It is also the shape that keeps sign-in working. The session is an httpOnly,
 * SameSite=Lax cookie (apps/web/src/lib/auth/session.ts); because the WebView
 * loads the application's own origin rather than a local bundle calling it
 * cross-origin, the cookie is first-party and no token layer has to be invented
 * for mobile.
 *
 * The consequence to accept: the app needs the network, and it updates when the
 * server does — a UI change ships without a store review, which is the upside,
 * but a broken deploy reaches phones just as fast.
 *
 * JavaScript rather than TypeScript on purpose. Capacitor reads a `.ts` config
 * only if TypeScript is installed in this package, and a compiler is a lot of
 * dependency for one object literal; `.js` still takes `process.env`, which
 * `.json` does not.
 *
 * @type {import('@capacitor/cli').CapacitorConfig}
 */
const config = {
  /**
   * Permanent once either store accepts an upload — Apple and Google both
   * refuse to change a published bundle id. Set it to the real reverse domain
   * before the first submission.
   */
  appId: 'com.mastersuite.app',
  // Mirrors NEXT_PUBLIC_PRODUCT_NAME in apps/web. It is the home-screen label,
  // so it is duplicated here rather than read from an env the store build does
  // not have.
  appName: 'Master Suite',
  webDir: 'www',
  ...(process.env.MOBILE_SERVER_URL
    ? {
        server: {
          url: process.env.MOBILE_SERVER_URL,
          // No cleartext: a WebView on http would strip Secure cookies and hand
          // the session to anything on the same network.
          cleartext: false,
        },
      }
    : {}),
};

module.exports = config;
