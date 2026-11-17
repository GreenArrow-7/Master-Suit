# Live Coaching: what is actually built, and what is missing

Read before rebuilding anything. Traced on 17 November 2026 by reading the code
path end to end. **No call has been placed.** Everything below is design review
plus two defects fixed as a result; nothing here is evidence that coaching works.

## The route in one line

**Twilio rings the agent's own mobile first, then bridges the customer, and
forks both audio tracks to our worker.** The agent is on an ordinary phone call
on their handset; hints appear in the web app on the same phone.

```
POST /calls/:id/dial
  └─ Twilio Calls API   To: agentNumber   (the agent's own SIM — leg 1)
       └─ TwiML: <Start><Stream track="both_tracks" …/></Start>
                 <Dial callerId=…>customer</Dial>        (leg 2)
            └─ wss://<public>/twilio-media   ──► workers/liveStream.ts
                 ├─ verifyStreamToken(tenant, call)    HMAC, per call
                 ├─ consent on file, else refuse
                 ├─ Deepgram nova-2, ONE SOCKET PER TRACK
                 │    inbound  → "Agent"     (the agent's own voice)
                 │    outbound → "Customer"  (what the agent hears)
                 ├─ heuristics + stage + budget match  → redis publish
                 ├─ coachTick (Gemini) every 4th customer turn
                 └─ redis `live-call:<id>`
                      └─ GET /calls/:id/live  (SSE relay)
                           └─ LiveCallWorkspace  → the agent's screen
  call ends → finalise → analyseAndAudit (claim-guarded) → transcript, audit
```

## Does it meet the same-phone requirement? Yes, without any VoIP work

This is the important finding, and it means **repair and reuse, not rebuild.**

`twilio.ts` sends `To: request.agentNumber`, and `dial/route.ts` defaults that
to the agent's own `user.phone`. So Twilio calls the agent's handset over the
normal mobile network — **PSTN, not VoIP to the device.** The agent answers in
the native phone UI, switches to the app, and iOS keeps the call alive with the
green status bar while the page stays in the foreground. The hints are text on
that page. **The customer is on a separate leg and can neither see nor hear
them.** Nothing is captured on the device; the fork happens at Twilio.

So the smallest route that meets the goal is the one already written. An in-app
VoIP flow (PushKit + CallKit) would be weeks of work and is not needed.

**The one real UX constraint:** the agent cannot hold the phone to their ear and
read the screen at the same time. Speakerphone or a wired/Bluetooth headset is a
prerequisite of the test, not an optional nicety. It belongs in the test script.

**Speaker separation: correct, and this is why.** `<Start><Stream>` runs on the
agent's leg before `<Dial>`, so on that leg `inbound` is audio *from* the agent
and `outbound` is audio Twilio *sends to* the agent — the customer. Two separate
Deepgram sockets, each labelled at open time, so attribution never depends on
diarisation. `track="both_tracks"` is set. By inspection this is right; it has
never been confirmed against real audio, and the failure mode if the legs are
ever reordered is **silent and total**: every line attributed to the wrong
speaker, and the coach hinting at the agent's own words.

## Working / unverified / missing

### Working — read, and covered by tests

| Piece | Where | Test |
| --- | --- | --- |
| Stream auth, per call | `telephony/stream.ts`, HMAC on `WEBHOOK_SIGNING_PEPPER` | `live-stream-protocol.spec.ts` |
| Twilio message parsing | same | same |
| Mode decision before dialling | `telephony/liveAudio.ts` | `live-audio-mode.spec.ts` |
| Heuristics, stage, next question | `lib/ai/liveCoach.ts` | `live-coach.spec.ts` |
| Four honest banner states | `LIVE_AUDIO_NOTICE` | `live-audio-mode.spec.ts` |
| Claim-guarded finalise | `callIntelligence.ts` | its own specs |

### Unverified — written, plausible, never run against a real call

- **Everything downstream of the first audio frame.** Deepgram is opened with
  `encoding=mulaw, sample_rate=8000` to match Twilio; no real frame has ever
  reached it from this code.
- **Speaker attribution**, as above.
- **Hint latency.** Heuristics publish on the same tick as the final transcript,
  so the floor is Deepgram's finalisation delay — interims are discarded
  (`interim_results: 'false'`). Gemini hints only fire on every 4th customer
  turn, so **a model hint can be three turns late by design.** The five-second
  target is realistic for heuristics and not for `coachTick`.
- **Exactly-once lead linkage.** The worker's `finalise` and the telephony
  webhook both drive the same chain, and both claim their rows first. Sound by
  design, unconfirmed in practice.
- **A page reload mid-call.** `start()` is only called by a button or by
  `placeCall`, so after a reload the screen shows vendor mode with no SSE
  attached. Left alone: the real call should say whether it matters.

### Missing — nothing works until these exist

