/**
 * The container to record in, chosen from what this browser actually supports.
 *
 * Both recording screens hardcoded `{ mimeType: 'audio/webm' }`. WebM is not a
 * format iOS can record: WKWebView — which is what the Capacitor app is — offers
 * MP4/AAC and refuses WebM, so the `MediaRecorder` constructor threw
 * `NotSupportedError` on the first chunk. In the live call that throw escaped
 * into an unhandled rejection while the screen had already flipped to "live",
 * so the call sat on "Listening…" forever with the microphone open and nothing
 * being recorded.
 *
 * Ordered by what the transcription providers prefer, not by popularity: Opus in
 * WebM or Ogg is what `GOOGLE_ENCODING` in lib/integrations/transcription.ts
 * maps, so a browser that can produce either should. `audio/mp4` is last because
 * it is the only thing iOS offers — a recording the provider may still reject,
 * which surfaces as a visible error from the upload rather than as silence.
 *
 * `undefined` means "no option object": every MediaRecorder implementation has
 * a default it can record in, and letting it choose beats asking for a format it
 * has already said it does not have.
 */
const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'] as const;

export function recorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  // isTypeSupported is itself absent on some older WebViews.
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return PREFERRED.find((type) => MediaRecorder.isTypeSupported(type));
}

/** `new MediaRecorder(stream, ...recorderOptions())` — options only when there is one. */
export function recorderOptions(): [MediaRecorderOptions?] {
  const mimeType = recorderMimeType();
  return mimeType ? [{ mimeType }] : [];
}
