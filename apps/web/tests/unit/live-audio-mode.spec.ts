import { describe, expect, it } from 'vitest';
import { liveAudioMode, LIVE_AUDIO_NOTICE, vendorLabel } from '@/lib/integrations/telephony/liveAudio';

describe('liveAudioMode', () => {
  it('needs a vendor that can fork audio and a public engine URL', () => {
    expect(liveAudioMode(null, 'wss://live.example')).toBe('no-vendor');
    expect(liveAudioMode(['OUTBOUND_CALL', 'CLICK_TO_CALL'], 'wss://live.example')).toBe('vendor-cannot-stream');
    expect(liveAudioMode(['OUTBOUND_CALL', 'LIVE_STREAM'], undefined)).toBe('no-engine');
    expect(liveAudioMode(['OUTBOUND_CALL', 'LIVE_STREAM'], '')).toBe('no-engine');
    expect(liveAudioMode(['OUTBOUND_CALL', 'LIVE_STREAM'], 'wss://live.example')).toBe('stream');
  });

  it('tells the seller what will and will not happen, naming the vendor', () => {
    expect(LIVE_AUDIO_NOTICE['vendor-cannot-stream'](vendorLabel('exotel'))).toMatch(
      /^Exotel cannot stream live audio/,
    );
    expect(LIVE_AUDIO_NOTICE['vendor-cannot-stream'](vendorLabel('mock'))).toMatch(/^The development mock/);
    expect(LIVE_AUDIO_NOTICE.stream('Twilio')).toContain('Nothing on this device is recorded');
    expect(LIVE_AUDIO_NOTICE['no-vendor']('')).toContain('without assistance');
  });
});
