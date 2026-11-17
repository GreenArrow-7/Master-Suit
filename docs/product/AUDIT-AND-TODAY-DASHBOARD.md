# Audit, and a proposal for the "Today" workspace

Written 16 November 2026 against branch `fix/post-save-navigation`
(`c0c34688`). Production runs `344eb9f57f49`, released 12 November.

**What this is based on, and what it is not.** This is a code-and-documents
audit. Nothing was run, no screen was opened, and no production data was read.
Where a claim is only as good as the file it came from, it says so. The three
labels below are used throughout and are not decoration:

| Label            | Means                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| **code**         | read in the source this session, quoted or cited by file and line      |
| **documented**   | asserted by a project document, not re-verified here                   |
| **unverified**   | neither — a hypothesis, labelled as one                                |

Two sources did most of the work and are better than anything this audit could
re-derive, so it cites them rather than duplicating them:

- `changes/PROJECT.md` — the project's own current-state record.
- `docs/qa/01-inventory.md` — a screen-level inventory read off commit
  `1b8226f9` on 6 November: 249 page files, 256 API routes, 231 Prisma models,
  66 permission modules, 11 queues, 12 schedules.

`graphify-out/` does not exist in this worktree, so the Graphify map was not
available and is not an input.

---

## 0. One page

### Does live phone-call coaching work today?

**The feature is built, in full, three different ways. Not one of them has been
proven on a real phone call, and the default path is a simulation.**

Three transports exist in code:

| Transport            | What it is                                                              | State                                                                     |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `demo-simulation`    | A scripted conversation replayed in real time, coached for real          | **Works with nothing configured.** This is the default.                   |
| `live-mic`           | The agent's browser microphone, ~5s chunks, real speech-to-text          | Needs a speech-to-text provider connected. Latency ~5–8s, by design.      |
| `vendor-stream`      | The telephony vendor forks the call audio to a WebSocket in the worker   | Needs Twilio Media Streams, `LIVE_STREAM_WS_URL`, and streaming STT.      |

The vendor path is not a stub: `src/workers/liveStream.ts` is a real WebSocket
server with per-call token auth, per-track streaming STT, transcript append,
Redis pub/sub to the browser's SSE, heuristic hints per segment and a model
coach tick every Nth customer turn (**code**). It is started by
`src/workers/index.ts:89-90` (**code**). The dial route asks the vendor for the
stream only when `LIVE_STREAM_WS_URL` is set, the provider advertises
`LIVE_STREAM`, and consent is on record (`dial/route.ts:85` — **code**).

What proves it, and what does not:

- The project's own record lists **"Real AI and telephony — a Gemini API key; a
  Twilio account with Media Streams, and one real call round trip on staging"**
  as still waiting on the owner (`changes/PROJECT.md:457` — **documented**).
- The QA suite's own live-coaching case is headed **"Needs credentials…
  Without them, the workspace runs in demo simulation and the positive steps
  become observation only"** (`docs/qa/05c-sales.md:637` — **documented**).
- `docs/CONVERSATION-INTELLIGENCE.md:3` still says real-time coaching is "out
  of scope and nothing here stubs them". That document is **out of date** —
  the live path was built after it. Worth correcting, because it is the file a
  new reader trusts.

So the honest sentence to say to a customer today is: *the coaching engine
works and you can watch it work; it has never been fed a real phone call.*

**The one risk that would change the plan,** and it is unverified: on the
`live-mic` path the agent is on a handset call while the browser records the
microphone. iOS does not reliably give a web view the microphone while a
cellular call is active. If that holds, `live-mic` is a desk-only feature and
the vendor path is the only route to coaching on a phone. Nobody has tested
this. It is a 20-minute test and it should be the first thing done
(§2.4).

### The five biggest problems in an employee's day

1. **The landing page tells you the size of your backlog, not what to do.**
   `dashboard/page.tsx` renders queue counts — "12 overdue follow-ups" — each
   linking to a filtered list. Nothing ranks one lead above another, nothing
   says why, and every row navigates away from the page (**code**).
2. **Nothing can be completed where it is surfaced.** There is no action on the
   landing page at all: not logging a call, not completing a follow-up. The
   machinery for both exists and is offline-capable (`src/lib/offline.ts`
   covers the call log and the follow-ups list — **documented**), but the
   dashboard does not use it.
3. **Volume without priority.** 249 page files and 66 permission modules
   (**documented**). An agent's actual day is leads, follow-ups, calls; the
   navigation gives those the same weight as portals, proposals and campaign
   analytics.
4. **Role differences are permission-gated, not designed.** Panels appear or
   vanish by grant, which is correct and well done — a representative no longer
   sees company headcount (**code**). But a manager and an agent see the *same
   shape*: the manager's real work (unworked leads, uneven allocation, at-risk
   deals, who needs coaching) lives on other screens.
5. **The best signal in the product is not on the screen where the day
   starts.** Lead scores move by event, the daily target board counts calls
   toward a target, the call engine produces audit scores and coaching
   insights, and `leadCallContext` already assembles everything needed to
   prepare for a call (**code**). None of it reaches the landing page.

