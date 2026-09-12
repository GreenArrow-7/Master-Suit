# Decisions required

Business decisions the blueprint cannot make for you. Each carries a **PROPOSED —
NOT APPROVED** default so work is not blocked while it is settled, the consequence
of accepting that default, and the work packages it gates.

**Nothing in this file is company policy.** A proposal here is a starting point for
a conversation, not a rule the product has adopted.

Most of these block one package, not the plan. Only D-1 and D-8 block packages
outright; the rest have a workable default.

---

## D-1 · Customer identity model

**Question.** When the same person enquires twice, are they one customer with two
enquiries, or two independent leads?

**Why it matters.** `Lead` currently carries both the person and the enquiry.
`Contact` and `Account` exist alongside it, and `Lead.convertedContactId` /
`Lead.accountId` link them, but nothing settles which is the customer of record.
Without a decision, "who owns this customer" has no stable answer for a returning
enquirer, and ownership, history and reporting all fragment.

**Options.**

|       | Approach                                                           | Cost                                            | Consequence                                                                |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------- |
| **A** | Promote `Contact` to customer of record; every `Lead` links to one | Moderate — backfill links, dedupe existing rows | Reuses an existing model; `Contact` currently has no enquiry-side history  |
| **B** | New `Customer` entity above both                                   | Larger — new model, backfill, two link columns  | Clean separation of identity / enquiry / opportunity / booking, as §A asks |
| **C** | Leave as-is; treat repeat enquiries as separate leads              | None                                            | Returning customers stay invisible as customers; §A's objective is not met |

**PROPOSED — NOT APPROVED:** **Option B**, deferred until Track 1 is stable.
_Consequence:_ the largest migration in the plan, and it should not run while the
assignment and commitment work is still moving.

**Gates:** P2-4. **Does not gate Track 0 or Track 1.**

---

## D-2 · Lead ownership, reassignment rights, and the unassigned queue

**Questions.** Who may reassign another agent's lead? Who owns the `UNASSIGNED`
queue — a named manager, a team, or a rota? Who receives an exiting agent's book?

**PROPOSED — NOT APPROVED:**

- Reassignment requires `leads:ASSIGN` at TEAM scope or above, always with a
  reason, always recorded. _(This matches the existing permission; no change.)_
- The `UNASSIGNED` queue is owned by the team manager of the routing rule that
  failed to place the enquiry; where there is none, the sales director.
- Handover on exit goes to the exiting agent's manager, who redistributes.

_Consequence:_ on a flat team with no manager, everything lands on the director. If
that is wrong for your structure, say so — it changes P1-1's queue model.

**Gates:** P1-1, P2-3.

---

## D-3 · First-response and escalation timings

**Questions.** How long may an enquiry wait for first contact? How long may a
commitment be overdue before it escalates? Does this vary by source or by hour?

**Why it matters.** `LeadStage.slaMinutes` and `Lead.slaDueAt` already exist, so the
mechanism is there; only the numbers are missing.

**PROPOSED — NOT APPROVED:**

- First response: **15 minutes** for portal and paid-advertising enquiries during
  working hours; **4 hours** otherwise.
- Commitment escalation: overdue by **1 working day**.
- Unassigned review deadline: **30 minutes** during working hours.

_Consequence:_ aggressive first-response targets generate breach volume that the
manager queue must be able to absorb. If the team is small, start looser and tighten
— the numbers are configuration, not code.

**Also required:** the working-hours calendar and workspace timezone these depend
on. Company timezone exists in settings; whether the queues honour it is an open
**VERIFY** item.

**Gates:** P1-1 (deadline), P1-5 (escalation). Default lets both proceed.

---

## D-4 · Contact-attempt policy

**Questions.** How many `NO_ANSWER` attempts before an enquiry is treated as
uncontactable? What is the retry cadence? What happens when an agent's quota is
exhausted but enquiries keep arriving?

**PROPOSED — NOT APPROVED:**

- **5** attempts across **7 days**, then a manager exception — not automatic
  closure, because a dead lead and a badly-timed one look identical from attempt
  counts alone.
