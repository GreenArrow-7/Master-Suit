import type { Capability } from './types';

/**
 * Where a call's live audio can come from, decided before the call is placed so
 * the screen never promises guidance the vendor cannot deliver.
 *
 * Only a vendor leg the platform placed is ever forked to the coaching engine;
 * nothing on the handset is recorded and no call the app did not place is
 * touched (docs/MOBILE-AI-CALLS.md).
 */
export type LiveAudio = 'stream' | 'vendor-cannot-stream' | 'no-engine' | 'no-vendor';

export function liveAudioMode(
  capabilities: readonly Capability[] | null | undefined,
  engineUrl: string | undefined,
): LiveAudio {
  if (!capabilities) return 'no-vendor';
  if (!capabilities.includes('LIVE_STREAM')) return 'vendor-cannot-stream';
  if (!engineUrl) return 'no-engine';
  return 'stream';
}

export const vendorLabel = (vendor: string | null | undefined) =>
  !vendor ? 'The provider' : vendor === 'mock' ? 'The development mock' : vendor[0]!.toUpperCase() + vendor.slice(1);

export const LIVE_AUDIO_NOTICE: Record<LiveAudio, (vendor: string) => string> = {
  stream: () =>
    'Live call — the provider forks the call audio to the coaching engine; this screen only displays guidance. Nothing on this device is recorded.',
  'vendor-cannot-stream': (vendor) =>
    `${vendor} cannot stream live audio. The call is placed and recorded through the provider; transcript, analysis and audit follow after the call — no guidance during it.`,
  'no-engine': () =>
    'Live guidance is not configured on this deployment. The call is placed and recorded through the provider; transcript, analysis and audit follow after the call.',
  'no-vendor': () =>
    'No calling provider is connected. Connect one under Administration → Integrations to place AI-assisted calls; from this device you can only phone the customer without assistance.',
};

/**
 * How long a coaching hint stays current, in milliseconds.
 *
 * `coachTick` fires on every 4th customer turn, so a model hint can be three
 * turns late by design. Ninety seconds is longer than that gap and shorter than
 * the point where a suggestion about an earlier part of the conversation would
 * mislead the agent.
 */
export const HINT_FRESH_MS = 90_000;

/**
 * Whether a hint on screen is out of date.
 *
 * Measured on the viewer's own wall clock from the moment the hint arrived, not
 * from the call's second counter: that counter stops advancing while a phone has
 * the app in the background, which is exactly when hints go stale unnoticed.
 *
 * A hint with no arrival stamp is treated as stale — it came from a path that
 * does not record one, and claiming freshness we cannot measure is the failure
 * worth avoiding here.
 */
export function hintIsStale(receivedAtMs: number | undefined, nowMs: number): boolean {
  if (typeof receivedAtMs !== 'number' || !Number.isFinite(receivedAtMs)) return true;
  return nowMs - receivedAtMs > HINT_FRESH_MS;
}
