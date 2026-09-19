# AI-assisted calls on mobile: what the platforms allow, and what YOUHAN ONE does

Written 19 Sep 2026 for the owner's decision: AI assistance must activate only when a
seller intentionally starts a customer call from inside YOUHAN ONE, must never listen
to, detect, record or analyse unrelated calls on the device, and must not rely on an
unreliable workaround.

## 1. What iOS and Android permit a third-party app to do with call audio

Verified against vendor documentation on 19 Sep 2026 (URLs at the end).

| Platform | Cellular call placed by the Phone app   | A call the app itself carries (VoIP)                           |
| -------- | --------------------------------------- | -------------------------------------------------------------- |
| iOS      | State only via CallKit; **no audio**    | The app's own audio session; it may process and fork the audio |
| Android  | **No audio** for store-distributed apps | The app's own media (WebRTC or a CPaaS SDK); fully available   |

- **iOS.** CallKit's `CXCallObserver`/`CXCall` expose only whether a call is outgoing,
  connected or ended. No API hands an app the audio of a Phone-app call, and an incoming
  phone call _interrupts_ the app's audio session rather than joining it. Call recording
  arrived in iOS 18.1 as a feature of Apple's own Phone app (participants are notified,
  the recording goes to Notes); there is no developer API. A VoIP app (PushKit + CallKit)
  owns its audio because the media flows through its own audio session.
- **Android.** The call audio sources `VOICE_CALL`, `VOICE_UPLINK` and `VOICE_DOWNLINK`
  require `CAPTURE_AUDIO_OUTPUT`, which is "not available to third-party applications".
  Since Android 9 a background app cannot open the microphone at all, and during a call
  "the call always receives audio"; only a pre-installed privileged app or an
  accessibility service can capture it. Google Play policy forbids using the
  Accessibility API for "remote call audio recording" (policy update of April 2022,
  enforced from May 2022). Being the default dialer (`InCallService`, `ROLE_DIALER`)
  gives call management and audio _routing_, not capture. A self-managed
  `ConnectionService` app (WebRTC, a CPaaS SDK) owns its own media.

**Conclusion.** No production-safe way exists for YOUHAN ONE to take audio from a normal
phone call on the handset, on either platform. Anything that claimed to would be a
workaround Apple blocks by design and Google removes from Play. The only reliable path to
live customer-call audio is a call leg the platform itself places or bridges through a
telephony provider, with the audio taken **server-side** from that provider.

## 2. The architecture YOUHAN ONE uses

```
Lead ─► "Call with AI assistance" ─► call record + consent ─► provider places the call
                                                                (rings the seller's phone,
                                                                 bridges the customer)
       provider forks the call audio ─► realtime engine (worker) ─► streaming STT
                                                                   ─► transcript, stage, hints
       the phone/app screen ◄── SSE ── redis pub/sub ◄────────────┘
       call ends ─► provider webhook ─► recording ─► transcript ─► analysis ─► audit ─► lead touched
```

- **Entry point.** Only from a lead (or the New call form) inside the application:
  Lead → _Call with AI assistance_. A plain _Phone_ button remains next to it and is
  labelled "no AI assistance"; it opens the handset dialler and the platform never sees
  that call.
- **Consent first.** Streaming is processing the conversation, so the seller affirms and
  the platform records consent (`PRE_AUTHORIZED` when it was given before the call,
  `VERBAL` when affirmed on the call) before the provider is asked to place it. Without a
  consent row the provider is not asked to fork audio, and the audio route refuses bytes.
- **The call itself** is a click-to-call bridge: the provider rings the seller's own
  phone first, then the customer, and joins them. On the handset it is an ordinary
  incoming call. The app declares no microphone permission for this path and records
  nothing on the device.
- **Live audio** reaches the realtime engine only from the provider (Twilio Media
  Streams, 8 kHz mulaw over a WebSocket authenticated per call by an HMAC token minted
  at dial time). The engine (`src/workers/liveStream.ts`) runs streaming speech-to-text
  (Deepgram), publishes transcript segments, stage and coach hints on the call's redis
  channel, and the screen only displays them (`/api/v1/calls/[id]/live`).
- **After the call** the provider's completion webhook drives recording ingest,
  transcription, analysis, audit and the lead's `lastActivityAt` — the same chain the
  desktop journey uses.

### Where each part lives

| Concern                              | Code                                                                |
| ------------------------------------ | ------------------------------------------------------------------- |
| Lead entry point                     | `sales/leads/[id]/LeadDetail.tsx` (primary action)                  |
| Pre-filled call form                 | `sales/calls/new/NewCallForm.tsx` (`?leadId=`)                      |
| Place from the live screen, fallback | `sales/calls/[id]/live/LiveCallWorkspace.tsx` (`placeCall`)         |
| What this provider can do            | `lib/integrations/telephony/liveAudio.ts`, shown by `live/page.tsx` |
| Vendor dial with stream parameters   | `api/v1/calls/[id]/dial/route.ts`                                   |
| Stream authentication and parsing    | `lib/integrations/telephony/stream.ts`                              |
| Realtime engine                      | `workers/liveStream.ts`, `lib/integrations/transcriptionStream.ts`  |
| Screen feed                          | `api/v1/calls/[id]/live/route.ts` (relay mode)                      |