- Quota exhausted with enquiries arriving → they enter `UNASSIGNED` rather than
  overflowing onto an over-quota agent.

_Consequence:_ the second half means inflow above capacity becomes visible as a
queue rather than being absorbed silently. That is the intent, but it will look like
a new problem on day one when it is actually an existing one becoming visible.

**Gates:** P0-4 (overflow behaviour), P1-4 (attempt ceiling).

---

## D-5 · Which leave types block assignment

**Question.** Does every approved leave type make an agent ineligible, or only some?

**PROPOSED — NOT APPROVED:** all approved leave with `paid` or unpaid full-day
coverage blocks assignment for its date range; part-day leave does not.

_Consequence:_ an agent on half-day leave still receives a full day's allocation. If
that is wrong, availability needs to be fractional, which is a larger change.

**Gates:** P1-2.

---

## D-6 · `FollowUpTask` — migrate or project

**Question.** Are `FollowUpTask` rows migrated into `Task`, or does `FollowUpTask`
remain as a read projection?

**PROPOSED — NOT APPROVED:** migrate, with a dry-run count first and a reversible id
mapping.

_Consequence:_ one store, one reminder path, one definition of overdue — the point
of P1-3. Keeping both is cheaper now and re-creates the problem later.

**Amended.** The earlier draft of this decision assumed the migration would
enforce _"one open obligation per lead per kind"_. That rule is **withdrawn** —
see [`NEXT-ACTION-AND-REMINDER-CONTRACTS.md`](NEXT-ACTION-AND-REMINDER-CONTRACTS.md)
§2.1. A migration must preserve every open obligation and carry `sourceKey`
across; it must not collapse rows that share a lead and a kind.

**Gates:** P1-3.

---

## D-7 · The sales stage model

**Question.** What are the stages, and which fields are required to leave each?

**Why it matters.** `LeadStage` already supports `requiredFields`,
`allowedNextStages` and `slaMinutes`, so this is configuration, not code.

**PROPOSED — NOT APPROVED:** `New → Contacted → Qualified → Viewing → Negotiation →
Booked → Won | Lost`, with budget, location and property type required to leave
`Qualified`.

_Consequence:_ required fields at `Qualified` improve data quality and slow agents
down. Both effects are real; the balance is yours.

**Gates:** P1-4. Default lets it proceed.

---

## D-19 · Must a confirmed booking name a unit? — **ANSWERED 12 September 2026**

**Question.** Must every confirmed booking identify one specific inventory unit,
or must confirmation also support bookings without a unit — off-plan, a block
deal, a plot sale? If the latter, which booking types?

**ANSWER (client owner, 12 September 2026), verbatim:**

> "Every confirmed booking must identify one specific inventory unit."

**What was done with it.** Implemented the same day on
`claude/restructure-foundation`: confirmation refuses a booking with no unit,
takes the unit's row lock and moves it in the confirming transaction, and the
database carries both `Booking_confirmed_requires_unit` and
`Booking_one_confirmed_per_unit`. See `IMPLEMENTATION-BACKLOG.md` P0-3 and
`RELEASE-CHECKPOINT-CORRECTED.md` §3.3a and §3.4b.

**Scope of the answer.** It binds **confirmation**, not drafting — a draft may
still name only a project or a listing, which is what a draft is for. And it
says nothing about collection: **D-8 remains open and blocking** for the
collection half.

**Gates:** P0-3 (closed by this answer).

---

## D-8 · Collection and commission rules — **ANSWERED 12 September 2026, implemented on the branch**

**Owner's decisions (verbatim summary):** D-8.1 a designated finance role with `collections:CREATE` records receipts; agents cannot. D-8.2 verification needs `collections:APPROVE` and a different person; no administrator bypass; two individual accounts, never shared; the payout approval control is preserved. D-8.3 a receipt requires a positive amount, currency, actual payment date, payment reference, and an evidence document or a traceable provider/bank transaction reference; recorded, paid and verified times are separate; legacy `collectedAt` is not a receipt and is not migrated. D-8.4 partial receipts and auditable reversals; **100 % eligibility**, not proportional — net verified receipts must fully cover the agreed agency fee; pending/rejected/reversed money does not count; overpayment adds nothing; no currency mixing; unset fee is not eligible; a reversal below the fee re-evaluates unpaid commission, blocks unpaid payout execution, and opens a recovery exception for paid commission; eligibility is re-checked at payout approval and execution. D-8.5 a receipt certifies agency-fee money received by the agency only.

