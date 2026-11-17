# Putting the Today pilot on staging, for a real iPhone

Staging only. **Nothing here touches production.**

## The answer to "do we have to merge first": no

`.github/workflows/build-images.yml` is `workflow_dispatch` with a `sha` input,
checks out `ref: ${{ inputs.sha }}`, and refuses if the checkout is not that
exact commit. **There is no branch gate** — not in the workflow, and not in
`docs/release/staging-acceptance.sh`, which takes a candidate SHA and no branch.

So an approved **PR-head** image can be built and deployed to staging without
merging #258 or #257. That is the route this document takes, and it means the
pilot can be tested before anything is merged.

## The blocker, and it is not the deploy

**Staging has no public HTTPS address.** It publishes `3000/tcp` on
`172.18.0.1:8090` — the Docker bridge — which the host can reach and nothing
else can. `PRODUCTION-RELEASE-PROCEDURE.md` records no staging hostname, and
none appears anywhere in `docs/`.

**And the installed iPhone app cannot be repointed at one.** `apps/mobile/capacitor.config.js`
reads `MOBILE_SERVER_URL` **at sync time** and bakes the origin into the binary:

```js
const url = serverUrl(process.env.MOBILE_SERVER_URL);
...(url ? { server: { url, cleartext: false } } : {})
```

There is no runtime switch. Changing where the installed app points needs a new
iOS build, synced with a different `MOBILE_SERVER_URL`, installed on the device.

So there are two different asks, and only one of them is small:

| Want | Needs |
| --- | --- |
| Test the pilot **in Safari on the iPhone** | A public HTTPS route to staging. Operator work, no app build. **This is browser testing** — real WebKit, real cellular, real touch, but not the installed app's WebView, its user agent, or CallWatch. |
| Test the pilot **in the installed app** | The above, **plus** a new iOS build synced with `MOBILE_SERVER_URL=<staging origin>`, installed via Xcode or TestFlight. |

Everything the Today pilot does — the ranked list, the offline queue, the
`router.refresh()` question — is web behaviour and is fully exercised by Safari.
**Safari is enough for this pilot.** The installed-app build is only needed if
you want the WebView shell in the loop.

## Prerequisites

1. **CI green on #258's exact head.** Read it, do not assume:
   `gh pr view 258 --json headRefOid --jq .headRefOid`
2. A public HTTPS route to staging (below). Owner: whoever runs the host.
3. The SHA staging is running now, for the rollback rehearsal.

## Step 0 — the HTTPS route (operator, once)

Production terminates TLS at `infra-caddy-1`. Staging is a separate Compose
project with no proxy in front of it. One of:

- **Add a staging hostname to the existing Caddy**, proxying to
  `youhan-ios-staging-web-1:3000`, with a DNS record and an ACME certificate.
  The staging container must join Caddy's network, or Caddy must reach
  `172.18.0.1:8090`.
- **Or a temporary tunnel** (Cloudflare Tunnel, `ngrok`) to `172.18.0.1:8090`,
  if a permanent hostname is not wanted for a pilot.

Either way, write the resulting origin down — the rest of this document and
`docs/qa/TODAY-PILOT-IPHONE-TEST.md` both need it.

**Staging origin:** `________________________`

**Stop condition:** if the origin does not serve `/login` over HTTPS from a
phone on mobile data, stop. Everything below assumes it does.

## Step 1 — build the image for the PR head

```bash
gh workflow run build-images.yml -f sha=<258 HEAD SHA>
```

**Expected:** two jobs, `web` and `worker`, both green, pushing
`ghcr.io/greenarrow-7/master-suit/{web,worker}:<sha>`.

**Stop condition:** either job fails, or the "Refuse anything but the exact
commit" step trips. Do not continue with a partially built tag.

## Step 2 — read what staging runs now

```bash
docker inspect youhan-ios-staging-web-1 --format '{{.Config.Image}}'
```

**Expected:** an image tag ending in a 40-character SHA. **Write it down** — it
is `PREVIOUS_IMAGE` in the next step, and the thing to roll back to.

## Step 3 — fetch the acceptance script

Run it from outside the checkout: phase 3 does `git checkout "$CANDIDATE"`
inside `/opt/mastersuite` and would otherwise swap the script under bash.

