# Live coaching on staging: the operator handoff

Staging only. **Nothing here touches production.** Every command below is
read-only until Step 2, and the write in Step 2 is one line in one env file plus
a container restart.

**Nothing here prints a secret.** Every check returns a count, a status code, a
hostname, a container name or a log line. If a command here would print a key,
it is the wrong command — stop and say so.

The code this document goes with is on `feat/live-coaching-first-call`
(PR #261). The audit behind it is `docs/product/LIVE-COACHING-AUDIT.md`; the
call script is `LIVE-COACHING-FIRST-CALL.md` §5–6.

---

## Step 1 — the first command: discover the topology

**Run this before anything else.** It decides where the engine's port has to go,
and it is the one question the repository cannot answer: the committed
`docker-compose.staging.yml` and `Caddyfile.intranet` describe two different
arrangements, and the `ios-staging` compose file is not in this repository. **Do
not assume 8090, do not assume 8091, and do not assume a bridge address.**

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' | grep -Ei 'staging|caddy|proxy|worker'
```

Then, for the containers that printed:

```bash
docker inspect $(docker ps -q) --format '{{.Name}} networks={{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Read two things off that output and write them down:

| Question | How the output answers it |
| --- | --- |
| **Which host ports are already taken?** | the `Ports` column of every row. The engine's host port, if one is needed at all, must not appear there |
| **Does the proxy serving `ios-staging` share a network with the worker?** | compare the `networks=` lists of the proxy container and the worker container |

- **Case A — the proxy shares a network with the worker.** Nothing needs
  publishing to the host at all. The proxy reaches the worker by container name
  on the shared network, and there is no host-port question to get wrong. This
  is the smaller change; prefer it when the output allows it.
- **Case B — it does not.** The worker must publish its port on the host, bound
  to loopback or to the bridge address the proxy actually uses, and that address
  comes from the same `docker inspect` output — not from this document.

```bash
# Case B only: the gateway of the network the proxy is on.
docker network inspect <the proxy's network from above> --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'
```

**Stop condition:** if no container in the first command's output is serving
`ios-staging`, stop. Nothing below is about the right stack.

**Send me the output of these three commands and I will write the exact one-line
compose and proxy diff for whichever case it turns out to be.** The choice is a
fact about your host, not a preference, and guessing it is how a staging window
gets spent learning one thing.

## Step 2 — where `LIVE_STREAM_WS_URL` must be effective

`workers/index.ts:87-90` starts the WebSocket server **only inside
`if (env.LIVE_STREAM_WS_URL)`**, and `calls/[id]/dial/route.ts:88` gates the
whole `<Stream>` element on the same variable. **So it must be effective in both
containers — the worker and the web app.** One of the two alone gives you either
an engine nobody forks audio to, or a fork aimed at nothing.

In `docker-compose.staging.yml` both services share `env_file`, so one line
serves both. **Confirm the same is true of the `ios-staging` stack** — the
existing doc names a different env file — with the read-only check in Step 3.

Set the **public** address, with **no path**: the dial route appends
`/twilio-media` itself, and the worker listens on that path
(`liveStream.ts:197`).

```
LIVE_STREAM_WS_URL=wss://<the public host from Step 1>
```

Then restart the worker and the web app, because the web app reads it too.

## Step 3 — verify the engine is listening, and that both containers agree

```bash
# Present in both containers? Two lines, each "1". Prints no value.
for c in <web container> <worker container>; do
  docker exec "$c" sh -c 'test -n "$LIVE_STREAM_WS_URL" && echo 1 || echo 0'
done

# The host only, never the rest of the URL.
docker exec <worker container> sh -c 'echo "$LIVE_STREAM_WS_URL"' | sed -n 's#^wss\?://\([^/]*\).*#\1#p'

# The engine started.
docker logs --since 10m <worker container> 2>&1 | grep -c 'realtime call engine listening'
```

**Expected:** `1`, `1`, a hostname, then `1`.

**Stop conditions.** A `0` from either container is the whole feature disabled —
fix that before anything else. A `0` from the log means the server did not start
even though the variable is set: read the worker log.

## Step 4 — verify the endpoint, from a machine that is not the host

This is a **different route** from the Today pilot's dashboard tunnel: that one
carries HTTP to the *web* container, this one carries WebSocket to the *worker*.
Proving one says nothing about the other.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<the public host>/twilio-media
```

| Code | Means |
| --- | --- |
| **`400` or `426`** | **Proceed.** A WebSocket endpoint refusing a plain GET is the proof something is listening and speaking HTTP there |
| `200` with a page | pointed at the **web** container, not the worker — the most likely mistake |
| `404` | reached a proxy, but nothing is routing `/twilio-media` |
| `502` / `503` | the proxy is routing it at an address nothing is listening on — in Case B, usually the wrong bridge address |
| timeout / `Connection refused` | the address does not reach the host at all |
| a redirect | stop; the provider will not follow it |

## Step 5 — verify an *authenticated* provider session

A `400` proves a listener, not an accepted session. The stream is authenticated
per call by an HMAC the operator cannot and should not mint, so the only honest
proof is the worker's own log on the first real dial:

```bash
docker logs --since 5m <worker container> 2>&1 | grep -E 'live stream (attached|refused)'
```

| Line | Means |
| --- | --- |
| `live stream attached` with a `callId` | **the token verified, consent was on file, and audio is flowing.** This is the line that proves the provider-to-worker path end to end |
| `live stream refused` with a reason | the session was rejected. The reason is one of: a bad token, a call that is not RINGING or IN_PROGRESS, **no consent**, or a transcription connection whose provider name is not Deepgram |
| nothing at all | the provider never reached the worker. Go back to Step 4 |

**A `no consent` refusal after this branch is expected if the call's only consent
row came from the demo simulation.** That is the fix working: record consent for
the real call through the screen's own confirmation, which replaces the row.

## Step 6 — the provider's own account, before dialling

Two questions for the provider, and the second decides the launch scope:

1. **May this account originate to UAE mobile numbers?**
2. **May it present a UAE caller ID?** Both legs of this route terminate on
   ordinary mobile numbers over PSTN — which is the argument in the route's
   favour where VoIP is restricted — but origination and caller ID are
   account-level permissions, not code.

**Ask before the first dial.** A refused origination burns a staging window; a
wrong caller ID burns the test participant's trust and tells you nothing about
coaching.

## What is missing, by name only

No values, here or anywhere:

| Needed | Where it goes | Checked by |
| --- | --- | --- |
| `LIVE_STREAM_WS_URL` | the env file both containers read | Step 3 |
| A **Twilio** connection with Media Streams enabled and a caller number | Administration → Integrations | the live screen's banner |
| A **Deepgram** transcription connection — the provider name must be Deepgram, any case | Administration → Integrations | Step 5's refusal reason |
| `GEMINI_API_KEY` — optional | deployment config | without it, hints are rule-based and the banner says so |
| A phone number on the test agent's own user record | the user record | the dial is refused outright without it |
| A dedicated **Sales Agent** staging account | provisioned, not seeded — the seed refuses on `APP_ENV=staging` by design | `TODAY-PILOT-STAGING-DEPLOY.md`, last section |
| A **synthetic lead** with an approved test number and a recorded budget and location | the test workspace | with nothing on record the coach can only ask questions, which is the correct behaviour |
| A **real test participant** on an approved number who has agreed to a recorded, AI-assisted call | — | the consent confirmation on screen |

## Then, and only then

`LIVE-COACHING-FIRST-CALL.md` §5–6: three calls on the first phone, the
objection-to-hint stopwatch, the customer asked what they could hear, the
exactly-once check on the lead's timeline, and the two failure paths. iPhone and
Android recorded separately.

**Live coaching is not working until a useful hint reached the agent before
hang-up on a real call, on a phone, with the customer on the line.** Until then
the honest sentence stays: the engine is written and tested in parts; it has
never been fed a real phone call.