### What can be customised now, with no new backend

All of this already has a data source and a permission rule:

- Today's status — `services/targets/dailyBoard.ts` (target, calls made,
  check-in state), `followUpDueWhere` for due and overdue on the workspace's
  clock.
- A ranked priority list — `Lead.score` + `LeadScoreHistory`,
  `nextFollowUp`/`stateOf` for overdue, `firstContactedAt` for untouched
  arrivals, `Lead.slaEscalatedAt` for SLA breaches.
- Quick actions — the existing call-log and follow-up endpoints, already
  idempotent and already in the offline outbox.
- Call preparation — `leadCallContext` + `contextPromptBlock`, which the live
  coach already consumes.
- Manager views — `coachingInsights.ts` (`coachingCounts`,
  `coachingAnalytics`), the allocation and distribution eligibility services.

### What needs new work or a decision

| Need                                                | Kind              |
| --------------------------------------------------- | ----------------- |
| A ranking service (one place that orders the day)   | New backend, small |
| Quick actions on the dashboard                      | New UI            |
| "Improve today"                                     | New UI + a small model prompt |
| Manager Today cards                                 | New UI, existing data |
| Live coaching on a real call                        | **Owner decision**: Twilio account with Media Streams, a Gemini key, `LIVE_STREAM_WS_URL` reachable from Twilio |
| Whether `live-mic` works on iOS during a call       | **A 20-minute test**, blocks nothing else |
| Retiring or demoting any feature                    | **Owner decision** — no usage data exists (§5) |

---

## 1. The modules, in plain English

Screen counts are from `changes/PROJECT.md`; the structural measurements from
`docs/qa/01-inventory.md` (**documented**, read 6 November).

Four product modules are sold separately: `SALES`, `HRMS`, `REAL_ESTATE`,
`LEAD_EAGLE`. Three groupings are enforced in code, which is why the same
screen appears under several products: `LEAD_MODULES` (all three lead
products), `SALES_OR_REALTY` (money and marketing), and no gate at all for
self-service — check-in, own attendance, own tasks, notifications, profile.

**The single most important architectural fact for this proposal:** the pages
under `realty/` and `lead-eagle/` are one-line re-exports of the pages under
`sales/`, and two tests enforce that (`tests/unit/realty-routes.spec.ts`,
`lead-eagle-routes.spec.ts` — **documented**). One dashboard built under
`sales/` is three dashboards. Build it anywhere else and it is one.

### 1.1 Sales — 76 screens

**Who and what.** Agents work leads, log calls, book follow-ups and site
visits, and move leads through stages. Managers watch the board and the
reports. Finance-ish roles work collections, commissions and proposals.

**How the day goes.** Lead arrives (portal, webhook, form, import, manual, or a
WhatsApp/call from an unknown number) → assigned, by rule or by hand → the
agent calls and logs the outcome with a next follow-up in one step → stage
moves, which can require fields and can book a site visit or meeting in the
same transaction → opportunity, booking, collection, commission.

**What works well.** The lead list, its board and its export read one URL
through one query (`leadListQuery`), so a figure and the list behind it can
never disagree — that is unusually disciplined. Keyset pagination. The call log
works offline. Stage moves book their own site visits atomically. Sensitive
fields are masked by role at serialisation, and `dialable()` refuses to build a
`tel:` link from a mask.

**What is incomplete or hard.**

- Live coaching is unproven on a real call (§2).
- `docs/DIALER.md` records what was deliberately left out: no inbound queue or
  routing ("Nothing here answers calls"), no predictive dialling,
  `DialerSessionStatus.PAUSED` exists in the enum and nothing sets it
  (**documented**).
- `addressed` on a playbook match is a bag-of-words heuristic, and the UI says
  so (**documented**). Honest, but it is a manager-facing number that is not a
  measurement.
- Diarisation assumes the first speaker is the rep on outbound calls; the
  recorded honest fix is channel-separated recording from the vendor
  (**documented**).

**What is duplicated.** Nothing structurally — the re-export rule prevents it.
But *presentationally* there are now several places that answer "what should I
do": the landing page, the sales board, the follow-ups list, the daily target
board on check-in, and the assistant. That is the overlap this proposal
resolves (§3, §5).

### 1.2 HRMS / People — 32 screens

Employees, users, roles, departments; face check-in, attendance, shifts,
roster, leave, overtime; payroll, payslips, WPS; recruitment, performance,
documents, compliance.

**Worth knowing:** attendance is deliberately *not* HRMS. Check-in, the
attendance record, attendance requests, the attendance summary, work locations,
the check-in/out rules and the holiday register work in **every** workspace;
everything else in People needs the HRMS entitlement (**documented**). Every
attendance read is bounded by `attendanceScope` — organisation-wide reader,
else a line manager's reporting line, else oneself. A manager's authority over
people stops at their reporting line (`reportingLine`).

This matters for the dashboard: **attendance cards can be built for every
workspace**, HR cards only where HRMS is sold.

### 1.3 Real Estate — 42 screens

The Sales property screens as a brokerage works them, plus Properties,
allocation (the data pool), events with QR passes, lead recycling, website
forms and landing pages.