```bash
git -C /opt/mastersuite fetch --quiet origin
git -C /opt/mastersuite show origin/feat/agent-today-pilot:docs/release/staging-acceptance.sh > /root/staging-acceptance.sh
chmod +x /root/staging-acceptance.sh
```

## Step 4 — deploy to staging through the acceptance gate

```bash
SKIP_SMOKE="the §6b smoke needs staging's platform owner, whose password and authenticator secret are not recoverable" \
  PREVIOUS_IMAGE=<the SHA from step 2> \
  /root/staging-acceptance.sh <258 HEAD SHA> 2>&1 | tee /root/today-pilot-staging.log
```

**What each phase proves:**

| Phase | Proves |
| --- | --- |
| 1 isolation | it is the staging database, not production |
| 2 candidate images | the image IDs for this SHA exist and match |
| 3 migrations | nothing pending — this candidate adds none |
| 4 candidate up | staging is serving the pilot, `/api/health` 200, image matches |
| 5 §6b smoke | **skipped**, and the marker records that |
| 6 rollback rehearsal | the previous image still runs on this schema |
| 7 marker | writes `/var/lib/master-suite/tested.<tag>` |

**Expected:** `STAGING ACCEPTANCE PASSED`, and staging left running the pilot.

**Stop conditions:** any `STAGING ACCEPTANCE FAILED`. Phase 6 briefly puts the
**old** image back — if anyone is testing on the phone during the run they will
see the old build for a minute or two.

## Step 5 — confirm the build the phone will load

```bash
docker exec youhan-ios-staging-web-1 printenv BUILD_COMMIT
```

**Expected:** #258's head SHA. On the phone, **Menu → My Workspace →
Diagnostics** must show the same build. If the two disagree, the phone is on a
cached service worker — close the tab and reopen.

## Rollback

```bash
IMAGE_SHA=<the SHA from step 2> docker compose --env-file .env.ios-staging up -d web worker
```

Run from `/home/deploy/ios-staging`. Staging only.

## Then the phone

`docs/qa/TODAY-PILOT-IPHONE-TEST.md`, with the origin from step 0 written into
its blank. Label the result **browser testing in Safari** unless a new installed
build was made.

---

# The tunnel route, as one command sequence

Chosen 17 Nov 2026: a **temporary tunnel restricted to the test team**, for an
iPhone Safari test. Run every command on the staging host as a user who can
reach Docker. **Staging only — nothing below touches production.**

## Prerequisites

1. `verify` green on #258's head `8912682ea6b8b96290d0229de1a78946ecc84d24`.
   Confirmed: `verify` **pass** (8m30s). `face-e2e` skips — it is gated on
   `base_ref == main` and #258 targets `fix/post-save-navigation`.
2. `ngrok` installed and authenticated on the host (`ngrok config check`), or
   `cloudflared` with a Cloudflare Access policy. **A Cloudflare quick tunnel
   (`trycloudflare.com`) is open to anyone who has the URL** — it does not meet
   "restricted to the test team". Use basic auth or Access.
3. Nobody else is testing on staging: phase 6 of the acceptance script briefly
   puts the old image back.

## The sequence

```bash
# 1. Confirm the head CI passed on, and what staging runs right now.
gh pr view 258 --json headRefOid --jq .headRefOid
docker inspect youhan-ios-staging-web-1 --format '{{.Config.Image}}'   # WRITE THIS DOWN

# 2. Build the image for that exact SHA. Wait for both jobs green.
gh workflow run build-images.yml -f sha=8912682ea6b8b96290d0229de1a78946ecc84d24
gh run watch

# 3. Fetch the acceptance script from OUTSIDE the checkout it rewrites.
git -C /opt/mastersuite fetch --quiet origin
git -C /opt/mastersuite show origin/feat/agent-today-pilot:docs/release/staging-acceptance.sh > /root/staging-acceptance.sh
chmod +x /root/staging-acceptance.sh

# 4. Deploy to staging through the gate.
SKIP_SMOKE="staging's platform owner password and authenticator secret are not recoverable" \
  PREVIOUS_IMAGE=<the SHA from step 1> \
  /root/staging-acceptance.sh 8912682ea6b8b96290d0229de1a78946ecc84d24 2>&1 | tee /root/today-pilot-staging.log

# 5. Confirm the build the phone will load.
docker exec youhan-ios-staging-web-1 printenv BUILD_COMMIT

# 6. Read the port the tunnel must point at.
docker port youhan-ios-staging-web-1 3000/tcp

# 7. Open the tunnel, password-protected, to THAT address only.
#    Do NOT pass --host-header=rewrite: see the stop condition below.
ngrok http 172.18.0.1:8090 --basic-auth "tester:<a password you choose now>"
```

