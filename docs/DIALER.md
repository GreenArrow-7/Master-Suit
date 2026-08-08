# The auto-dialer (M7)

Most of M7 was already here before this change. Click-to-call, four telephony
vendors, provider-side recording, ingest into our own bucket, transcription,
Gemini analysis, call auditing and campaigns all shipped with the engagement
work. What did not exist was the thing that turns a list into a shift: a queue
an agent works through without deciding who to ring next.

## The acceptance criterion is the design

> Dialer state survives a page refresh; no call is lost or double-dialled.

**Surviving a refresh** is why the agent's position is
`DialerSession.currentContactId` — a column, not client state. The page is
server-rendered from that row, so a refresh, a closed laptop or a flat battery
resumes on the same person with the same counters. There is nothing to lose
because there is nothing held in the browser.

**Not double-dialling** takes four mechanisms, because one is not enough:

1. **One live session per agent**, enforced by a partial unique index
   (`DialerSession_one_active_per_user`). Two sessions means two queues
   advancing independently and a second call placed while the first is ringing.
   Starting a dialer on a second campaign is refused rather than silently
   switching — switching would abandon whoever the agent was mid-call with.
2. **The next contact is claimed with `FOR UPDATE SKIP LOCKED`.** Two agents
   advancing in the same instant each take a different row; SKIP rather than
   NOWAIT so the second gets the *next* person instead of an error.
3. **A cooldown on the number, not the row.** The same person can sit in two
   campaigns and the handset does not care which list the call came from, so
   the check is `NOT EXISTS (SELECT … FROM "Call" WHERE recipientNumber = …
   AND startedAt > now() - cooldown)` — evaluated inside the same statement
   that claims, because checking afterwards leaves a window.
4. **A stale-claim sweep.** A session idle for fifteen minutes is ended and
   whatever it held goes back to the queue. Run when somebody asks for the next
   number rather than on a schedule: that is the only moment the answer matters.

`tests/sales/dialer.spec.ts` asserts all of it, including two agents starting
and advancing concurrently.

## Queue rules

- **Skipping costs nothing.** An agent passing on a row does not burn one of the
  attempts the number gets, or a campaign quietly exhausts its own list.
- **A number retires after `dialerMaxAttempts`** — unless the last attempt
  actually connected, in which case it is COMPLETED. Somebody answering on the
  third try and saying no is a finished conversation, not a number that ran out
  of chances.
- **A callback waits for the time the client asked for**, not the cooldown.
- **Withdrawn consent is never queued at all** — not even as SUPPRESSED. A row
  that exists is a row an agent can un-skip.
- **Two leads on one household number produce one queue entry.** Deduplicated
  inside the batch as well as against the table, so the unique index does not
  fail the whole load.

Both settings are per workspace (`OrganizationSetting.dialerCooldownSeconds`,
`dialerMaxAttempts`), because how long is long enough differs between a launch
campaign and a collections desk.

## Permissions

`dialer` is its own module rather than part of `calls`. Placing a single call
from a lead and being handed a queue of two hundred strangers are different
authorities: the first is what every agent does, the second is a shift a manager
assigns.

| Action | Who gets it by default | What it is |
|---|---|---|
| `VIEW` | whoever holds `calls:EDIT` | Work a queue |
| `CREATE` / `EDIT` | whoever holds `campaigns:EDIT` | Decide who is in it |
| `MANAGE_USERS` | whoever holds `leads:REASSIGN` | The team dialer: see and end other agents' sessions |

## What shipped in the UI

- **The console** at `/{slug}/sales/campaigns/[id]/dialer` — the contact, a call
  button, eight disposition buttons, notes, skip, callback and end. Every action
  replaces the whole state from the server's response; a client that guessed who
  was next could show an agent somebody another agent is already speaking to.
- **The team view**, on the same page for leaders: who is live, who they are on,
  their counts, and how long since they last advanced.
- **Recording playback with a scrubber** on the call detail page — a native
  `<audio controls preload="none">`. Seek, speed and keyboard control for free,
  and better than a hand-rolled scrubber would be. It says so plainly when the
  media is still transferring from the vendor rather than failing silently.

## What was deliberately left out

**Lead data allocation and allocation requests.** Named in M7 and not built. It
is a different job from the dialer — distributing unassigned leads to agents,
and agents asking for more — and `DistributionRule` already exists to build it
on. Doing it here would have been a second module in one change.

**Cross-segment lead routing.** Same reason, same place: it belongs with
allocation, on top of `DistributionRule`.

**Predictive or parallel dialling.** The queue is sequential: one agent, one
contact, one call. Predictive dialling means ringing several numbers per agent
and dropping whoever answers second, which is a regulated practice in most of
the markets this product serves and needs an abandonment-rate policy before a
line of code.

**A dialler for inbound.** Nothing here answers calls. Inbound webhooks land on
the telephony route and create Call rows, but there is no queue, no routing and
no wallboard.

**Session pause.** `DialerSessionStatus.PAUSED` exists in the enum and nothing
sets it. Ending and restarting is one press each and loses nothing, so pause
would be a third state to keep correct for no behaviour a shift actually needs
yet.