### 1.4 Lead Eagle — 32 screens

The lead-management product: Real Estate's lead screens without the money and
marketing ones. It has its own sign-in door (`/login?product=lead-eagle`) and
a workspace whose only usable product is Lead Eagle lands on
`/{slug}/lead-eagle/dashboard` rather than the workspace summary
(`workspaceLanding` — **documented**).

### 1.5 Calls and ONE AI

| Layer                        | Where                                                              | State                                     |
| ---------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| Click-to-call, four vendors  | telephony integrations                                             | **documented**, shipped                   |
| Provider-side recording      | ingest into own bucket, consent-gated                              | **documented**                            |
| Transcription                | batch, provider abstraction                                        | **documented**                            |
| Analysis, audit              | Gemini, `AIAnalysis`, `CallAudit`                                  | **documented**                            |
| Talk ratio, playbook match   | `src/lib/ai/callMetrics.ts` — **measured in code, never asked of the model** | **documented**            |
| Live coaching                | three transports                                                   | §2                                        |
| Phone-app call logging       | CallWatch native plugin                                            | outbound from the app only (**documented**) |
| ONE AI assistant             | `/api/v1/assistant`                                                | answers from the asker's own records (**documented**) |

Every AI path has a labelled fallback — no Gemini key means analysis reads
`demo-simulation`, drafts read `template`, the practice prospect reads
`simulated`. That design choice is the reason this audit can be clear about
what is proven: **nothing fake can be mistaken for a model verdict**
(**documented**). It is also why the live workspace looks like it works when it
is simulating.

AI spend is metered per workspace into `WorkspaceUsage` and capped by
`assertAiBudget`, with two deliberate asymmetries: a workspace on its own
Gemini key is metered but never capped, and **the live coach degrades to
heuristic hints rather than throwing**, because interrupting someone mid-call
with a billing error is not a trade worth making (**documented**). No plan
ships with `ai_tokens_monthly` set, so the cap is inert until an operator picks
a number.

### 1.6 Allocation, follow-ups, permissions, integrations

- **Allocation.** Rules with conditions (source, city, project, language) and
  uneven shares; per-person daily quota, languages, availability, reporting
  line. Automatic assignment passes over anyone checked out, off-roster,
  outside their shift, not checked in past the cut-off, or on a confirmed
  holiday (`services/distribution/eligibility.ts` — **documented**). This is a
  genuinely good basis for a manager's "uneven allocation" card.
- **Follow-ups.** `followUpDueWhere` is the single definition of due and
  overdue, on the workspace's clock, and the Follow-ups list, its API, the
  boards, the Sales home and the assistant all read it (**documented**). One
  definition, five surfaces — the dashboard must be the sixth, not a seventh
  definition.
- **Permissions.** Roles in the database; scopes OWN < TEAM < BRANCH < REGION <
  ORGANIZATION; `atLeast()` to check, `assertRecordInScope` for a record by id,
  which answers 404 out of scope so existence does not leak. A lead's second
  owner reaches it as the owner does.
- **Integrations.** Property Finder, Bayut, Dubizzle, Google Ads, a signed
  custom webhook, portal lead emails; Google and Microsoft calendars; WhatsApp
  templates; Twilio SMS. Each portal needs a partner agreement and a signing
  secret, which is why several read "not configured" (**documented**).

### 1.7 What this audit did not verify

No screen was opened, on either desktop or mobile, with any role. The brief
asks for that and it is the one part not delivered. The smallest unblock: the
repo already carries both the run configuration and the test script.

```bash
npm --prefix apps/web run dev
```

`.claude/launch.json` defines `web`, `web-prod` and several port variants; a
local `.env` is present; `docs/qa/02-roles-and-personas.md` defines the roles
to test with and `docs/qa/05c-sales.md` the steps. A screen pass against a
seeded local workspace at phone and desktop width is roughly half a day and
needs no production access.

---

## 2. Live AI assistance during phone calls

### 2.1 The three calling paths, and whether live audio reaches the AI

**Path A — demo simulation.** `GET /api/v1/calls/{id}/live` with no vendor call
on the row. A scripted conversation is replayed in real time; the hints are
produced by the real coach (Gemini when keyed, heuristics otherwise). The route
**writes a consent row itself**, with
`consentedBy: 'Demo simulation — verbal consent assumed at session start'`, and
sets `providerName: 'demo-simulation'` (**code**). No phone call is placed and
the banner says so (**documented**, `docs/qa/05c-sales.md:645`).

This is the path a demo takes, and it is the default: `LiveCallWorkspace.tsx`
opens with `mode = 'sim'` (**code**, line 106). It proves the coaching engine.
It proves nothing about telephony.

**Path B — browser microphone (`live-mic`).** The agent takes the call on the
handset and the browser records the room in standalone ~5s chunks, each POSTed
to `/api/v1/calls/{id}/live-audio`. Each chunk is transcribed by the
workspace's connected batch STT provider, appended to the call's `Transcript`,
and answered with hints and a stage. **Audio is transcribed and discarded,
never stored** (**code**).

