# The Today pilot on a real iPhone: airplane mode, end to end

Ten minutes. For whoever holds the affected iPhone.

## There is no link yet, and that is the first thing to fix

**The pilot is not deployed anywhere.** It exists on `feat/agent-today-pilot`
(PR #258) and on one laptop. Staging's web is published on `172.18.0.1:8090` —
the Docker bridge address, reachable from the host and from nothing else — so
there is no URL a phone can open today.

Before any of the below:

1. #258 is reviewed and merged.
2. CI builds images for the exact merge commit
   (`gh workflow run build-images.yml -f sha=<full sha>`).
3. That image is deployed to staging and the staging acceptance script is run
   (`docs/release/LIVE-COACHING-STAGING-SETUP.md` is a different runbook;
   staging deployment is `docs/release/staging-acceptance.sh`).
4. Whoever owns the host confirms the phone can reach staging, and says at
   which address.

**Write that address here when it exists:** `________________________`

Until then this document is a script with nowhere to run, and the pilot's
mobile evidence is a 375px browser window — which is not a phone.

## What a browser window did not test

The pilot was checked at 375px in Chromium. That exercised layout and nothing
else. It did **not** exercise: a real cellular drop, iOS Safari's service
worker, the WebKit engine, a real touch target, or the app's WebView shell.
Everything below is specifically the part a desk cannot do.

## 0. Confirm you are on the pilot build

Open the app, then **Menu → My Workspace → Diagnostics**, and read the build at
the top. It must be the commit #258 merged as. If it is not, stop — nothing
below means anything on the wrong build.

On **My Workspace** you should see **My priorities**: a numbered list, at most
seven rows, each with a name, a reason, and one button. If that section is
absent, you are on the old build.

## 1. The reason must survive a phone screen

For each of the first three rows, check the reason is **fully readable** — it
wraps onto its own line under the name and is never cut off or hidden.

A row without its reason is a backlog count again, which is the thing this
screen exists to replace. If any reason is truncated, photograph it.

## 2. Airplane mode: queue a call log

1. Open row 1. Note the lead's name.
2. Turn on **airplane mode**. Wait for the phone to show no signal.
3. Tap **Log call**, choose **Connected**, type the note
   `AIRPLANE TEST <your initials>`, and submit.

**Record exactly what you see, in this order:**

| Question | Write the answer |
| --- | --- |
| Did anything claim the call was saved? | |
| Did you see "You are offline…" or "N changes waiting to be sent"? | |
| Did the app leave the lead page? | |
| If it left, where did it land? | |

**What we expect and why it matters.** The change should be kept on the device
and the screen should say so. It must **not** read as completed.

**What we half-expect instead, and want confirmed on a real phone.** On a
laptop with the server unreachable, the app queued the call correctly — but the
lead page calls `router.refresh()` after logging **even when the save was only
queued**, and that refresh failed and put the browser on the offline page
instead of the lead with its pending notice. The queue was right; the feedback
was wrong. **Does the same thing happen in airplane mode on the phone?** That
is the single most useful answer in this document.

## 3. Reconnect

1. Turn airplane mode **off**. Wait for signal.
2. Open the app and return to that lead.

| Question | Write the answer |
| --- | --- |
| Did it say something like "Sent 1 change made offline"? | |
| Does the lead's timeline show the call **once**? | |
| Does it show it **twice**? | |
| Is the note `AIRPLANE TEST …` present and correct? | |

**Exactly one** is the pass. Two is a duplicate and a defect — photograph the
timeline.

## 4. Today updates

Go back to **My Workspace**.

- The lead you just called should have **left** the priorities list, or moved
  down with a different reason.
- The list should have promoted the next item, and the brief under it should
  now be about that new first row.

If the list is unchanged, say so.

## 5. Repeat once

Do sections 2–4 once more on row 1 (whatever it now is), with the note
`AIRPLANE TEST 2 <your initials>`. A race that happens half the time passes a
single run.

## What counts as a pass

All four: the queued call is never shown as completed; it arrives **once**;
Today updates; and the reasons are readable throughout. Anything else, write
down what you saw — including "it looked fine", which is also a result.

## What this does not test

Live call coaching. That is unrelated, has its own runbook
(`docs/release/LIVE-COACHING-STAGING-SETUP.md`), and is blocked on
`LIVE_STREAM_WS_URL`, which is not set on staging.
