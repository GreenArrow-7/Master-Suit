import { afterEach, describe, expect, it } from 'vitest';
import { recorderMimeType, recorderOptions } from '@/lib/media/recorderMimeType';

/**
 * The regression: both recording screens asked for `audio/webm` unconditionally.
 *
 * iOS WKWebView — which is what the Capacitor app runs — cannot record WebM, so
 * `new MediaRecorder(stream, { mimeType: 'audio/webm' })` threw
 * `NotSupportedError`. In the live call that throw escaped as an unhandled
 * rejection after the screen had already gone "live", leaving the microphone
 * open and the transcript stuck on "Listening…" with nothing to show the user.
 *
 * The case that matters most here is the last one: when the browser supports
 * none of the types we know to ask for, the answer must be `undefined` — "let
 * the browser pick" — and never a type it has just refused.
 */
const withMediaRecorder = (supported: (type: string) => boolean) => {
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = { isTypeSupported: supported };
};

afterEach(() => {
  delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
});

describe('recorderMimeType', () => {
  it('takes the first type the browser actually supports', () => {
    withMediaRecorder((type) => type === 'audio/webm;codecs=opus');
    expect(recorderMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('falls past a refused preference to the next one', () => {
    withMediaRecorder((type) => type === 'audio/ogg;codecs=opus');
    expect(recorderMimeType()).toBe('audio/ogg;codecs=opus');
  });

  it('reaches audio/mp4, which is all iOS offers', () => {
    withMediaRecorder((type) => type === 'audio/mp4');
    expect(recorderMimeType()).toBe('audio/mp4');
  });

  it('asks for nothing when the browser supports none of them', () => {
    withMediaRecorder(() => false);
    expect(recorderMimeType()).toBeUndefined();
    // No option object at all, so `new MediaRecorder(stream)` uses its default
    // rather than being handed a type it has already refused.
    expect(recorderOptions()).toEqual([]);
  });

  it('asks for nothing when isTypeSupported is missing', () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = {};
    expect(recorderMimeType()).toBeUndefined();
  });

  it('asks for nothing when there is no MediaRecorder at all', () => {
    expect(recorderMimeType()).toBeUndefined();
  });

  it('wraps a supported type as a single options argument', () => {
    withMediaRecorder(() => true);
    expect(recorderOptions()).toEqual([{ mimeType: 'audio/webm;codecs=opus' }]);
  });
});