Design decisions in that route worth repeating, because they are the right
ones: one chunk gets an 8-second deadline and a lost race is answered `200`
with an empty transcript and a visible notice, so a provider stall drops one
sentence instead of killing the coaching feed mid-call; a fresh `MediaRecorder`
per chunk, because later slices of one recorder are headerless and
untranscribable; consent is a hard precondition and the server refuses audio
without it (**code**).

Requires: a speech-to-text provider connected, and consent. Latency is honestly
stated at ~5–8 seconds.

**Path C — vendor media stream.** The vendor rings the agent's phone first and
bridges the customer, so it is an ordinary handset call whose audio is forked
**at the vendor, never on the device**, to a WebSocket in the worker process
(`/twilio-media`, `LIVE_STREAM_PORT`, default 8090). Per-call token auth,
per-track streaming STT, transcript append, Redis publish to the browser's SSE,
heuristics and stage per segment, a model coach tick every Nth customer turn,
and the same claim-guarded analyse → audit chain on finalise (**code**).

The browser here is only a display: it subscribes to the SSE and never touches
audio, so closing the tab stops the display and nothing else (**code**).

The gate, exactly (`dial/route.ts:85` — **code**):

```ts
const stream =
  env.LIVE_STREAM_WS_URL && telephony.provider.capabilities.includes('LIVE_STREAM') && consented
```

All three conditions must hold or the call is placed with no stream, and the
live screen then falls back to the demo script.

### 2.2 The verdict

| Question                                              | Answer                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| Does the dialer open?                                 | Yes (**documented**)                                          |
| Is there post-call transcription and summary?         | Yes (**documented**)                                          |
| Is there real-time coaching **code**?                 | Yes, three transports (**code**)                              |
| Has a suggestion reached an agent before hang-up on a **real** call? | **No evidence.** Never proven.                 |
| Is the call activity linked to the lead?              | Yes — `Call.leadId`, and the lead timeline is headed by its calls (**documented**) |

A working dialer and a post-call summary do not prove live coaching, and this
product has both while the live claim rests on a simulation.

### 2.3 The first failing step

Not a code defect. **Three configuration values and one round trip.** In the
order they fail:

1. `LIVE_STREAM_WS_URL` — a public `wss://` URL that Twilio can reach, pointing
   at the worker's port 8090. Until it is set, the dial route never asks for a
   stream and path C cannot start.
2. A telephony connection whose provider advertises `LIVE_STREAM` — in practice
   a Twilio account with Media Streams enabled.
3. A streaming speech-to-text provider connected for the workspace.
4. A Gemini key for model hints. **Not a blocker**: without it the coach
   degrades to heuristics and the playbook, which still produce hints.

### 2.4 The smallest viable path to live coaching

Two steps, in this order, and the first blocks nothing else.

**Step 1 — the 20-minute test that decides the architecture.** On the affected
iPhone, in the app: open a lead, start a real handset call to a second phone,
and while it is connected open the live workspace and press the microphone
control. Either transcript lines appear or the microphone is refused. That one
observation decides whether `live-mic` is a shippable phone feature or a
desk-only one, and it needs no account, no credential and no deploy. **It has
never been done** (**unverified**).

**Step 2 — one real round trip on staging for path C.** Expose the worker's
8090 over TLS, set `LIVE_STREAM_WS_URL`, connect Twilio with Media Streams and
a streaming STT provider, place one call from the live workspace to a real
handset, and watch for a transcript segment and a hint before hang-up. Evidence
to keep: the SSE's `transport: 'vendor-stream'` status event, the `Transcript`
row with `provider: 'live-stream'`, and the worker's
`realtime call engine listening` log line.

**What I need from you to go further than this:** a Twilio account with Media
Streams (SID, token, a number), a Gemini API key, a decision on how the worker's
8090 is exposed, and a second handset. Until then no amount of code reading
moves this forward, and I will not describe the simulation as a working call.

---

## 3. The personal "Today" workspace

### 3.1 Build it on what exists

`src/app/(workspace)/[workspaceSlug]/dashboard/page.tsx` (795 lines) already
has most of the shape asked for, and it already solved the two hard problems:

- **Per-panel authorisation.** Entitlement decides whether the module exists;
  permission decides whether this viewer sees it; both must hold, and a panel
  the viewer may not see is simply absent, because "a 403 on the landing page
  would be worse, and telling someone a section exists but is denied leaks the
  same thing the numbers would" (**code**).
- **Counts scoped to the viewer's own grant**, not merely gated by it. The
  comment records why: a representative's "Active leads" used to be the
  company's total — "a number they can neither open nor act on, on the screen
  that is supposed to…" (**code**).

It also already renders a greeting, a scoped KPI strip, a **Needs attention**
section of queue rows with count, label, hint and tone, an `AiInsight` panel, a
**My day** panel, and a workspace follow-ups table. Zeros are filtered out
deliberately — "nobody is waiting to learn they have no pending overtime"
(**code**).

**So this is an extension, not a new screen.** Four things are missing:
ranking of individual items with a reason each, actions that complete work in
place, an "improve" card, and role-specific content rather than role-specific
visibility.