Implementation: `COLLECTIONS-CHECKPOINT-2026-09-12.md`. The original questions and proposal are kept below for the record.

### D-20 · May finance record or amend the agreed agency fee on a confirmed booking? — **open, surfaced by D-8**

`Booking.agencyFee` is the obligation receipts are measured against. It can only be set at `POST /api/v1/bookings`; there is no route to record it later or correct it. A confirmed booking created without one can never become eligible (correct under D-8.4), and a wrong one cannot be fixed. Amending it changes the commission base for `PERCENT_OF_AGENCY_FEE` slabs, so it is a change to the commission agreement, not bookkeeping. **Question:** which role may set or amend it after confirmation, is a second person required, and does a change re-run accrual or leave existing commission untouched? Not implemented pending the answer.

### D-8 (original, for the record)

**Questions.**

1. Who may certify that money arrived — the selling agent, or finance only?
2. Does partial receipt pro-rate commission eligibility, or block it entirely?
3. Is the trigger the buyer paying the developer, or the developer paying the
   agency? These are different payments, from different payers, on different
   schedules, and today one flag conflates them.

**Why it is blocking.** The current system cannot express _any_ answer, because it
records no amount and no separate authority — only `Booking.collectedAt`. This is a
representational gap, not a configuration gap. Until (2) and (3) are answered, the
eligibility half of P1-6 cannot be specified, let alone built.

**PROPOSED — NOT APPROVED:**

1. Finance authority only, with the maker-checker rule `payouts.ts:168,174` already
   implements — the booking's creator cannot certify its collection.
2. Pro-rate: commission eligible in proportion to the agency fee actually received.
3. The trigger is the **agency** receiving its fee, because that is what commission
   is paid from.

_Consequence:_ (2) makes commission a running calculation rather than a switch,
which is more honest and more work. (1) means a solo brokerage where the agent is
also finance must grant both roles deliberately.

**Explicitly not proposed:** any rule making collection change a unit's status.
Booking confirmation, property completion and agency collection stay three separate
events.

**Gates:** P1-6 (eligibility only — the receipt record and UI can proceed).

---

## D-9 · Role catalogue gaps

**Question.** The seeded catalogue grants `bookings:VIEW/CREATE/EDIT/DELETE` **only**
to `super_admin` and `org_admin`. No sales role — not `sales_director`, not
`branch_manager`, not `sales_rep` — can see a booking. Is that intended?

**PROPOSED — NOT APPROVED:** it is a provisioning gap. `sales_director` and
`branch_manager` should hold `bookings:VIEW` at their scope; `sales_rep` should hold
`bookings:VIEW` at OWN.

_Consequence:_ granting `bookings:EDIT` more widely is what makes the missing finance
separation (D-8) live rather than theoretical. Do P0-3 and the D-8 answer first.

Related: `finance_admin` lacks `employee:VIEW`, which is why it cannot approve
payroll. P0-2 fixes the route; whether the role should also hold `employee:VIEW` is
a separate question.

**Gates:** P1-6 visibility.

---

## D-10 · Activity verification and monitoring policy

**Question.** What counts as evidence that an agent worked a lead? How much
monitoring is acceptable?

**PROPOSED — NOT APPROVED:** business outcomes only — contact attempts with
outcomes, viewings with feedback, commitments met. **Not** login duration, screen
time, or raw call counts.

_Consequence:_ managers lose a familiar number and gain harder-to-game ones. Site
visits already carry geofenced punches and plausibility flags
(`SiteVisit.locationSuspect`); those are verification of a specific claim, not
general surveillance, and the blueprint keeps them in that narrower role.

**Gates:** P1-5, P2-7.

---

## D-11 · Market, focus, and scale

**Questions.** Which market and currency? Brokerage, developer sales, or both?
Team structure and expected scale? Which integration channels are enabled?

