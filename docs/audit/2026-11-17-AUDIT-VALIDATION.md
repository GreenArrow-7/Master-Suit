# YOUHAN ONE — audit validation, and the first proposed change

**Date:** 17 November 2026 · **Read-only.** No application code, navigation,
permission or configuration was changed. Two documents in `docs/audit/` are the
only files added.
**Out of scope:** ONE AI and Live Coaching, tracked separately.
**Companion:** [`2026-11-17-PRODUCT-UI-AUDIT.md`](2026-11-17-PRODUCT-UI-AUDIT.md),
which this validates and in three places **corrects**.

---

# The top three observed UX problems

### 1. One page wears eight names, in three different places

`/sales/leadership` is reached from **eight separate sidebar tabs** across
**three sections**, each with a different `?view=`:

| Section › Area › Tab | URL |
|---|---|
| Home › My Workspace › **Team Work** | `/sales/leadership?view=chasing` |
| Home › My Workspace › **Business Overview** | `/sales/leadership` |
| CRM › Daily Activity › **Today** | `/sales/leadership?view=daily` |
| Insights › Reports › **Value** | `/sales/leadership?view=value` |
| Insights › Reports › **Productivity** | `/sales/leadership?view=productivity` |
| Insights › Reports › **Team Activity** | `/sales/leadership?view=compliance` |
| Insights › Reports › **Activity Feed** | `/sales/leadership?view=feed` |
| Insights › Reports › **Finance** | `/sales/leadership?view=pl` |

Eight entries a user must learn separately, for one screen that already has a
view switcher. "Today" and "Team Work" and "Business Overview" sit in **Home**;
five siblings sit in **Insights**. Nothing tells the user they are the same
place. This was **not in the first report** — executing the navigation model
found it; reading the source did not.

### 2. A Sales + Real Estate workspace gets 9 sections and 111 tabs, with two full lead workflows over one dataset

Rendered from the real navigation model, with every permission granted:

| Entitlement | Sections | Tabs |
|---|---|---|
| Sales only | 8 | 86 |
| Real Estate only | 5 | 52 |
| Lead Eagle only | 5 | 47 |
| **Sales + Real Estate** | **9** | **111** |

At 111 tabs the user sees **CRM › Leads** (All Leads, My Leads, Unassigned,
Saved Views, QR Capture, Cold Data) *and* **Real Estate › Leads** (Leads,
Follow-ups, Tasks, Calls, Playbook, Site Visits, Requirements, Proposals,
Allocation, QR Capture, Cold Data) — two routes into the same `Lead` rows, named
differently, in different sections. Confirmed: **Lead Eagle correctly hides
itself** behind `unlessModule: [SALES, REAL_ESTATE]`; CRM carries no such guard.

### 3. Settings is a 20-tab strip containing two tabs both labelled "Teams"

**Correction to the first report.** Settings has **20 tabs for Sales**, not 15,
and the duplicated label is **"Teams", not "Automation"**:

```
Users  ->  /demo/admin/users
Teams  ->  /demo/admin/teams          <- 
Roles  ->  /demo/admin/roles
Teams  ->  /demo/sales/people         <- same word, different screen
```

Two adjacent-ish entries with an identical label and different destinations.
A user cannot tell which one they want, and one of them is wrong every time.

---

# The first proposed change

**A navigation-model-only PR. One file, no page code, no permission change, no
URL removed.**

| | |
|---|---|
| **File** | `apps/web/src/lib/nav/workspaceNav.ts` |
| **Result** | Sales + Real Estate goes from **9 sections / 111 tabs → 7 / ~84**, a 24% reduction, with **every current URL still reachable and still bookmarkable** |
| **Why first** | Smallest diff with the largest felt effect; fully covered by existing tests; reversible in one revert; needs no component work and no design decisions from you beyond approving the three groupings |

It does three things:

1. **Collapse the leadership fan-out** — one "Performance" tab opening
   `/sales/leadership`, whose own view switcher carries the other seven. Removes
   7 tabs and the Home/Insights split.
2. **One lead section per workspace** — give CRM the `unlessModule: [REAL_ESTATE]`
   guard Lead Eagle already proves works. A Sales+RE workspace sees **Real
   Estate**; a Sales-only workspace is unchanged.
3. **Rename the second "Teams"** to what the screen actually is, and group the
   20 Settings tabs into four (Lead work · People & access · Integrations ·
   Company & data).

**It does not** delete a route, change a permission token, touch a page, or
change what any role may open. Hiding a tab is presentation only — the file
states this and `tests/permission/page-access.spec.ts` enforces it server-side.

---

# How this was validated

## Environment

| | |
|---|---|
| Branch / commit | `feat/live-coaching-first-call` @ `6d8de9c1` |
| Build served | **production bundle**, `.next-prod` BUILD_ID `TcOJFkBVUOgxRGut9IWr9`, built 16 Nov 2026 23:40 |
| Server | `npm run start:local` → `http://localhost:3101` (ports 3000 and 3100 are reserved on this machine) |
| Database | local isolated Docker — `master-saas-postgres-1` on 127.0.0.1:5432, `master-saas-redis-1` on 6379. **No staging, no production, no SSH.** |
| Health | `/api/health` → `{"status":"ok","checks":{"database":"up","redis":"up"}}` |
| Viewports | 375×812, 768×1024, 1024×768 |

`minio` and `mailpit` could not be pulled (`pull access denied`), so uploads and
email were out of reach. Neither affects navigation or layout.

## What I could and could not do

**I could not sign in, so the role walkthrough did not happen.** The demo
password committed in `scripts/mobile-audit.mjs` (`ManathDemo-2026`) no longer
works: `prisma/seed/index.ts` now **generates it per run and prints it once,
never committing it** — a deliberate fix, recorded in the file, for every
install having shared one published password. The sign-in attempt returned
*"That email and password combination did not work."* I stopped there rather
than guessing, because `MAX_FAILED_LOGINS` locks the account.

So **item 1 of your brief is not done**: no Sales Agent, Sales Manager or
Organization Admin walkthrough, no workspace home, lead list, lead detail,
follow-ups or Settings screens, no HR or Finance views. What I need is at the
bottom of this document.

**What I did instead, which is stronger evidence for items 2 and 3:** I executed
the real navigation model (`buildNavigation` from `workspaceNav.ts`) under tsx
with every permission granted, for five entitlement combinations, and printed
every section, area, tab and URL. Clicking shows one path at a time; this shows
all of them, exhaustively, including the combinations this machine has no
workspace for.

## Item 2 — duplication, verified

**Confirmed:** a Sales + Real Estate workspace renders two complete lead
sections over the same records (table above).

**Confirmed:** Lead Eagle is the correct model — `unlessModule: [SALES,
REAL_ESTATE]`, and a Lead-Eagle-only workspace renders 5 sections / 47 tabs with
**zero** duplicate destinations.

**Corrected — the duplication is softer than I first reported.** With full URLs
compared including query strings, **no two navigation entries point at the same
address**. Every apparent duplicate is a distinct view:

| Looks duplicated | Actually | Verdict |
|---|---|---|
| All Leads / My Leads / Unassigned | `/sales/leads`, `?filter=mine`, `?filter=unassigned` | **Distinct. Keep.** Standard saved-filter pattern |
| Client Profiles / Testimonials / Referrals | `/sales/clients` + three `?view=` | **Distinct views, one screen.** Consolidate to one tab |
| Commissions / Payout Runs | `/sales/commissions` + `?view=` | **Distinct. Keep** |
| Projects / Off-Plan | `/realty/projects` + `?filter=` | **Distinct. Keep** |
| The eight leadership tabs | eight `?view=` on one route | **Distinct views, one screen.** Consolidate — problem 1 |