## 3. The six questions

1. **Why external telephony infrastructure is required.** Neither platform gives an app
   the audio of a handset call (section 1). The only audio the platform may process is
   a call leg it places through a provider.
2. **What component requires it.** The realtime engine's input: the provider's media
   fork (`LIVE_STREAM` capability). Without a provider there is no call leg and no fork.
3. **Does the call remain inside YOUHAN ONE?** Yes for everything the platform does:
   the call record, consent, the dial, the coaching screen, the recording, transcript,
   analysis, audit and CRM updates. The voice path is the provider's bridge between the
   seller's phone and the customer; on the seller's handset it looks like an ordinary
   call.
4. **How live audio reaches transcription and AI.** Provider → WebSocket fork →
   `workers/liveStream.ts` → Deepgram streaming STT → coach → redis → SSE → screen.
   Never from the device.
5. **If the provider is unavailable.** Decided before anything is placed and shown on
   the live screen (`liveAudioMode`): _no provider connected_ → the assisted button is
   absent and the notice says so; _provider connected but cannot fork_ (Exotel,
   Knowlarity, Plivo, the development mock) → the call is placed and recorded, the
   notice says transcript, analysis and audit follow after the call and there is no
   guidance during it; _provider can fork but no engine URL_ → same as the previous;
   _dial refused_ (no phone on the seller's profile, vendor error) → the reason and a
   _Call from this phone instead (no AI assistance)_ link. A vendor failure leaves the
   call `FAILED`, never stranded in `RINGING`.
6. **Fallback user experience.** The seller always keeps the handset call (the _Phone_
   button and the fallback link) and the post-call chain still applies to any call the
   platform placed. Nothing degrades silently into listening on the device.

## 4. What is verified, and what needs a real provider account

Verified on the local rig (`tests/e2e/assisted-call.spec.ts`, development mock vendor):
lead → assisted call → form pre-filled → live screen states the provider cannot stream
→ consent affirmed and recorded as `PRE_AUTHORIZED` → the provider places the call (call
`RINGING`, external id, lead attached) → reload shows the vendor leg, not a simulation →
a seller with no phone on file sees the reason and the handset fallback, and nothing is
placed. Unit: `tests/unit/live-audio-mode.spec.ts`. The engine's own contract (stream
token, message parsing, STT failure posture) has its existing unit tests.

**Pending a connected Twilio account and a public `LIVE_STREAM_WS_URL`:** one real bridged
call with media forked to the engine, confirming segments and hints on the phone screen
during the call. Exotel offers a comparable fork ("AgentStream", linear16 8 kHz); it is
not implemented here. Knowlarity publishes no media-streaming documentation.

## 5. The mobile app

The native apps are a WebView on the web application. This path needs no microphone,
no call-log, no telephony permission and no background execution: the app shows the
coaching screen while the handset carries the provider's call. The microphone is used
only by two explicitly user-started features (practice recording, and "coach a real
call" on the desktop where a seller holds the phone beside the browser); on iOS it is
not declared and those features show their refusal message. Adding
`NSMicrophoneUsageDescription`/`RECORD_AUDIO` is a separate owner decision and is not
needed for AI-assisted calls.

## Sources

- CallKit: https://developer.apple.com/documentation/callkit/cxcallobserver ·
  https://developer.apple.com/documentation/callkit/cxcall
- Audio interruptions: https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions
- iOS 18.1 call recording (Phone app feature): https://support.apple.com/en-us/121583
- PushKit + CallKit VoIP: https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit
- Android audio sources: https://developer.android.com/reference/android/media/MediaRecorder.AudioSource
- Android 9 background microphone: https://developer.android.com/about/versions/pie/android-9.0-changes-all
- Android sharing audio input during a call: https://developer.android.com/media/platform/sharing-audio-input
- Play Accessibility policy: https://support.google.com/googleplay/android-developer/answer/16558241
- InCallService / Telecom: https://developer.android.com/reference/android/telecom/InCallService ·
  https://developer.android.com/develop/connectivity/telecom
- Twilio Media Streams: https://www.twilio.com/docs/voice/media-streams ·
  https://www.twilio.com/docs/voice/twiml/stream
- Twilio Voice SDK (iOS): https://www.twilio.com/docs/voice/sdks/ios
- Exotel AgentStream: https://developer.exotel.com/docs/agentstream/developer-guide
