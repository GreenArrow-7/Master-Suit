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