### 3.2 The common structure

Four bands, same order for every role:

1. **Today** — where I stand: target and progress, next appointment, overdue
   count, attendance state.
2. **My priorities** — a ranked list of at most seven *individual* items, each
   with a one-line reason and one primary action.
3. **Improve today** — one or two suggestions, each grounded in a named record
   or a measured number.
4. **Quick actions** — act on the item without leaving the page, then mark it
   done.

### 3.3 The cards

Every card below names its source, its calculation, who sees it, what it does
and what it shows when data is missing. Sources in `backticks` exist today
unless marked **new**.

#### Band 1 — Today

| Card | Source | Calculation | Visible to | Action | Empty / stale |
| --- | --- | --- | --- | --- | --- |
| Calling target | `services/targets/dailyBoard.ts` (`dailyTargetProgress`) | Calls logged today against the person's target, on the workspace's clock (`dayBounds`, `todayKey`) | Anyone with a target; check-in already shows this | Open the call list | No target set → card absent, not "0 / 0" |
| Next appointment | `followUpDueWhere` kind `meeting`/`site visit`, plus appointment tasks | Soonest future item owned by the viewer | Owner; others under `leads` scope | Open the lead | None today → "Nothing booked today" with Add |
| Overdue | `followUpDueWhere` (`due`, overdue = before today began) | Count of open follow-ups past due | Own under `?view=mine`; scope otherwise | Opens the filtered list | Zero → hidden |
| Attendance | `hrAttendanceRecord` via `attendanceScope` | Checked in / out / not checked in | Self always; others per `attendanceScope` | Check in | Always shown — "Not checked in" *is* the state (existing rule, keep it) |

#### Band 2 — My priorities

One **new** service, `services/today/priorities.ts`, returning at most seven
items. Candidates and why each ranks:

| Candidate | Source | Reason shown | Rank input |
| --- | --- | --- | --- |
| SLA breach | `Lead.slaEscalatedAt` | "Not contacted within the stage's window" | Highest — a rule was already broken |
| Overdue follow-up | `followUpDueWhere` + `stateOf` | "Follow-up was due Tuesday" | Days overdue |
| Callback promised today | follow-up kind `CALL` due today | "You promised a callback at 14:00" | Time of day |
| New, untouched lead | `Lead.firstContactedAt IS NULL` | "Arrived 3 hours ago, never contacted" | Hours since arrival × source weight |
| Hot lead gone quiet | `Lead.score` + `LeadScoreHistory` | "Score 82, no activity for 6 days" | Score × idle days |
| Viewing today | `SiteVisit` | "Site visit at 17:00, no confirmation logged" | Time of day |

**Ranking must be arithmetic on recorded facts, not a model.** A model may
*phrase* the reason; the order comes from timestamps and scores. This is the
same principle the codebase already applies to talk ratio and playbook
matching — "a model returns a plausible number for both, and a manager cannot
tell a guess from a measurement after the fact" (**documented**).

Visibility: every item re-checked with `assertRecordInScope` before it renders,
so an out-of-scope record is absent exactly as a missing id would be.

Empty: "Nothing needs you right now" — and that is a real, good state, not a
failure to populate.

Stale: each item carries the timestamp it was computed from; nothing is cached,
matching the existing rule that "a dashboard showing yesterday's
pending-approval count is a dashboard nobody can act on" (**code**).

#### Band 3 — Improve today

| Card | Source | Calculation | Visible to | Action | Missing data |
| --- | --- | --- | --- | --- | --- |
| Call quality | `coachingInsights.ts` (`coachingAnalytics`), `AIAnalysis.talkRatio` | Measured talk ratio vs the workspace's reviewed average | Self; managers for their line | Open the call | Fewer than 3 analysed calls → absent |
| Objection missed | `ObjectionMatch` where `addressed` is false | The playbook card most often unaddressed in the viewer's calls | Self | Open the playbook card | No matches → absent |
| Best time to call | `Call.outcome` by hour | Connect rate by hour over 30 days, own calls | Self | Pre-filter the call list | Fewer than 20 calls → absent |

`addressed` is a heuristic and the existing UI says so. **Keep saying so here.**

#### Band 4 — Quick actions

Each priority row carries exactly one primary action, performed in place
through an existing endpoint, all of which are idempotent and already in the
offline outbox:

| Item | Action | Endpoint |
| --- | --- | --- |
| Follow-up | Complete / reschedule | the Follow-ups list's existing routes |
| Lead to call | Log call + next follow-up | `logLeadCall` (one step, as the grid row does) |
| Untouched lead | Call | `tel:` via `dialable()` — refuses a mask |
| Site visit | Confirm | the site-visit route |

### 3.4 A sales agent's Today — sample

