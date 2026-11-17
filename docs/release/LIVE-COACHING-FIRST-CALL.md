# The first real coached call on staging

Staging only. **Nothing here touches production.** Prerequisites and the
credential-free checks are in `LIVE-COACHING-STAGING-SETUP.md`; the code audit
is `docs/product/LIVE-COACHING-AUDIT.md`. This document is the ordered sequence
for the operator, because the engine needs host access that I do not have.

**Nothing below prints a secret.** Every check returns a count, a status code,
a hostname or a log line. If a command here would print a key, it is the wrong
command — stop and say so.

## Step 0 — the thing that blocks everything

`workers/index.ts` starts the WebSocket server **only inside
`if (env.LIVE_STREAM_WS_URL)`**. With it unset — which is staging today — no
port is open and no server is listening. So the address must be decided first,
then the worker restarted. Checking for a listener before that is pointless.

**And 8090 on the host is already taken by the staging web container:**

```bash
docker port youhan-ios-staging-web-1 3000/tcp     # expect 172.18.0.1:8090
```

The worker's `LIVE_STREAM_PORT` is also 8090, but inside the worker container.
Publish it on a **different host port** — 8091 below — or route it by hostname
through Caddy. Do not reuse 8090.

## Step 1 — publish the worker's port and give it a public wss:// address

Twilio must reach this from the internet over TLS, so a tunnel or a Caddy
hostname is required; a bare host port will not do. In
`/home/deploy/ios-staging/docker-compose.yml`, under the `worker` service:

```yaml
    ports:
      - "127.0.0.1:8091:8090"
```

Bound to loopback deliberately: the tunnel or proxy is the only way in. Then,
in `/home/deploy/ios-staging/.env.ios-staging`, set the **public** address —
not the host port:

```
LIVE_STREAM_WS_URL=wss://<the public host>
```

The dial route appends `/twilio-media` itself, so **do not include a path.**
Then:

```bash
cd /home/deploy/ios-staging
docker compose --env-file .env.ios-staging up -d worker
grep -c '^LIVE_STREAM_WS_URL=.\+' .env.ios-staging          # expect 1
docker logs --since 5m youhan-ios-staging-worker-1 2>&1 | grep -c 'realtime call engine listening'
```

**Expected:** `1`, then `1`. **Stop condition:** the second returns `0` — the
server did not start, and nothing downstream can work. Read the worker log.

## Step 2 — verify the endpoint independently of the dashboard tunnel