**Expected output, step by step**

| Step | Expected |
| --- | --- |
| 1 | the SHA above, and an image tag ending in a 40-char SHA |
| 2 | `web` and `worker` both green |
| 4 | `STAGING ACCEPTANCE PASSED`, staging left running the pilot |
| 5 | `8912682ea6b8b96290d0229de1a78946ecc84d24` |
| 6 | `3000/tcp -> 172.18.0.1:8090` |
| 7 | `Forwarding https://<name>.ngrok-free.app -> http://172.18.0.1:8090` |

**Stop conditions**

- Step 1 prints a SHA other than the one above → the PR moved; re-read CI first.
- Step 2 trips "Refuse anything but the exact commit" → do not deploy the tag.
- Step 4 prints `STAGING ACCEPTANCE FAILED` at any phase → stop, read the log,
  roll back with the command in the Rollback section above.
- Step 5 disagrees with step 1 → the container did not restart on the new image.
- Step 6 prints nothing, or a different address → point the tunnel at what it
  actually prints, not at the address written here.
- **Signing in works but saving anything fails with an origin/Server Action
  error** → the tunnel is rewriting the `Host` header. Next compares `Origin`
  to `Host` on every Server Action in production, and `allowedDevOrigins` in
  `next.config.ts` applies to dev only. Restart the tunnel without
  `--host-header=rewrite`.

**It proves the dashboard and nothing else.** The tunnel carries HTTP to the web
container. It does not touch the worker's WebSocket, `LIVE_STREAM_WS_URL`
(still unset), transcription or live coaching — those have their own runbook,
`LIVE-COACHING-STAGING-SETUP.md`, and are untested.

## Closing the tunnel when testing is done

```bash
# Ctrl-C the ngrok process, then confirm nothing is still listening:
pgrep -a ngrok || echo "tunnel closed"
```

Then rotate the basic-auth password out of your shell history
(`history -d` the ngrok line), and leave staging running — no rollback needed
unless the acceptance run failed.

## The test account

**Staging is deliberately not demo-seeded.** `apps/web/prisma/seed/index.ts`
refuses outright when `APP_ENV` is `staging`, and `docs/qa/04-environment-and-data.md`
says so in as many words: *do not seed demo data into it*. So there is **no**
published-password Sales Agent account on staging, and none can be named here.
The seeded persona `joel.fernandes@example.com` (`sales_rep`, team BB, branch
DXB, workspace `manath-homes`) exists only in a local or demo database.

Phase 1 of the acceptance script proves the database is **not production** —
it checks the database name, `APP_ENV`, and that staging's postgres is a
different container from `infra-postgres-1`. That is isolation. It is not
evidence that the data inside is test data, and I have not seen staging's rows.

**List the Sales Agent candidates that do exist** (prints emails and role keys,
never a password hash):

```bash
docker exec youhan-ios-staging-postgres-1 psql -U postgres -d mastersuite_staging -tAc \
  "SELECT u.email, r.key FROM \"User\" u JOIN \"Role\" r ON r.id = u.\"roleId\" WHERE r.key LIKE '%sales%' AND u.\"deletedAt\" IS NULL ORDER BY u.email LIMIT 20;"
```

If the user you want has no known password, reset it through the app's own
**Forgot password** flow against the tunnel URL (staging mail goes to Mailpit,
per phase 1's `mail=` line) rather than writing a hash into the database.

**Do not use an administrator account for this test.** The pilot's scope gate is
the thing under test: an org admin sees everything and would pass a test a
sales rep could fail.

## If, and only if, Safari leaves a WebView question open

A tunnel hostname is temporary, and baking one into an app binary outlives the
tunnel. So no TestFlight build is prepared in advance. If Safari turns up
something that only the app's WebView explains, the build is:

```bash
MOBILE_SERVER_URL=https://<the tunnel host> npm run -w apps/mobile sync
# then archive and upload from Xcode
```

Review time means the tunnel must still be open when the tester installs it —
which is the reason to prefer a permanent staging hostname if WebView testing
becomes routine.