> **Good morning, Aisha.** — My view
>
> **Today** · Target 40 calls — **12 done** · Next: site visit 17:00, Marina
> Gate · **3 overdue** · Checked in 08:42
>
> **My priorities** — 5 items
>
> | | | |
> |---|---|---|
> | 1 | **Rahul Mehta** | Not contacted within the stage's window — escalated to your manager 2h ago · **Call** |
> | 2 | **Fatima Al Suwaidi** | You promised a callback at 10:00 · **Call** |
> | 3 | **Daniel Okafor** | Arrived 09:15 from Property Finder, never contacted · **Call** |
> | 4 | **Priya Nair** | Score 82, nothing logged for 6 days · **Log call** |
> | 5 | **Marina Gate viewing, 17:00** | No confirmation logged · **Confirm** |
>
> **Improve today**
> You talked 71% of your last 8 analysed calls; the reviewed average here is
> 52%. → Open your call with Priya Nair
>
> *Payment-plan objection went unaddressed in 3 of your last 10 calls.*
> → Open the playbook card

Every line names a record and a timestamp. Nothing says "high intent" or
"ready to buy" — the AI never asserts buyer intent (§4.6).

### 3.5 A sales manager's Today — sample

> **Good morning, Omar.** — Team view
>
> **Today** · Team target 240 — **68 done** · 7 of 9 checked in · **11 leads
> unworked over 4h**
>
> **Needs your decision** — 4 items
>
> | | | |
> |---|---|---|
> | 1 | **11 leads unworked over 4h** | 8 of them are Khalid's · **Reassign** |
> | 2 | **Allocation is uneven** | Khalid 34 open, Sara 9; same rule, same shares · **Open allocation** |
> | 3 | **3 deals at risk** | Over AED 2m, no activity in 10 days · **Open the list** |
> | 4 | **Sara: 6 calls scored below 60** | Lowest on objection handling · **Open coaching** |
>
> **Improve today**
> Two agents are not checked in past the assignment cut-off, so automatic
> assignment is skipping them. → Open the roster

Sources: unworked from `firstContactedAt` within `resolveOwnerIds`; allocation
from the distribution services; at-risk from `Opportunity`/`Booking` value and
last activity; coaching from `coachingCounts`/`coachingAnalytics`; the
check-in note from `services/distribution/eligibility.ts`, which already knows
that rule.

A manager's items are **decisions**, an agent's are **conversations**. Same four
bands, different content — and the reassign action already passes through
`assertAssignableUser`, so a manager cannot hand work outside their ASSIGN
scope.

### 3.6 HR, Finance, Employee

| Role | Band 1 | Band 2 | Notes |
| --- | --- | --- | --- |
| HR | Headcount, today's absences, pending approvals | Onboarding steps due, attendance exceptions, expiring documents | Needs HRMS, except attendance exceptions which work in every workspace |
| Finance | Collected vs due this month, overdue receipts | Overdue collections by age, reconciliation exceptions, approvals waiting | `SALES_OR_REALTY` only |
| Employee | Attendance, my requests | My tasks, my documents to acknowledge | No module gate — the existing self-service grouping |

---

## 4. AI guidance from lead to close

A realistic sequence. At each step: what the AI knows, what it recommends, what
the employee does, what is recorded. **The division of labour throughout —
business rules and recorded events supply the facts; the model explains,
summarises and drafts.**

### 4.1 The lead arrives

Property Finder posts a lead at 09:15. The source's `weight` sets the starting
score; automatic assignment picks an agent by rule, skipping anyone checked
out, off-roster or past the check-in cut-off. The new owner is notified after
the commit.

A delayed check is armed at arrival, and a five-minutely `first-contact` sweep
backs it up: a lead left uncontacted past its stage's minutes tells the
manager and is re-assigned where the rule says so, once per hand-over.

*All of this exists* (**documented**). The AI adds nothing here and should not.

### 4.2 Which lead first

Arithmetic, not a model (§3.3). The AI's contribution is the sentence: "Arrived
09:15 from Property Finder, never contacted" — a phrasing of
`firstContactedAt IS NULL` and `createdAt`.

### 4.3 Preparing for the call

`leadCallContext(tenantId, leadId)` already assembles the lead, its
requirement, its interest links, matching stock (live listings and available
units of developer projects that fit, in the communities its areas name) and
the applicable playbook, and `contextPromptBlock` renders it for the model
(**code**). The live coach already consumes exactly this, so "the AI never
operates without CRM context when context exists" (**code**).

What the agent should see before dialling: a three-line brief — who they are,
what they asked for, what moved last — plus two or three matching properties
and the playbook card for their recorded objection. **Every line links to the
record it came from.**

### 4.4 During the call

What *could* appear, subject to §2: transcript lines; heuristic hints
immediately; model hints on a tick; a stage read from the conversation; a
**budget match fired once** when an amount over 100,000 is first heard — the
route deliberately checks whether the amount appeared earlier so restatements
do not nag (**code**); a playbook card cited at most once per call; and the
hint controls the QA suite lists — Ask next, Handle objection, Recommend
property, Payment plan, Closing line, Summarize customer. A suggested property
can be turned into a site-visit request from the panel.

Each hint is labelled with its source — **Gemini**, **Your playbook**, or
**heuristic** (**documented**). Keep that labelling. It is what makes the
feature honest.

### 4.5 After the call