**Why it matters.** The code defaults to AED and a UAE-shaped HR model (WPS,
labour cards, Emirates ID). Multi-currency reporting is deliberately one-currency
per report with the minority excluded and named. Scale affects whether the
`UNASSIGNED` queue is a rota or a person.

**PROPOSED — NOT APPROVED:** single market, AED, brokerage-first, teams of 5–15
under a manager, with Meta lead ads and web forms enabled and telephony/WhatsApp
behind per-workspace configuration.

_Consequence:_ if a second currency is genuinely in scope, the owner reporting
package (P2-2) grows substantially, because one-currency-per-report stops being
sufficient.

**Gates:** nothing directly; shapes P2-2 and the HR packages.

---

## D-12 · Brand palette — keep blue/cyan, or move to teal/gold?

**Question.** The restructuring brief proposes a teal (`#176B63`) primary with a
gold (`#B49A76`) accent. The application already has a documented brand system in
`apps/web/src/styles/tokens.css`: brand blue (`#2455E6`) primary, cyan
(`#00D9F5`) reserved for AI surfaces and the nav indicator, midnight sidebar.

**What was measured.** Both palettes meet WCAG AA on every text pair that carries
text. The current palette fails on one token, `--yh-text-muted` at 2.90:1, which
is a defect to repair either way. The proposed palette fails only on the
decorative accent used as text, which the brief already says is decorative. See
`DESIGN-SYSTEM-ASSESSMENT.md` for the full table.

**Why it is a decision and not a task.** The token file states a colour budget and
attaches meaning to cyan ("AI"), and names youhan.in as the parent brand. Changing
hue families discards both. That is a brand call, not an engineering one.

**PROPOSED — NOT APPROVED:** keep the existing blue/cyan brand; adopt every
_comfort_ requirement from the brief (type sizes, contrast repair, focus, reduced
motion, density) inside it.

_Consequence:_ the product stays visually consistent with youhan.in and the AI
surfaces keep their signal. If teal/gold is genuinely wanted it stays cheap to do
later — the `--lf-*` alias layer means it is an edit to one `--yh-*` block rather
than to ~400 call sites — so deferring costs nothing.

**Gates:** nothing. The comfort work proceeds either way.

---

## D-13 · Whose obligations set a lead's `nextFollowUpAt`?

**Question.** `Lead.nextFollowUpAt` is specified in
[`NEXT-ACTION-AND-REMINDER-CONTRACTS.md`](NEXT-ACTION-AND-REMINDER-CONTRACTS.md)
§2.6 as the earliest due obligation on that lead **across every owner**. The
alternative is the earliest among the lead owner's own obligations.

**PROPOSED — NOT APPROVED:** owner-independent **for the stored column**, with
"your next action" computed per viewer at read time and never stored.

_Consequence:_ the Overdue queue means "this lead is waiting on us" rather than
"the owner is behind". Both are legitimate reports and they are not the same
report — a lead with a rep's callback due Thursday and a manager's review due
Tuesday reads as Tuesday lead-wide and Thursday for the rep. **Rendering one
number in both places tells the rep they are late for something that is not
theirs**, which is what the amended contract now forbids. The six existing read
sites split accordingly.

**Note.** The column currently has **no writer anywhere in application code**.
Six Sales surfaces read it — the Overdue filter, the sortable grid column, the
lead-detail flag, the sales overdue count, the built-in Overdue smart view and
the leadership exception queue — and only seed and tests write it. Whichever way
this is answered, all six are reading a stale column today.

**Gates:** the `nextFollowUpAt` derivation task; indirectly P1-3.

---

## D-14 · Does a lead with nothing open leave every follow-up surface?

**Question.** Under the contract, completing the last open obligation sets
`nextFollowUpAt` to `NULL` and the lead disappears from every Overdue surface.
Is that correct, or should a lead stay visible until somebody explicitly closes
it out?

**PROPOSED — NOT APPROVED:** yes, it leaves.

_Consequence:_ "overdue" means "something is owed and late", which is what the
word says. If a lead should remain visible after its last task closes, that is a
state on the _lead_ — a disposition — and not a lingering timestamp. Encoding it
as a never-cleared `nextFollowUpAt` would make the column mean two things.

