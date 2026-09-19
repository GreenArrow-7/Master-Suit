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
