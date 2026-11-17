# A simulation can no longer authorise a real audio stream, and the hint stream stops leaking

## What

Three defects on the live-coaching path, plus the screen changes that make a
real-phone test readable, and the operator handoff for staging. PR #261.

## Why

A multi-agent adversarial review of the live-coaching path on 17 November found
all three, and judged each one a thing that would have been read as "live
coaching does not work" on the first real call. The owner asked
for them fixed before a staging test, and for the proposed patches to be treated
as candidates until they compile and pass tests.

## Where

- `lib/integrations/telephony/consent.ts` — **new.** One predicate for "this
  consent row may authorise processing real call audio", keyed on the sentinel
  the demo path writes into `consentedBy`, so it is retroactive with no
  migration.
- `calls/[id]/dial/route.ts`, `workers/liveStream.ts`,
  `calls/[id]/live-audio/route.ts`, `webhooks/telephony/[key]/route.ts`,
  `services/shared/ingestRecording.ts`, and both server pages
  (`sales/calls/[id]/page.tsx`, `.../live/page.tsx`) — every gate that admits
  new real audio now calls it.
- `calls/[id]/consent/route.ts` — conflicts only on real consent, so a demo row
  can be upgraded. Without this the gate would make a demo'd call permanently
  uncoachable.
- `calls/[id]/live/route.ts` — the SSE relay releases its redis subscriber and
  heartbeat on abort, cancellation and `done`, idempotently.
- `lib/ai/liveCoach.ts` — `coachableUtterance`, the ringback guard.
- `lib/integrations/telephony/liveAudio.ts` — `hintIsStale`, `HINT_FRESH_MS`.
- `.../live/LiveCallWorkspace.tsx` — arrival stamps, the stale badge, the
  reconnecting notice, three distinguishable hint sources, and closing the
  stream on unmount.
- `docs/release/LIVE-COACHING-STAGING-HANDOFF.md` — **new.** The operator
  sequence, starting with the one read-only command that discovers the topology
  rather than assuming a port.

## Behaviour

- Pressing **Start simulated call** on a real lead no longer leaves consent that
  a later real dial would act on. Demo rows already in any database are
  neutralised by the same predicate.
- Consent granted for the real call through the screen's confirmation works as
  before, and now also replaces a demo row.
- Declining consent still places an ordinary call — the dial omits the audio
  fork, it does not refuse the call.
- A dropped hint stream says **"Coaching is reconnecting — the call is not
  affected"** instead of going quiet, and the phone call is untouched.
- Hints older than ninety seconds are badged **out of date**, measured on the
  viewer's wall clock, because the call's second counter stops while a phone
  has the app in the background.
- Hint sources read **AI model**, **Your playbook** or **Rule**. The worker
  already filtered `coachTick` fallbacks, so the canned text returned because
  the model failed cannot appear labelled as the model.
- Ringback and a voicemail greeting are transcribed and shown but no longer
  produce sales hints or advance the stage.

## Verified

`tests/unit/live-consent-gate.spec.ts` — **new**, 13 assertions covering the
demo row, an older demo row, the upgrade path, withdrawal, the ringback guard
and staleness. Every one of the consent cases fails on the old code.
29 tests pass across the four live specs (`live-consent-gate`, `live-coach`,
`live-audio-mode`, `live-stream-protocol`), run from `apps/web`.
`npm run -s typecheck` reports no error in `src/`.

**Not verified:** no call has been placed, no staging command has been run, and
no screen has been opened on any device. The redis release is a code-level fix
with no integration test — proving it needs a running redis and a client that
disconnects, which is in the handoff as an operator observation, not a spec.

## Left open

- The whole of the real-phone test: three calls, objection-to-hint latency,
  iPhone and Android separately.
- Whether the demo simulation should be allowed to run on a real call record at
  all. This change makes it safe; it does not make it sensible.
- Whether a reconnect should replay the hints it missed. Today they are lost and
  the screen says so, which is honest but not complete; redis pub/sub has no
  replay.
- The provider's UAE origination and caller-ID permissions, which decide the
  launch scope.
