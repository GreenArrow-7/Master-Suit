import { sendOrQueue } from '@/lib/offline';

/**
 * Calls placed from the phone app log themselves (M9-09). The app's own
 * CallWatch plugin (apps/mobile: `CallWatchPlugin.java`, and the Swift class in
 * `YouhanBridgeViewController.swift`) is armed before the dialler opens and
 * reports the call when it ends; the call is then logged on the lead through
 * the one-step call log. Reached through `window.Capacitor`, as push is
 * (`lib/pwa/nativePush.ts`); in a browser nothing here runs.
 *
 * Only calls placed from the app are seen: an inbound call or one dialled
 * outside the app needs the phone's call log (READ_CALL_LOG), which Google Play
 * allows only the default dialler, and no third-party app can record a
 * cellular call on Android 10+ or iOS.
 */

/** One per armed call, when it ends or after 60 seconds with no call (`timedOut`). Times are epoch ms. */
export interface CallWatchResult {
  key: string;
  timedOut: boolean;
  startedAt: number | null;
  /** When it was answered: iOS only. Android never tells an ordinary app. */
  connectedAt: number | null;
  endedAt: number;
  /** From the answer on iOS; from going off hook, ringing included, on Android. */
  durationSeconds: number;
  /** Null on Android, which cannot tell. */
  connected: boolean | null;
}

export interface CallWatchPlugin {
  start(options: { key: string }): Promise<{ armed: boolean }>;
  addListener(event: 'callEnded', handler: (result: CallWatchResult) => void): Promise<{ remove: () => Promise<void> }>;
}

/** The plugin, or null in a browser and in an app built before it. */
export function callWatch(): CallWatchPlugin | null {
  if (typeof window === 'undefined') return null;
  const capacitor = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { CallWatch?: CallWatchPlugin } };
    }
  ).Capacitor;
  return capacitor?.isNativePlatform?.() ? (capacitor.Plugins?.CallWatch ?? null) : null;
}

/**
 * Android reports only the time off hook, so off hook this long counts as
 * answered. Ringing runs out at about 30 seconds on Gulf networks.
 */
// ponytail: a fixed guess at ring time; tune it here (a web deploy, no store build) or log Android calls by hand if it misleads.
export const ANSWERED_AFTER_SECS = 45;

export interface AutoLog {
  outcome: 'Connected' | 'No answer';
  durationSecs: number;
  /** When the call began, ISO. */
  occurredAt: string;
}

/** What a call the phone saw end logs, or null when no call was placed. */
export function autoLog(result: CallWatchResult): AutoLog | null {
  if (result.timedOut || result.startedAt == null) return null;
  const seconds = Math.max(0, Math.round(result.durationSeconds));
  const connected = result.connected ?? seconds >= ANSWERED_AFTER_SECS;
  return {
    outcome: connected ? 'Connected' : 'No answer',
    durationSecs: connected ? seconds : 0,
    occurredAt: new Date(result.startedAt).toISOString(),
  };
}

export type Watched =
  /** Not armed (the phone permission refused, or the plugin failed): the dialler was not opened. */
  | { status: 'unarmed' }
  /** No call was placed within the minute: nothing logged. */
  | { status: 'none' }
  /** Logged; no `activityId` when it waits in the outbox for a connection. */
  | { status: 'logged'; log: AutoLog; activityId?: string }
  /** The server refused it: the caller offers the manual log. */
  | { status: 'failed'; log: AutoLog; message: string };

/**
 * Arms CallWatch, opens the dialler (`open`) and, when the call ends, logs it
 * on the lead once: one request key per call, so a retry or a replayed send is
 * the same log, and a second report of the call is ignored.
 */
export async function dialAndLog(
  watch: CallWatchPlugin,
  lead: { id: string; fullName: string },
  open: () => void,
): Promise<Watched> {
  const key = crypto.randomUUID();
  let ended: (result: CallWatchResult) => void = () => {};
  const result = new Promise<CallWatchResult>((resolve) => (ended = resolve));
  let listener: { remove: () => Promise<void> } | null = null;
  let armed = false;
  try {
    listener = await watch.addListener('callEnded', (r) => r.key === key && ended(r));
    armed = (await watch.start({ key })).armed;
  } catch {
    // A plugin that fails is a plugin that is not there.
  }
  if (!armed) {
    void listener?.remove();
    return { status: 'unarmed' };
  }
  open();
  const log = autoLog(await result);
  void listener?.remove();
  if (!log) return { status: 'none' };

  const res = await sendOrQueue(
    `/api/v1/leads/${lead.id}/call-log`,
    'POST',
    { ...log, requestKey: key },
    `${lead.fullName}: call`,
  );
  if (res === 'queued') return { status: 'logged', log };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      status: 'failed',
      log,
      message: data.errors?.[0]?.message ?? data.detail ?? `Request failed (${res.status})`,
    };
  }
  return { status: 'logged', log, activityId: data.activity?.id };
}