Finalise marks the call `COMPLETED` with its duration, writes `CALL_COMPLETED`
to the audit log, and runs the claim-guarded analyse → audit chain inline, so
the workspace shows a full audit moments after hang-up without waiting for a
worker (**code**). Talk ratio is measured from the transcript. A follow-up
email can be drafted, edited and sent, with the recipient resolved on the
server and never supplied by the client; drafts are not stored.

The recommended next follow-up should be **proposed, not created**: a
pre-filled form the agent confirms. Booking a commitment with a customer is the
agent's act.

### 4.6 Stalled deals

`Lead.score` decays nightly by the workspace's rule (off unless set); idle time
is a timestamp difference. A stalled-deal card is arithmetic with a model
sentence over it.

**What the AI must never do here:** assert buyer intent, invent a promise, or
state a deal stage. "Score 82, nothing logged for 6 days" is a fact. "Ready to
close" is not, and nothing in the product should generate it.

### 4.7 Automate vs ask

| Automatic, no approval | Needs a person |
| --- | --- |
| Ranking the day | Contacting a customer (call, email, WhatsApp, SMS) |
| Surfacing reminders | Reassigning a lead |
| Drafting an email or message | Moving a critical deal stage |
| Summarising a call | Approving a financial transaction |
| Proposing a follow-up | Creating that follow-up |

Every suggestion and every execution is auditable: the house rule is already
that every write leaves an `AuditLog` row through the route's `auditEvent` or
`audit(ctx, …)`, and `tests/unit/mutation-audit.spec.ts` fails a new mutation
route that declares neither (**documented**). A suggestion the system made and
nobody took should be recorded too — that is **new**, and it is what makes
"the AI suggested X" answerable six months later.

---

## 5. Simplifying

**No usage data exists in this repository.** Every recommendation below is
therefore a **hypothesis**, in the brief's own sense, and none of it should be
executed on this evidence. The one cheap way to turn these into decisions:
`AuditLog` already records reads that leave the building (`EXPORT_REQUESTED`)
and every write, so a 30-day query over `AuditLog` by `objectType` would rank
features by actual write traffic. That is a day's work and worth doing before
anything is retired.

| Feature | Classification | Who uses it | What depends on it | Evidence |
| --- | --- | --- | --- | --- |
| Lead grid, board, saved views | **KEEP** | Agents, managers, daily | One URL → one query; export reads it too | Core |
| Follow-ups list | **KEEP** | Agents, daily | `followUpDueWhere`, five surfaces | Core |
| Call log in one step | **KEEP** | Agents, daily | Offline outbox, `logLeadCall` | Core |
| Live call workspace | **KEEP, and prove** | Agents | §2 | Built; unproven |
| Landing dashboard | **SIMPLIFY → this proposal** | Everyone | Extend, don't replace | §3 |
| The several "what should I do" surfaces | **MERGE** | Everyone | Landing, board, follow-ups, check-in target, assistant | Hypothesis: one Today screen is the answer, the others stay as the lists it links to |
| Reports (many) | **MOVE TO SECONDARY** | Managers, weekly/monthly | Scheduled emails already exist | Hypothesis: monthly reading does not belong in primary navigation |
| Practice / roleplay | **MOVE TO SECONDARY** | Agents, occasionally | Daily cap exists | Hypothesis: training, not daily work |
| Campaigns, landing pages, forms | **MOVE TO SECONDARY** | Marketing | — | Hypothesis: not an agent's day |
| Proposals, portals | **KEEP, secondary** | Senior agents | `SALES_OR_REALTY` | Low frequency, high value |
| `DialerSessionStatus.PAUSED` | **RETIRE** | Nobody | Nothing sets it | **Code-confirmed dead**: documented as "a third state to keep correct for no behaviour a shift actually needs yet" |
| Inbound call handling | **Does not exist** | — | — | Not a cleanup; a gap (`docs/DIALER.md`) |

### Before and after

**Agent dashboard.** Before: a KPI strip, then "Needs attention" as queue
counts — *"12 · Overdue follow-ups · each opens the filtered list"*. After: the
same strip, then five named people with a reason and a button each. The queue
counts stay, one line lower, as the way into the full lists.

**Lead detail.** Before: a long page with a timeline, requirement, interests,
matches, follow-ups, calls, messages. After: unchanged below, but headed by the
three-line brief from §4.3 and one primary action — **Call** — with everything
else on demand. The fix released on 12 November means a save here now reloads
the screen with a document GET, so the page is the right place to add a
primary action without fighting the router.

**Call experience.** Before: the live workspace opens in simulation by default,
with six hint controls. After: the transport named at the top in plain words —
"Simulation — no call will be placed" or "Live, via Twilio" — and the hint
controls collapsed to the two most used, the rest behind "More".

**Manager dashboard.** Before: the board, with filters, and coaching on another
screen. After: four decisions with a button each (§3.5), the board one click
away for the full picture.

### Copy and interface rules

Short, natural sentences. One primary action per screen. Details on demand. No
repeated AI-style preamble — label the source once ("Gemini", "Your playbook",
"heuristic") and never explain in a paragraph what a four-word reason conveys.
`docs/MOBILE_UI_AUDIT.md` exists and was not read for this audit; it should be
the input to the mobile pass.