**So my first report's "eight double entry points" item was wrong** in how it
read. `people/users` and `admin/users` *are* two routes, but they are two
thin wrappers over one implementation serving two different module contexts,
which the code documents as deliberate (navigating to `/admin/users` from the HR
sidebar would leave the HR module). They are **not** two sidebar rows for one
screen, and they should be left alone. Downgrade: **Merge → Keep.**

**Also found, not previously reported:** a workspace with only Real Estate, or
only Lead Eagle, still renders a one-tab **CRM › Activities › My Tasks** section.
A stray Sales tab in a non-Sales workspace. Small, and worth a line in the PR.

**Corrected:** "Automation listed twice" was wrong — an artefact of my grep
matching Sales' and Lead Eagle's separate entries. The real duplicate label is
**Teams** (problem 3).

## Item 3 — 30-day usage analysis: **not available**

Not run, and I do not recommend forcing it:

- **Production `AuditLog` is unreachable.** Claude cannot SSH to production, by
  your standing rule. No read-only analytics endpoint exists that reaches it.
- **The local database holds seed data only.** Counting `AuditLog` there would
  measure a fixture, not a user. Reporting that as usage would be worse than
  reporting nothing.

**Consequence, as you instructed:** every uncertain feature **stays under
INVESTIGATE** — Contacts / Accounts / Opportunities, the lead board, and
Campaigns + dialer are unchanged in status and nothing is proposed for removal
on usage grounds. The three navigation changes above rest on structure, not
usage, which is why they can proceed without this.

## Item 1, partial — what the browser did show

The two screens reachable signed-out were checked at three widths.

**Sign-in, 375×812 — good, and genuinely designed for the phone.** Horizontal
overflow **0px**. The hero reduces from eight hub nodes to four, the headline
goes to one line, the card stacks full-width with 44px targets. This is not a
compressed desktop layout.

**Sign-in, 768×1024 — the tablet dead zone, visible.** Overflow is **0px** here,
but the page renders the *phone* composition at tablet size: the hero collapses
to a short centred band, the card sits mid-viewport, and roughly the lower third
is empty. It is neither the two-column desktop layout nor the phone one. This
matches `docs/MOBILE_UI_AUDIT.md`, a prior **runtime** audit I had not found when
writing the first report — 29 routes × 10 widths, which measured **22 of 29
routes overflowing at 768px** and **0 at 360–430px**, because every mobile rule
is gated `≤760px` and nothing designs 761–1023.

**That materially re-ranks the first report.** The phone is not where the layout
problem is; **the tablet is.** `MOBILE_UI_AUDIT.md` also names two things worth
more than anything I found statically:

- `.lf-table { min-width: 720px }` inside hand-rolled
  `<div class="lf-card" style="overflow:hidden">` wrappers on ~12 screens —
  **columns are silently clipped and unreachable**, a functional defect, not a
  cosmetic one.
- The `≤760px` table→card transform **produces no card** — rows become blocks
  separated by hairlines, with no surface, border or radius. That is the origin
  of the "squared" look, named by measurement rather than by taste.

**One thing I checked and will not report as a bug.** The sign-in card looks
washed out in the 768px screenshot. Computed style says otherwise —
`background: rgb(255,255,255)`, `color: rgb(17,24,39)`, `opacity: 1`. It is a
capture artefact of the `lfAuthRise` entry animation, not a contrast failure.

**Developer-experience note, not user-facing:** `npm run dev` enters a Fast
Refresh loop on this tree — `GET /login 200` roughly every 100 ms, forever, with
`[Fast Refresh] rebuilding` on repeat, which clears form state on every keystroke.
The production bundle is unaffected. Worth a look by whoever owns tooling.

---

# Item 4 — the first redesign slice

Scoped to three surfaces, as asked. **Proposals only. Nothing built.**

## Start from what already exists