**Gates:** the `nextFollowUpAt` derivation task.

---

## D-15 · How long are delivered reminders retained?

**Question.** A delivered reminder is the evidence that a person was told. Does
it follow the notification retention window or the audit one?

**PROPOSED — NOT APPROVED:** the audit window.

_Consequence:_ "was the rep reminded before the SLA breach?" stays answerable
for as long as the breach itself does. Under the notification window the
evidence expires before the thing it is evidence for.

**Gates:** P1-4 (reminder reliability).

---

## D-16 · How long is a request key honoured?

**Question.** A create carries a `requestKey` so retries are safe
([contracts](NEXT-ACTION-AND-REMINDER-CONTRACTS.md) §2.2). A replay of that key
a year later is almost certainly a new intention rather than a retry. How long
is a key honoured, and what happens past the window?

**PROPOSED — NOT APPROVED:** 24 hours. Past it, the key is unknown and the
create proceeds as new.

_Consequence:_ retries, offline replays and double-submits are all comfortably
inside a day, and a stale key cannot suppress a genuine commitment months later.
The risk of the alternative — honouring forever — is that a client which reuses
keys across sessions silently stops creating obligations, and that failure is
invisible: the API returns success every time.

**Gates:** the `requestKey` task (contracts §4, New — D).

---

## D-17 · Which channels count as having reminded somebody?

**Question.** The contract treats in-app as the channel of record, because it is
the only one with no provider between the system and the person
([contracts](NEXT-ACTION-AND-REMINDER-CONTRACTS.md) §3.5). Is an email that was
accepted by the relay but never opened sufficient notice for SLA purposes?

**PROPOSED — NOT APPROVED:** in-app is the channel of record; email and push are
best-effort and are never the basis for "they were told".

_Consequence:_ SLA measurement rests on the one channel that commits in the same
database as the reminder. Treating an accepted email as notice would make the
SLA depend on a provider acknowledgement that does not mean a person saw
anything — and it cannot be promised as exactly-once in any case.

**Gates:** P1-4; any SLA report that says "reminded".

---

## How to use this file

1. Answer **D-8** and **D-1** first — they are the two that block work outright.
2. Accept or amend the defaults for D-2 through D-7; each has a workable default,
   so Track 0 and most of Track 1 can start immediately.
3. D-9 through D-11 can follow, but D-9 should be settled before booking
   permissions are widened.
4. D-13 through D-17 gate the next-action and reminder work. D-13 and D-17 are
   the two that change what a report means; the rest have defaults that are
   safe to run with.

Track 0 (security and reliability) depends on **none** of these and can begin as
soon as implementation is approved.

---

## D-18 · May someone see *that* a lead has work on it without seeing *whose* or *when*?

**Raised by** the next-follow-up derivation, 2026-09-11. **Answer needed before
the derivation is enabled for a workspace with divergent role scopes.**

The product direction asked for "no action assigned to you" and "no action
scheduled for this lead" to read differently — and they now do, as **"Not
yours"** and **"No next action"**.

Telling them apart requires knowing whether *anything* is open on the lead,
which is a fact about obligations the viewer may not be able to see. The
implementation discloses the **existence** of work and nothing else: no date, no
owner, no title, no count. It reads the stored aggregate as a boolean and the
date never leaves the derivation.

**The line I drew, and it is a judgement rather than a deduction:** existence of
work is a lead-level fact and travels with lead visibility; timing and identity
are obligation-level and do not.

What that means in practice for the two roles in §3.1 of the checkpoint: a
Marketing Manager, who holds every lead and no `tasks` grant, sees which leads
somebody is working without learning who or when. If that is too much, the
alternative is to render both cases as "No next action" — strictly less
disclosive, and it gives up the distinction the direction asked for.

- **Keep the distinction** (implemented) — "Not yours" where work exists.
- **Collapse it** — one "No next action" for both, at the cost of a lead nobody
  is working looking identical to one somebody else is.

This is a one-line change either way; it is flagged because it is a disclosure
decision, not a technical one.