---

## 6. The plan

### Phase 0 — Decide the call architecture (half a day, blocks nothing)

- **Do:** the iPhone microphone test (§2.4 step 1). Read
  `docs/MOBILE_UI_AUDIT.md`. Run the app locally and do a screen pass with an
  agent and a manager role at phone and desktop width (§1.7).
- **Dependencies:** a phone, a second phone, a local database.
- **Acceptance:** a written answer to "does the browser get the microphone
  during a cellular call on iOS?" and a list of screen-level findings.
- **Evidence:** a note in `docs/qa/`, plus the client diagnostics report from
  the phone.

### Phase 1 — The agent's Today (1–2 weeks, ships alone)

- **Do:** `services/today/priorities.ts` (the ranking, arithmetic only, with
  unit tests for the order); extend `dashboard/page.tsx` with the four bands;
  quick actions through the existing endpoints; "Improve today" with the two
  cards that need no model.
- **Dependencies:** none. **No telephony, no new integration, no migration.**
- **Effort:** one developer, 1–2 weeks.
- **Acceptance:** an agent with 5 overdue follow-ups, 2 untouched leads and 1
  SLA breach sees exactly 7 ranked items, breach first; each carries a reason
  naming a record and a timestamp; the primary action completes without leaving
  the page and works offline; a lead outside the viewer's scope never appears;
  zero items renders "Nothing needs you right now".
- **Evidence:** a test that fails on today's code; a browser check at phone and
  desktop width; the page's connection count measured by the existing
  `screen-connections.spec.ts`, which exists precisely to stop a dashboard
  exhausting the 10-connection pool.

### Phase 2 — The manager's Today (1 week)

- **Do:** the four manager cards (§3.5) on the same four bands.
- **Dependencies:** Phase 1's ranking service.
- **Acceptance:** counts match the board's for the same filters — if the Today
  card and the board disagree, the card is wrong by definition; reassign
  refuses a target outside ASSIGN scope.
- **Evidence:** a test asserting Today and board agree on one dataset.

### Phase 3 — Live coaching, proven (1 week after credentials)

- **Do:** §2.4 step 2 — expose 8090 over TLS, configure, place one real call on
  staging.
- **Dependencies:** **owner** — Twilio with Media Streams, a Gemini key, a
  decision on exposing the port.
- **Acceptance:** on a real call to a handset, a transcript segment and at
  least one hint reach the agent before hang-up; the call is linked to the
  lead; the audit appears after hang-up.
- **Evidence:** the SSE `transport: 'vendor-stream'` event, a `Transcript` row
  with `provider: 'live-stream'`, the worker log line, and a screen recording.
- **Also:** correct `docs/CONVERSATION-INTELLIGENCE.md`, which still says
  real-time coaching is out of scope.

### Phase 4 — Call preparation and AI guidance (1–2 weeks)

- **Do:** the three-line brief on the lead page from `leadCallContext`;
  proposed-not-created follow-ups; the suggestion audit trail.
- **Dependencies:** Phase 1. Independent of Phase 3.
- **Acceptance:** every brief line links to its record; no line asserts intent;
  a proposed follow-up is created only on confirmation; each suggestion and
  each execution is queryable from `AuditLog`.

### Phase 5 — Navigation and simplification (1 week, after data)

- **Do:** the 30-day `AuditLog` usage query; then move to secondary navigation
  only what that query supports; retire `PAUSED`.
- **Dependencies:** the usage query, and your decision on each.
- **Acceptance:** no feature removed without either a usage figure or your
  explicit instruction.

### Ship independently

Phases 1, 2 and 4 need no telephony. **A Twilio blocker stops Phase 3 and
nothing else.** Phase 0's microphone test can run today and changes only how
Phase 3 is scoped.

### Measuring success

| Claim | Measure | Source |
| --- | --- | --- |
| Agents know what to do next | Share of sessions whose first action is a Today priority | A new UI event, or `AuditLog` ordering |
| More due work completed | Follow-ups completed on their due day, before vs after | `followUpDueWhere` + completion timestamps |
| Faster first contact | Median hours from `createdAt` to `firstContactedAt` | `Lead` |
| Fewer SLA breaches | `slaEscalatedAt` per 100 leads | `Lead` |
| Coaching is useful while the call is live | Hints shown per call, and the share acted on | Needs a new "hint acted on" event — **not built** |

The last one needs one new event. Without it, "useful coaching" is an opinion,
and worth building in Phase 3 rather than claiming afterwards.

---

## What is not in this document

- **No screen was opened** — not on desktop, not on mobile, not with any role.
  §1.7 gives the one command that unblocks it.
- **No real call was placed**, so §2 is a reading of code and documents, and
  the live feature's status is "built, unproven" rather than "working" or
  "broken".
- **No production data was read**, so there are no usage figures and every
  classification in §5 is a hypothesis.
- **`docs/MOBILE_UI_AUDIT.md` was not read**, and it is the right input to the
  mobile part of §5.
- **The Graphify map was not used** — `graphify-out/` is absent from this
  worktree.