`feat/agent-today-pilot` already implements the pattern, and its change entry is
the best design document in the repository: *"a ranked day instead of a backlog
count"* — at most seven of the viewer's own records, each with **the fact that
put it there** and **one action**, bands that do not overlap (SLA breach →
overdue promise → promise due today → never contacted → quiet warm lead), ties
broken by longest wait. **The order is arithmetic on recorded facts; no model
chooses anything.** Nothing on the screen writes; every action links to the
screen that already does the job, with its own permission check and its own
place in the offline outbox.

It was walked on a real 375px screen and that walk found three defects review had
missed — including an action button rendering off the side of the viewport, and a
representative at OWN scope reading a colleague's lead by name. **That is the
standard the rest of the redesign should be held to**, and it is the argument for
doing the walkthrough properly rather than designing from source.

### Agent Today — proposed

```
How am I doing?     3 figures, one row, tabular:
                    calls today / target · follow-ups cleared · leads worked

My priorities       <- the pilot, unchanged in substance
  [band]  Lead name                              [ one action ]
          the fact that put it here (wraps to its own line)
          ... up to 7

What's next         next 3 follow-ups by due time, one tap each
```

Everything else on today's landing page moves below the fold or into Reports.
**No tile grid.** Manager Today **stays on hold** until you have reviewed this.

**Copy to shorten, concretely.** Page descriptions run 150–210 characters in a
header subtitle. Current → proposed, with the detail moved into the existing
`.lf-help` disclosure (already built, already keyboard-reachable, 24 uses):

> *"Every lead that arrived has found an owner. When one cannot be placed
> automatically — no rule, nobody eligible, everyone at capacity — it appears
> here with the reason."* (185 chars)
>
> → **"Leads that could not be placed automatically."** (46) — the rest behind
> *Why a lead lands here*.

> *"Every work credential expiring soon — visa, Emirates ID, passport, labour
> card and RERA broker card — worst first. A lapsed credential can stop someone
> working or selling."* (189)
>
> → **"Work credentials expiring soon, worst first."** (45)

## Lead detail — proposed

- **Content hierarchy inverts.** Today the page leads with identity. Lead with
  **the next action and when it is due**, then stage, then identity.
- **One column on a phone**, in this order: next action · stage · contact
  actions · timeline. Requirement, interest links, custom fields and matched
  stock go behind disclosures — present, not deleted.
- **Retain** every action, filter and field. This slice removes nothing.

## Sidebar — proposed

7 sections for a Sales + Real Estate workspace, ~84 tabs: **Home · Leads ·
Inventory · Marketing · Finance · Insights · Administration**, plus Account.
One lead section. One Performance tab. Four settings groups.

## The smallest component set these three screens actually need

Not the thirteen the first report listed — **six**:

| Component | Replaces | Evidence |
|---|---|---|
| `PageLayout` | hand-rolled page stacks | ~900 inline margin/padding declarations |
| `PageHeader` | 3 competing header patterns | used on **21 of 213** screens; 45 use `<h1 className="lf-h1">` |
| `Card` | `.lf-card` + inline props | the Appearance screen builds one from 8 inline style props |
| `Button` | `lf-btn` as a string | typed **1,408 times across 195 files**; one stray `lf-button--ghost` |
| `Stat` | inline figure rows | the three "How am I doing?" figures |
| `PriorityRow` | — | already exists as `MyPriorities.tsx` on the pilot branch |

`Table`, `Modal`, `Tabs`, `Toast`, `Input`, `Select` and `Field` are **deferred**
— these three screens do not need them, and `Table` should not be designed until
the 768px and clipped-column findings above are understood.

---

# Item 5 — the first implementation PR

**Title:** `refactor(nav): one lead section, one performance tab, grouped settings`

**Scope — one file:** `apps/web/src/lib/nav/workspaceNav.ts`. No page, no
component, no CSS, no permission token, no route added or removed.

**Acceptance criteria**

1. A **Sales + Real Estate** workspace renders **7 sections** and **no more than
   86 tabs** (from 9 / 111).