This is a different route from the Today pilot's tunnel: that one carries HTTP
to the **web** container, this one carries WebSocket to the **worker**. Prove
this one on its own, from a machine that is not the host:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<the public host>/twilio-media
```

**Expected: `400` or `426`.** A WebSocket endpoint refuses a plain GET, and that
refusal is the proof something is listening and speaking HTTP at that address.

**Stop conditions:** a timeout or `Connection refused` means the address does not
reach the worker. A `200` with a page means it is pointed at the **web**
container instead — the most likely mistake, given 8090.

Read the host back out of the env file without the rest of the URL:

```bash
sed -n 's#^LIVE_STREAM_WS_URL=wss://\([^/]*\).*#\1#p' /home/deploy/ios-staging/.env.ios-staging
```

**That prints a hostname only. If it would print anything else, stop.**

## Step 3 — the three integration prerequisites

In the test workspace, Administration → Integrations:

| Connect | Check it took |
| --- | --- |
| **Twilio**, Media Streams enabled, with a caller number | the live screen's banner (step 5) |
| **Deepgram** — the provider name must be `deepgram`, any case | `openSession` refuses with `no streaming STT` otherwise |
| **Gemini** — optional | without it, hints are heuristic and the banner says so |

Google batch transcription does **not** qualify. The engine publishes a visible
notice rather than going quiet, so a wrong provider shows up as a message on the
live screen during the call.

Then, on the test agent's own user record: **a phone number.** This is the
handset Twilio rings — the dial is refused outright without it, and a wrong
number here bridges the wrong person into a customer conversation.

## Step 4 — the test fixtures

- A dedicated **Sales Agent** account, not an administrator. Staging is not
  demo-seeded, so see the last section of `TODAY-PILOT-STAGING-DEPLOY.md` for
  finding or resetting one.
- A **synthetic lead** with an approved test number as its phone, and a recorded
  requirement (budget and location) — the brief and the budget match both read
  it, and with nothing on record the coach can only ask questions.
- A **real test participant** on that approved number who has agreed to a
  recorded, AI-assisted call, and who will follow the script below.

## Step 5 — the call

1. The agent signs in on the phone, opens the lead, opens the call, and lands on
   the live workspace.
2. **Read the banner before anything else.** It must say *"Live call — the
   provider forks the call audio…"*. If it says anything else, **stop** — the
   gate is shut and whatever appears next is the simulation, not coaching.
   The other three sentences each name exactly what is missing.
3. **Put the phone on speaker, or use a headset.** The agent cannot hold the
   phone to their ear and read the screen. This is a real constraint of the
   route, not a workaround.
4. Tap **Place call with AI assistance** and confirm the consent prompt. Twilio
   rings the agent's handset first; answer it, and the customer is bridged.
5. Switch from the phone app back to the app or Safari. The call stays up — iOS
   shows the green status bar.

### The script, and the one measurement that matters

The participant says, close to verbatim:

> "The upfront payment is too high."

**Start a stopwatch on the last word.** Stop it when a hint is visible on the
agent's phone. Expect something close to *"Ask what upfront budget they're
comfortable with"* — a question, not a number.

| Record | |
| --- | --- |
| Objection → visible hint, in seconds | |
| The hint's wording, verbatim | |
| Was it useful, or generic? | |
| Did it appear **before** hang-up? | |

**Pilot target is five seconds or less.** Report the real number whatever it is.
Heuristic hints should make it; a `coachTick` model hint fires only on every
4th customer turn and can legitimately be three turns late.

**A hint that states a price, a unit, a payment plan or a handover date that is
not on the lead's record is a defect — photograph it.** The prompt now forbids
it; this call is the first test of whether that holds.

### Then, in the same call

- **Ask the participant what they can see and hear.** They must not have heard
  the hint or any coach audio. The hints are text on a separate leg; confirm it
  rather than assume it.
- Check the live transcript attributes lines to the right speaker. Agent lines
  under *Agent*, customer lines under *Customer*. **If they are swapped, stop
  the pilot** — the coach is then hinting at the agent's own words, and nothing
  downstream can be trusted.
- Hang up. The outcome dialog should open within about five seconds.

### After

```sql
-- provider and linkage, no content
SELECT c.id, c."leadId", c."providerName", t.provider, t."wordCount"
FROM "Call" c LEFT JOIN "Transcript" t ON t."callId" = c.id
WHERE c.id = '<the call id>';
```

**Expect** `providerName = 'twilio'`, `t.provider = 'live-stream'`, a non-zero
word count, and the correct `leadId`. Then open the lead and confirm the call
appears on its timeline **exactly once**.

## Step 6 — three calls, not one, and then the failure paths

**Run at least three calls on the first phone.** A race that happens half the
time passes a single run, and the latency number means nothing from one sample.
Record each one's objection-to-hint time separately.

Then the two failures that must stay safe:

| Test | How | Expected |
| --- | --- | --- |
| **Consent declined** | decline the confirmation prompt | no call placed, no stream, nothing recorded |
| **Streaming unavailable** | disconnect Deepgram, place a call | the call still connects and is usable; a visible notice says guidance is unavailable; **no hints appear at all** — least of all scripted ones |

The second is the one that protects the product's honesty. If simulated hints
appear while Deepgram is disconnected, that is a release blocker.

## Record the devices separately

**Only the phones and routes actually tested may be claimed.** iPhone results and
Android results are separate rows, and Safari is distinct from the installed app
(whose WebView suspends differently when the agent switches back from the phone
app — the reason `onerror` no longer closes the stream in vendor mode).

| Device | OS | Browser or installed app | Calls | Hint latencies | Result |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

**Live coaching is not working until a useful hint reached the agent before
hang-up on a real call, on a phone, with the customer on the line.** Until then
the honest sentence stays: the engine works and you can watch it work; it has
never been fed a real phone call.
