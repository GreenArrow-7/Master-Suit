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

/**
 * MARKETING_VERSION, read from the Xcode project rather than duplicated here.
 *
 * One source of truth: the number in the user agent is the number in the
 * binary, or the sync is refused. A fallback would mean a build quietly
 * reporting a version it does not have, which is the fault being fixed.
 */
function marketingVersion() {
  const pbxproj = require('node:path').join(__dirname, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  const found = require('node:fs').readFileSync(pbxproj, 'utf8').match(/MARKETING_VERSION = ([^;]+);/);
  if (!found) throw new Error(`No MARKETING_VERSION in ${pbxproj}`);
  return found[1].trim();
}

const url = serverUrl(process.env.MOBILE_SERVER_URL);

const config = {
  /**
   * PLACEHOLDER: permanent once either store accepts an upload — Apple and Google
   * both refuse to change a published bundle id. Kept for development builds; set
   * the real reverse domain before any release signing.
   */
  appId: 'com.youhan.one',
  // The home-screen label. Mirrors PRODUCT_NAME in apps/web/src/lib/branding.ts.
  appName: 'YOUHAN ONE',
  webDir: 'www',
  // Lets the server tell the app from a phone browser (version gate, support
  // logs) without trusting it for anything: a user agent is not authentication.
  //
  // It carries the version and build the binary actually has. It used to be the
  // literal `0.1.0-dev-poc`, which stopped being true at 1.2.0 and left support
  // unable to answer "which build is this?" from the server side at all — the
  // question the 9 November field report turned on. Everything that matches on
  // it matches the `YouhanOneApp/` prefix (apps/web/src/lib/mobile/iosApp.ts),
  // so the suffix is free to be useful.
  appendUserAgent: `YouhanOneApp/${marketingVersion()}+${process.env.GITHUB_RUN_NUMBER || 'local'}`,
  ...(url ? { server: { url, cleartext: false } } : {}),
};

module.exports = config;