2. A **Sales-only** workspace is **byte-identical** to today: 8 sections, 86 tabs.
3. **Lead Eagle-only** and **Real Estate-only** are unchanged but for the stray
   `CRM › Activities › My Tasks` tab, which is gone.
4. `/sales/leadership` is reachable from **exactly one** tab. All eight
   `?view=` URLs still resolve and still render their view.
5. **No two tabs share a label** within one area. The second "Teams" is renamed
   to the screen it opens.
6. Settings renders **four groups**; every one of the 20 destinations is still
   reachable in at most two clicks.
7. **Every URL that works today still works**, query strings included — a new
   unit test asserts the full set of `href`s before and after, as a snapshot.
8. `tests/permission/page-access.spec.ts`, `tests/unit/realty-routes.spec.ts`,
   `tests/unit/lead-eagle-routes.spec.ts` pass unchanged.
9. `npx tsc --noEmit`, `npm run lint`, `npm run format:check` clean.
10. Checked in a browser at 375, 768 and 1280 — once sign-in is possible.
11. A `changes/` entry in the same PR, per `CLAUDE.md`.

**Explicitly not in this PR:** component extraction, copy changes, CSS, the
Agent Today layout, Manager Today, any feature removal.

---

# What I need from you

1. **A sign-in for the local seeded workspace** — the `DEMO_PASSWORD` the seed
   printed, or your go-ahead to re-seed the local database with a pinned one.
   Re-seeding is destructive to local data, so I will not do it unasked. Without
   this, item 1 stays undone.
2. **Approval of the three navigation groupings** in the first PR — the merged
   lead section, the single Performance tab, the four settings groups.
3. **Confirmation that production usage telemetry is genuinely out of reach**, or
   a read-only route to it. Until then the three INVESTIGATE features stay as
   they are.

---

# Status

| | |
|---|---|
| **Completed** | Local isolated environment stood up and verified healthy. Navigation model executed across 5 entitlement combinations — every section, area, tab and URL enumerated. Duplication claims verified and **three first-report findings corrected**. Sign-in screen checked at 375 / 768 / 1024. Agent Today pilot and the prior runtime mobile audit read and reconciled. First redesign slice and first PR scoped with acceptance criteria. |
| **Verified and where** | `buildNavigation` executed from `apps/web` via tsx — Sales 8/86, RE 5/52, LE 5/47, Sales+RE **9/111**; `/sales/leadership` reached from 8 tabs in 3 sections; Settings 20 tabs with "Teams" twice; zero identical-URL duplicates. Browser at `localhost:3101` on production bundle `TcOJFkBVUOgxRGut9IWr9` — sign-in 0px overflow at 375 and 768, computed card contrast correct. `/api/health` database and redis up. |
| **Report / branch / commit / PR** | `docs/audit/2026-11-17-PRODUCT-UI-AUDIT.md` and `docs/audit/2026-11-17-AUDIT-VALIDATION.md`, untracked on `feat/live-coaching-first-call` @ `6d8de9c1`. **No commit, no branch, no PR for this work.** |
| **Deployment status** | **Nothing deployed.** No staging, no production, no SSH, no configuration touched. A local dev server is still running on `localhost:3101`; say the word and I will stop it. |
| **Pending** | The role walkthrough (Sales Agent, Sales Manager, Organization Admin; workspace home, lead list and detail, follow-ups, Settings; HR and Finance). The 30-day usage analysis. Annotated before/after screenshots for the three redesign surfaces. |
| **Blocker and owner** | **Local sign-in credentials — owner.** The committed demo password is stale by design; the seed now generates and prints it once. **Production usage telemetry — owner**, unreachable by standing rule. |
| **Next action** | Send the local `DEMO_PASSWORD`, or approve a local re-seed. I then complete the walkthrough, attach real before/after screenshots for Agent Today, lead detail and the sidebar, and hold for your approval before any code. |
