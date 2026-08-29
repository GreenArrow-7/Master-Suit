/**
 * Talking to the Capacitor push plugin, from a page that is not a Capacitor app.
 *
 * The store builds load this application over the network rather than bundling
 * it (apps/mobile/capacitor.config.js explains why), and the native shell
 * injects its bridge into the WebView on every page load. So the plugin is
 * reached through `window.Capacitor.Plugins` rather than by importing
 * `@capacitor/push-notifications` here: the package would add two dependencies
 * to a web application that ships to browsers, to wrap a global the shell has
 * already provided. The plugin *is* installed in apps/mobile, which is where the
 * native half of it actually lives.
 *
 * Everything below is a no-op in a browser. `isNativePlatform()` is false, the
 * functions return immediately, and nothing is imported that a browser would
 * have to download.
 */

type Permission = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

interface PushPlugin {
  checkPermissions(): Promise<{ receive: Permission }>;
  requestPermissions(): Promise<{ receive: Permission }>;
  register(): Promise<void>;
  addListener(
    event: 'registration',
    handler: (token: { value: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(event: 'registrationError', handler: (error: unknown) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: 'pushNotificationActionPerformed',
    handler: (action: { notification: { data?: Record<string, string> } }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { PushNotifications?: PushPlugin };
}

/** The plugin, or null in a browser and in a shell built without push. */
function plugin(): { push: PushPlugin; platform: 'ios' | 'android' } | null {
  if (typeof window === 'undefined') return null;
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;

  const platform = capacitor.getPlatform?.();
  const push = capacitor.Plugins?.PushNotifications;
  if (!push || (platform !== 'ios' && platform !== 'android')) return null;
  return { push, platform };
}

/**
 * The token this device is currently registered under, so sign-out can hand it
 * back. Module scope rather than storage: it is repopulated on every launch by
 * the registration below, and a stale one written to disk would outlive the
 * account it belonged to.
 */
let registeredToken: string | null = null;
let started = false;

/**
 * Ask for permission, register with APNs or FCM, and tell the server where to
 * reach this phone.
 *
 * Runs once per app launch. Re-registering is how a rotated token gets recorded,
 * and it is also what claims a shared handset for whoever has just signed in.
 *
 * `onOpen` receives the workspace-absolute path a tapped notification should
 * open. Navigation is the caller's, because only a component holds the router.
 */
export async function registerNativePush(onOpen: (url: string) => void): Promise<void> {
  const native = plugin();
  if (!native || started) return;
  started = true;

  try {
    const current = await native.push.checkPermissions();
    const receive =
      current.receive === 'granted' ? current.receive : (await native.push.requestPermissions()).receive;
    // Denied is a settled answer, not an error. Someone who declined the prompt
    // gets the in-app feed and the email, which is what they had before.
    if (receive !== 'granted') return;

    await native.push.addListener('registration', (token) => {
      registeredToken = token.value;
      void fetch('/api/v1/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.value, platform: native.platform }),
      });
    });

    await native.push.addListener('registrationError', (error) => {
      // Nothing to retry against: a device that cannot reach APNs or FCM at
      // launch is a device without push until the next launch.
      console.warn('push registration failed', error);
    });

    await native.push.addListener('pushNotificationActionPerformed', (action) => {
      const url = action.notification.data?.url;
      // Sent by the worker via entityRoute, so it is always a path within this
      // origin. Checked anyway — a push payload is not something this page gets
      // to assume was written by us.
      if (url && url.startsWith('/') && !url.startsWith('//')) onOpen(url);
    });

    await native.push.register();
  } catch (error) {
    console.warn('push setup failed', error);
  }
}

/**
 * Release the handset on sign-out. Without it the phone keeps announcing the
 * previous account's approvals on its lock screen until somebody signs in again.
 */
export async function unregisterNativePush(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  started = false;
  await fetch('/api/v1/devices/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => {
    // Sign-out must not be blocked by it. The session is revoked either way, and
    // the row is reclaimed by the next sign-in on this device.
  });
}
