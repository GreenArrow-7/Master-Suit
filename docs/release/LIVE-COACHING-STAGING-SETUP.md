# Live call coaching on staging: what is missing, and how to check it

Live coaching is **built** and **unproven**. Three transports exist in code —
a scripted simulation, the browser microphone, and a vendor media stream — and
only the third can coach a real phone call.

`apps/web/docs/MOBILE-AI-CALLS.md` settles why: iOS exposes call *state*
through CallKit and no audio, Android barred the Accessibility route to remote
call audio in 2022, and the default-dialler role gives routing rather than
capture. Its conclusion:

> No production-safe way exists for YOUHAN ONE to take audio from a normal
> phone call on the handset, on either platform. … The only reliable path to
> live customer-call audio is a call leg the platform itself places or bridges
> through a telephony provider, with the audio taken **server-side**.

So the browser-microphone transport records the room, which is a desk
arrangement, not an agent on a handset. **The vendor stream is the only path**,
and everything below is about making that one work.

## Nothing here asks anyone to share a credential

Every check prints a yes/no, a count or a log line. None prints a value. Do not
paste `.env` contents into a chat, a ticket or a terminal someone is sharing;
if a check below ever prints a secret, it is the wrong check.

## The gate, exactly

`dial/route.ts` asks the vendor to fork the audio only when all three hold:

```ts
env.LIVE_STREAM_WS_URL && telephony.provider.capabilities.includes('LIVE_STREAM') && consented
```

Miss any one and the call is placed with no stream, and the live screen falls
back to the script. That is the whole reason a demo can look like a working
call.

## Measured on 17 November 2026

Both checks were run on the host and their output is recorded here so nobody
repeats them to learn the same thing.

| Check | Result | Means |
| --- | --- | --- |
| `grep -c '^LIVE_STREAM_WS_URL=.\+' /home/deploy/ios-staging/.env.ios-staging` | **0** | Prerequisite 1 is **missing**. Staging is in `no-engine` mode, and the live screen says "Live guidance is not configured on this deployment." |
| `docker exec infra-web-1 node -p "require('next/package.json').version"` | **16.4.2** | Unrelated to coaching, recorded because it was run in the same sitting: production's *running* Next.js, read from the container rather than inferred from a lockfile. |

So the gate in `dial/route.ts` cannot open today whatever else is configured,
and prerequisites 2 and 3 are untested behind it — a provider that cannot fork,
or a missing speech-to-text connection, would both be invisible until
prerequisite 1 is fixed. Fix the address first, then re-read the banner, and
only then place the call.

## Prerequisite 1 — the engine has a public address

The worker runs a WebSocket server on `LIVE_STREAM_PORT` (default 8090) at path
`/twilio-media`. The vendor must be able to reach it from the internet over
TLS, and `LIVE_STREAM_WS_URL` must be that public `wss://` origin.

**Who owns it:** whoever runs the staging host.

**Check it is set, without printing it:**

```bash
grep -c '^LIVE_STREAM_WS_URL=.\+' /home/deploy/ios-staging/.env.ios-staging
```

`1` means set and non-empty. `0` means missing — this is the first thing to
fix, and until it is, the live screen will say *"Live guidance is not
configured on this deployment."*

**Check the worker is listening:**

```bash
docker logs --since 24h youhan-ios-staging-worker-1 2>&1 | grep -c 'realtime call engine listening'
```

**Check the public address answers, from a machine outside the host.** A
WebSocket endpoint refuses a plain GET, and that refusal is the proof: a `400`
or `426` means something is listening and speaking HTTP; a timeout or
`Connection refused` means the address does not reach the worker.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<the public host>/twilio-media
```

Replace `<the public host>` with the host part of `LIVE_STREAM_WS_URL`. You can
read just the host without the rest of the URL:

```bash
sed -n 's#^LIVE_STREAM_WS_URL=wss://\([^/]*\).*#\1#p' /home/deploy/ios-staging/.env.ios-staging
```

That prints a hostname only. If it would print anything else, stop.

## Prerequisite 2 — a provider that can fork the audio

A telephony connection whose provider advertises the `LIVE_STREAM` capability.
In practice: a Twilio account with Media Streams enabled. Exotel, Knowlarity,
Plivo and the development mock are connected the same way and **cannot** fork;
with one of those the call is placed and recorded and there is no guidance
during it, and the screen says so.

**Who owns it:** whoever holds the Twilio account.

**Check which mode staging is in** — Administration → Integrations shows the
connection, and a call's live screen states the mode in one sentence
(`liveAudioMode`, `src/lib/integrations/telephony/liveAudio.ts`):

| What the screen says | What is missing |
| --- | --- |
| "No calling provider is connected…" | the connection itself |
| "<Vendor> cannot stream live audio…" | a provider that can fork |
| "Live guidance is not configured on this deployment…" | prerequisite 1 |
| "Live call — the provider forks the call audio…" | nothing; ready to test |

**This banner is a configuration readout, not evidence of coaching.** It says
the gate would open. It does not say a hint ever reached anybody.

## Prerequisite 3 — streaming speech-to-text

The engine opens a streaming STT connection per track
(`openLiveStt`, `src/lib/integrations/transcriptionStream.ts`); Deepgram is the
provider `MOBILE-AI-CALLS.md` names. Connected under Administration →
Integrations, per workspace.

**Who owns it:** whoever holds the STT account.

**Check without printing the key:** the integrations screen shows the
connection as configured. A missing one shows as a visible notice on the live
screen during the call rather than silence — the engine publishes it and
swallows the audio.

## Prerequisite 4 — a model key, which is optional

`GEMINI_API_KEY` buys model hints. Without it the coach still produces
heuristic and playbook hints, and the banner appends *"AI hints are heuristic
until an AI provider is connected."* **Not a blocker for the test.**

## The test that counts

Prerequisites 1–3 green, then one real call, on staging, to a real handset:

1. Open a lead, create a call, open the live workspace.
2. Confirm the banner reads **"Live call — the provider forks the call
   audio…"**. If it reads anything else, stop: the gate is shut and whatever
   appears next is the simulation.
3. Press **Place call with AI assistance**. Answer the handset.
4. Speak as a customer would — state a budget, raise an objection.
5. Watch for a hint **before anyone hangs up**, and note the clock.

### What to record

| Evidence | Where |
| --- | --- |
| Active transport | the SSE's first event carries `transport: 'vendor-stream'` |
| Time to first useful hint | wall clock from answer to the hint appearing |
| The agent could see it mid-call | a screen recording, or a photo of the screen with the call still connected |
| The transcript came from the vendor | `Transcript.provider = 'live-stream'` on that call |
| The call is on the right lead | the lead's timeline shows it |
| The engine ran | `realtime call engine listening` plus per-call lines in the worker log |

```sql
-- provider and linkage, no content
SELECT c.id, c."leadId", c."providerName", t.provider, t."wordCount"
FROM "Call" c LEFT JOIN "Transcript" t ON t."callId" = c.id
WHERE c.id = '<the call id>';
```

### What does not count

- The banner. It reports configuration.
- The simulation. It coaches a script and is the default when the gate is shut.
- A post-call transcript, analysis or audit. Those run on the batch path and
  prove nothing about guidance during the call.
- Code review. All of it is already written; that was never the question.

**Live coaching is verified only when a useful hint reached the agent before
hang-up on a real call.** Until that happens the honest sentence is: the
coaching engine works and you can watch it work; it has never been fed a real
phone call.