1. **`LIVE_STREAM_WS_URL` is unset on staging** (`grep -c` → `0`, 17 Nov). Not
   merely a config gap: `workers/index.ts` only imports and starts the
   WebSocket server **inside `if (env.LIVE_STREAM_WS_URL)`**, so on staging
   **no port is open and no server is listening.** Any "is the engine up" check
   fails for this reason alone, whatever else is configured.
2. **A public `wss://` route to the worker's port 8090.** With a specific trap:
   **host port 8090 is already taken by the staging *web* container**
   (`3000/tcp -> 172.18.0.1:8090`). The worker's 8090 is inside a different
   container and must be published on a *different* host port, or routed by
   hostname through Caddy.
3. **A Deepgram key connected for the workspace.** `openSession` refuses with
   `no streaming STT` unless the transcription connection's provider is
   literally `deepgram` (case-insensitive) and carries an `apiKey`. Google batch
   transcription does not qualify, and the engine publishes a visible notice
   rather than going quiet.
4. **A Twilio connection with Media Streams enabled**, plus a `callerNumber`.
5. **A phone number on the test agent's user record** — the dial is refused
   before it starts otherwise.
6. **Recording consent on the call before dialling.** The dial route and the
   worker both refuse without it.
7. **`GEMINI_API_KEY`** — optional. Without it the coach is heuristics and
   playbook cards only, and the banner says so.

## Two defects found and fixed in this pass

**1. The coach had no rule against inventing prices or terms.**
`buildCoachPrompt`'s RULES line guarded against prompt injection in the
transcript and against profiling, and said nothing about fabrication. A model
asked to advance a property sale will cheerfully produce a plausible payment
plan, and the agent reads it to the customer as the company's word. Added an
explicit rule: nothing about a unit, price, discount, payment plan, availability
or handover date unless it appears verbatim in the CRM context block — no
estimates, no "typically", no promises on the company's behalf. Real inventory
still reaches the screen, through `budgetMatchHint` and `context.matches`, which
read the actual book.

**2. One network blip ended the hints for the rest of the call.**
`source.onerror` closed the EventSource and set the phase to `done`. On a phone
this is not an edge case: the agent answers on the handset, switches to the app,
and iOS suspends the WebView in between — which arrives here as an error. The
screen would then show a live call with no hints for the remainder, silently,
which is indistinguishable from "live coaching produced nothing". In vendor mode
the handler now leaves the socket alone so EventSource reconnects; the call is
over only when the engine publishes `done`. Events missed during the gap are
lost — redis pub/sub has no replay — which is the right trade for a live hint.

This second one would most likely have been read as a failure of the whole
feature during the first real test.

## Risks to settle before committing to a launch scope

- **UAE telephony regulation.** The workspace is UAE-based (+971 numbers, AED,
  Dubai and Abu Dhabi branches) and the UAE restricts VoIP. The bridged route is
  an argument in its favour: both legs terminate on ordinary mobile numbers over
  PSTN, so no VoIP app is involved. But Twilio's ability to originate to UAE
  mobiles and to present a UAE caller ID needs regulatory approval on the
  account. **Confirm with the provider before promising phone-call support.**
  Nothing in `docs/` records this; this document is the first place it is asked.
- **The demo path can write consent.** The SSE's demo branch upserts
  `consentGiven: true, method: 'VERBAL'` with the note "verbal consent assumed
  at session start". If anyone presses **Start simulated call** on a real lead's
  call record, consent is then on file, and a later "Place call with AI
  assistance" skips its confirmation and streams. Not patched here: it needs a
  decision about whether the demo may write to a real call at all.
- **Demo hints cannot be mistaken for live ones in the relay path.** The relay
  branch is taken whenever `externalCallId` and a real `providerName` are set,
  and `placeCall` dials before opening the SSE, so ordering protects it. The
  simulated button is separately labelled. Confirm on the real call that the
  banner reads **"Live call — the provider forks the call audio…"** and nothing
  else.

## Cost per coached minute: the multipliers, not the rates

Derived from the code. **The rates must come from the actual accounts — there is
no measured usage, because no call has run, and inventing a rate here would be
the same mistake as inventing a price.**

| Driver | Per minute of conversation | Why |
| --- | --- | --- |
| Twilio voice | **2 leg-minutes** | leg 1 to the agent's mobile, leg 2 to the customer |
| Twilio Media Streams | per Twilio's own schedule | one stream, both tracks |
| Deepgram streaming STT | **2 audio-minutes** | one socket per track; `openLiveStt` is called twice |
| Gemini | one `coachTick` per 4 customer turns, window ≤ 4000 chars | `session.customerTurns % 4` |
| Recording storage | only if `record` was requested | separate from streaming |

So a 10-minute coached call bills roughly **20 Twilio leg-minutes and 20
Deepgram audio-minutes**, not 10 of each. That 2× on both lines is the single
most important number for pricing a pilot, and it is a property of the bridged
architecture rather than a bug.

Fill the rates in from the Twilio and Deepgram consoles for UAE termination,
then multiply. Do not quote a figure to a customer before one real call has
produced a usage record to check it against.
