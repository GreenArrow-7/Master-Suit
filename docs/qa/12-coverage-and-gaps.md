# Section 12 — Coverage analysis and gaps requiring verification

## 12.1 The honest headline

**Nothing in this suite has been executed.** It was written by reading the
repository at commit `1b8226f9` on 6 November 2026. Every **Expected Result** is
what the code says should happen; every **Actual Result** and **Test Status** is
blank, and every status is **Not Run**.

That is the correct state for a test suite on delivery, but it must not be
mistaken for a report. Until a tester runs it, the suite says nothing about
whether the application works.

## 12.2 What the suite contains

|                                                 | Count             |
| ----------------------------------------------- | ----------------- |
| Test cases with full steps and expected results | **130**           |
| — Platform administration (`PLAT`)              | 13                |
| — Company administration (`ADMIN`)              | 16                |
| — Sales CRM (`SALES`)                           | 22                |
| — People / HRMS (`HR`)                          | 15                |
| — Real Estate (`RE`)                            | 12                |
| — Lead Eagle (`LE`)                             | 8                 |
| — Public (`PUB`)                                | 8                 |
| — Negative / boundary / failure (`NEG`)         | 13                |
| — Multi-tenant and authorization (`TEN`)        | 15                |
| — End-to-end workflows (`E2E`)                  | 8                 |
| Smoke items                                     | 65                |
| Regression rows                                 | 104               |
| UAT acceptance items                            | 45, plus 12 gates |
| Negative scenarios inside the cases             | roughly 420       |

Each case names its module, role, feature, scenario, priority, preconditions,
test data, navigation path, numbered steps, expected results, negative
scenarios, required evidence and code references, with blank columns for the
tester.

## 12.3 Coverage against the inventory

Checked row by row against [01](01-inventory.md) §1.7.

| Area                                                                   | Covered by                                                                                                         | Depth                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Sign-in, MFA, recovery codes, reset, invitation                        | `PLAT-AUTH-001`, `ADMIN-AUTH-001`, `LE-AUTH-001`, `PUB-RESET-001`, `PUB-INVITE-001`, `PUB-2FA-001`, `NEG-SESS-001` | Full                                              |
| Leads: create, read, edit, list, search, saved views                   | `SALES-LEAD-001` … `003`, `011`, `SALES-NAV-004`                                                                   | Full                                              |
| Lead import and export                                                 | `SALES-LEAD-014`, `SALES-EXP-001`, `NEG-SCALE-001`                                                                 | Full                                              |
| Deduplication                                                          | `SALES-LEAD-013`                                                                                                   | Full                                              |
| Allocation, quotas, languages, shifts, rotation, waiting queue         | `SALES-ALLOC-001`                                                                                                  | Full                                              |
| Recycling, score decay, triage                                         | **Partial** — covered only as scheduled jobs in `NEG-JOB-001`                                                      |
| Ownership, transfers                                                   | `SALES-LEAD-011`, `TEN-SCOPE-002`, `ADMIN-USER-002`                                                                | Full                                              |
| Contacts, accounts, opportunities, client profiles                     | `SALES-RO-002`, `NEG-VAL-001`, smoke                                                                               | **Partial** — no dedicated create/edit case each  |
| Tasks, reminders, follow-ups                                           | `SALES-FU-001`                                                                                                     | Full                                              |
| Calls, consent, outcomes, recordings, transcripts                      | `SALES-CALL-001`, `002`                                                                                            | Full                                              |
| Live AI transcription and coaching                                     | `SALES-CALL-003`                                                                                                   | Full (needs credentials)                          |
| Post-call AI, scorecards, failure handling                             | `SALES-AI-001`, `NEG-AI-001`                                                                                       | Full (needs credentials)                          |
| Campaigns, dialer                                                      | `SALES-CAMP-001`                                                                                                   | **Partial**                                       |
| Inbox / conversations / WhatsApp                                       | —                                                                                                                  | **Not covered** (needs credentials)               |
| Web forms, landing pages, QR capture, social sources                   | `PUB-FORM-001`, `PUB-LAND-001`, `PUB-QR-001`                                                                       | Full except social sources                        |
| Dashboards and Daily Activity                                          | `SALES-DAILY-001`, `SALES-QA-005`                                                                                  | Full                                              |
| Team and agent performance reports                                     | `HR-REP-001`, `E2E-CALL-003` stage 15                                                                              | **Partial**                                       |
| Cold data                                                              | `SALES-COLD-001`                                                                                                   | Full                                              |
| Service tickets, SLA                                                   | —                                                                                                                  | **Not covered**                                   |
| Properties, projects, listings, portals                                | `RE-PROP-001`                                                                                                      | Full except portal publishing (needs credentials) |
| Requirements, proposals, shared shortlists                             | `RE-REQ-001`                                                                                                       | Full                                              |
| Site visits, QR passes                                                 | `RE-VISIT-001`                                                                                                     | Full                                              |
| Bookings                                                               | `RE-BOOK-001`                                                                                                      | Full, with a navigation gap — see 12.4            |
| Collections, recovery                                                  | `RE-COLL-001`, `RE-RECOV-001`                                                                                      | Full                                              |
| Commissions, plans, payouts                                            | `RE-COMM-001`, `NEG-MONEY-001`                                                                                     | Full                                              |
| Agency fee                                                             | `RE-FEE-003`                                                                                                       | Full                                              |
| Events, RSVP                                                           | `RE-EVENT-001`                                                                                                     | Full                                              |
| Testimonials, referrals                                                | `RE-TEST-001`                                                                                                      | **Partial**                                       |
| Employees, lifecycle, onboarding, offboarding, compliance, departments | `HR-EMP-001`                                                                                                       | Full                                              |
| Attendance, check-in, geofence                                         | `HR-CHECKIN-001`, `HR-ATT-001`, `HR-NOHRMS-001`                                                                    | Full                                              |
| Face check-in                                                          | `HR-CHECKIN-002`                                                                                                   | Full (needs credentials)                          |
| Shifts, rosters, holidays, exceptions, overtime                        | `HR-SHIFT-001`, `HR-ATT-001`                                                                                       | Full                                              |
| Leave                                                                  | `HR-LEAVE-001`, `007`, `008`                                                                                       | Full                                              |
| Payroll, payslips, WPS                                                 | `HR-PAY-001`, `008`, `E2E-HR-004`                                                                                  | Full                                              |
| Recruitment                                                            | `HR-REC-001`                                                                                                       | **Partial**                                       |
| Performance                                                            | `HR-PERF-001`                                                                                                      | **Partial**                                       |
| HR documents, HR reports                                               | `HR-REP-001`, `TEN-FIELD-003`                                                                                      | **Partial**                                       |
| Lead Eagle, all areas                                                  | `LE-SETUP-001` … `LE-MOVE-001`                                                                                     | Full                                              |
| Users: invite, create, deactivate, remove, hand over, reset            | `ADMIN-USER-001`, `002`                                                                                            | Full                                              |
| Roles: create, clone, grants, assign, history                          | `ADMIN-ROLE-001` … `004`, `009`                                                                                    | Full                                              |
| Field permissions and masking                                          | `ADMIN-FIELD-001`, `TEN-FIELD-001` … `005`                                                                         | Full                                              |
| Data scopes                                                            | `TEN-SCOPE-001` … `006`, `SALES-SCOPE-004`, `HR-SCOPE-003`, `ADMIN-TEAM-001`                                       | Full                                              |
| Integrations                                                           | `ADMIN-INT-001`, `NEG-WEBHOOK-001`                                                                                 | Full (each provider needs its own credentials)    |
| Audit log and retention                                                | `ADMIN-AUD-001`, `004`, `ADMIN-RET-001`                                                                            | Full                                              |
| Workspace provisioning, plans, subscriptions, entitlement              | `PLAT-WS-001`, `002`, `PLAT-PLAN-001`, `PLAT-SUB-001`, `TEN-ENT-001`, `NEG-ENT-001`, `E2E-CANCEL-008`              | Full                                              |
| Break-glass grants                                                     | `PLAT-BG-001`, `002`, `PLAT-AUDIT-001`                                                                             | Full                                              |
| AI usage and cost control                                              | `PLAT-AI-001`                                                                                                      | Full                                              |
| System health and metrics                                              | `PLAT-HEALTH-001`                                                                                                  | Full                                              |
| Background queues and schedules                                        | `NEG-JOB-001`                                                                                                      | Full                                              |
| Row-level security                                                     | `TEN-RLS-001`                                                                                                      | Partial by necessity — see 12.6                   |
| Mobile apps                                                            | —                                                                                                                  | **Not covered** — see 12.4                        |

---

## 12.4 Findings from the code inspection

These are things the inspection turned up. **None has been confirmed by
running the application**, so each is written as a finding to verify, not as a
defect. The case that verifies it is named.

### F-01 — No seeded plan or workspace includes Lead Eagle

The five seeded subscription plans are `hrms`, `sales`, `business`,
`realestate` and `enterprise`. **None includes `LEAD_EAGLE`.** The demo
workspace `manath-homes` is entitled to HRMS, SALES and REAL_ESTATE; the second
workspace `leadersfort` to HRMS only.

So on a freshly seeded environment, **Lead Eagle cannot be reached at all** until
somebody creates a plan for it in the platform console. Every Lead Eagle case
here therefore begins by provisioning one.

_Verify with:_ `LE-SETUP-001` steps 2–3, `PLAT-PLAN-001` steps 2–3.
_Source:_ `apps/web/prisma/seed/index.ts` (`planSpecs`, the demo entitlement loop).

### F-02 — There is no Lead-Eagle-specific role, seeded or otherwise

The brief asks for Lead Eagle's **configurable starter roles**. No such role
exists in the repository at this commit: the 25 seeded roles are shared across
every product, and what confines a Lead Eagle user to Lead Eagle's screens is
the **entitlement** layer, not the role.

The four Lead Eagle personas in this suite are therefore `branch_manager`,
`team_manager`, `sales_rep` and `read_only` **inside a Lead-Eagle-only
workspace**, plus the `Telecaller` configuration the tester builds.

Whether the product intends dedicated starter roles is a question for the owner.
Marked **Needs UI Verification** rather than a gap, because the absence may be
deliberate.

_Verify with:_ [02](02-roles-and-personas.md) §2.5.1, `LE-ROLE-001`.
_Source:_ `apps/web/prisma/seed/roles.ts`.

### F-03 — Bookings and payouts assert SALES only, unlike everything around them

`POST /api/v1/bookings` and the `/api/v1/payouts` routes declare
`productModule: 'SALES'`. Every neighbouring money and marketing route —
collections receipts, fee amendments, recovery, commissions, events,
proposals — declares `SALES_OR_REALTY`.

The Real Estate navigation shows **Deals → Collections** and **Commissions**. So
a **Real-Estate-only brokerage can open the Deals area and cannot create a
booking or release a payout**: the request returns 403 _"Sales is not enabled for
this company."_

Given that the product's own entitlement comment describes Real Estate as
"brokerage leads, property inventory, site visits, **bookings and
commissions**", this looks like an oversight rather than a decision — but it may
be deliberate, so it is a finding, not a defect.

_Verify with:_ `RE-BOOK-001` step 15, `RE-COMM-001`'s payout negative,
`TEN-ENT-001`, `E2E-PROP-005`'s entitlement note.
_Source:_ `src/app/api/v1/bookings/route.ts`, `src/app/api/v1/payouts/route.ts`
versus `src/app/api/v1/collections/*/route.ts`, `commissions/route.ts`,
`events/route.ts`, `proposals/route.ts`.

### F-04 — No booking screen was located

There is no page file named `bookings` anywhere under
`src/app/(workspace)`. Bookings are read through **Collections**
(`sales/collections/page.tsx`, `sales/collections/[bookingId]/page.tsx`) and the
dashboards, and the API exists — but **the creation entry point could not be
identified from the code**.

_Verify with:_ `RE-BOOK-001` step 3, which instructs the tester to find and
record it, or to mark the case Blocked.

### F-05 — No role below administrator can run allocation

`allocation` is granted to **no** seeded role except `super_admin` and
`org_admin` (`sales_director` holds `distribution`, which configures
distribution rules, not the allocation screen). `allocation:APPROVE` is
likewise administrator-only.

The Allocation tab therefore does not appear for a branch manager, a team
manager or a regional manager by default — which is awkward, because allocating
leads is a manager's job. A workspace that wants a manager to run allocation must
grant it explicitly, and that is documented as a configuration requirement for
the "Sales Manager" and "Lead Eagle Manager" personas.

_Verify with:_ `LE-ROLE-001` step 14, `SALES-ALLOC-001`, [03](03-access-matrix.md) §3.2.

### F-06 — `it_admin` holds import and export but no record permissions

`it_admin` is granted `imports:IMPORT` and `exports:EXPORT` at ORGANIZATION, and
**no `leads`, `calls` or `employee` grant at all** — by design: _"administering
accounts is not a reason to be able to read salaries."_

Whether the generic import and export permissions are enough to move lead data
without holding `leads` **could not be determined by reading alone**. If they
are, the role boundary is cosmetic and the whole lead book is exportable by IT.

This is the **single most important unverified question** in this suite.

_Verify with:_ `TEN-FIELD-005` step 8. If `it_admin` can export leads, raise it
as a P0 data-leak defect immediately.

### F-07 — `it_admin` and `hr_admin` hold `roles:ASSIGN` at ORGANIZATION

Both roles can assign roles but not edit them, which is the stated design: HR can
onboard a joiner, IT can administer accounts, and _"deciding what a role may do
stays with the org admin, or an HR lead could widen their own authority."_

But assigning is itself a path to authority: if `it_admin` can assign **itself**
the `org_admin` role, the boundary is cosmetic. The roles screen states that
_"Scopes above your own level are shown but cannot be selected"_, which suggests a
guard exists — **whether it covers assigning a more senior role, and whether it
is enforced at the API, could not be determined by reading alone.**

_Verify with:_ `ADMIN-ROLE-004` steps 6–8, `TEN-FIELD-005`'s second negative row.

### F-08 — Two rate limits are declared and unused

`limits.publicForm` (5 / min) and `limits.publicShare` (60 / min) are defined in
`src/lib/security/ratelimit.ts`, and **no call site for either was found**. The
public routes declare their own limits inline instead
([02](02-roles-and-personas.md) §2.8). Harmless, but misleading to anyone
reading the limits table — and it means the effective public-form limit is 10 per
minute, not 5.

_Verify with:_ `PUB-FORM-001` step 20, `PUB-QR-001` step 14.

### F-09 — HR and back-office roles may be empty on an existing workspace

The HR and back-office roles once existed in the database **with no grants at
all**, which is why HR staff could open the module and do nothing in it, and why
an employee could not read their own record. They were added to the seed. But the
repair script (`scripts/seed-role-defaults.ts`) **only fills roles that hold no
grants at all**, because a partially granted role cannot be told apart from one
an administrator has deliberately trimmed.

So on a workspace that has been running for a while, an HR role may hold some
grants and be missing others, and no repair will fix it.

_Verify with:_ read the workspace's actual grants on **Administration → Settings
→ Roles** before running [05d](05d-people.md), and record any divergence from
[03](03-access-matrix.md) §3.2.

### F-10 — The mobile apps' status is contradictory

The Capacitor shells exist with 12 mobile API routes. A code comment describes
the `server.url` arrangement as a **proof of concept**, while the project's own
documentation records an **iOS submission**.

The two cannot both be current. **No mobile test cases were written**, because
writing them would mean guessing which is true.

_Resolve with the owner_ before any mobile testing is attempted.
_Source:_ `apps/mobile/capacitor.config.js`, `changes/PROJECT.md`.

### F-11 — Documentation inconsistencies found during inspection

Carried forward from the architecture inspection at the same commit, and
relevant here because a tester reading them would be misled:

- The root `README.md` still describes the older "Master SaaS" layout.
- `changes/PROJECT.md` contains duplicated paragraphs and two conflicting
  bullets about whether attendance belongs to HR.

Neither affects a test result; both affect a new tester's orientation. Not fixed
here, because the rule is that a document is corrected by the change that makes
it wrong, and this change does not.

---

## 12.5 What is deliberately not covered

| Not covered                           | Why                                                                                                                                                             | What would be needed                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Performance and load**              | Manual functional and UAT testing is the brief. `NEG-SCALE-001` probes volume, not throughput                                                                   | A load-test plan with targets, and the owner's performance requirements                                                                                               |
| **Accessibility**                     | Not in the brief, and it needs its own method                                                                                                                   | A WCAG audit. Note the code shows attention to it (accessible names on glyph buttons, labels carrying `data-required`), so an audit would likely find a good baseline |
| **Browser and device matrix**         | No supported-browser list was found in the repository                                                                                                           | The owner's supported-browser and screen-size list                                                                                                                    |
| **Mobile apps**                       | F-10: the repository contradicts itself                                                                                                                         | The owner's answer                                                                                                                                                    |
| **Email and SMS rendering**           | Templates exist (`admin/email-templates`); their rendering across clients is its own discipline                                                                 | A template-testing tool and an agreed client list                                                                                                                     |
| **Conversations / WhatsApp inbox**    | Needs a configured channel, which was not available to inspect                                                                                                  | Channel credentials, then cases modelled on `SALES-CALL-001`                                                                                                          |
| **Service tickets and SLA**           | Implemented (`sales/service`, `sla` permission, `service_manager` and `service_agent` roles) but out of the brief's eight named workflows                       | About 6 cases, modelled on the lead cases                                                                                                                             |
| **Automation rules**                  | Implemented (`automation` permission, `automations` API, `automation-time-five-minutely`); each rule is workspace configuration, so cases would be hypothetical | The workspace's actual rules, then one case per rule                                                                                                                  |
| **Contests, posts, engagement feed**  | Implemented and peripheral to the brief                                                                                                                         | About 3 cases                                                                                                                                                         |
| **Calendar sync**                     | Implemented (`calendar-sync-retry-quarter-hourly`); needs a calendar provider                                                                                   | Provider credentials                                                                                                                                                  |
| **Backup and restore**                | The owner's procedure, not a tester's. `11.1` G-09 reads the evidence from the release log                                                                      | Nothing; it is correctly out of scope                                                                                                                                 |
| **Penetration testing**               | [Section 7](07-tenancy-authz.md) tests the authorization model as specified; it is not an adversarial security assessment                                       | A security engagement. [Section 7](07-tenancy-authz.md) is a good brief for one                                                                                       |
| **Database-level RLS as an attacker** | See 12.6                                                                                                                                                        | A database connection the QA side does not have                                                                                                                       |

## 12.6 The limits of what a tester can verify

Three guarantees in this product **cannot be fully verified from the
application**, and this suite says so rather than pretending otherwise.

1. **Row-level security.** `TEN-RLS-001` runs the repository's own `check:rls`
   and `check:permissions` and asks the owner to confirm the application's
   database role is **not a superuser and does not have `BYPASSRLS`** — because
   row-level security is silently inert for a superuser. Without that
   confirmation, every tenancy case in [Section 7](07-tenancy-authz.md) is
   testing the **application layer only**.
2. **Token hashing.** `PUB-RESET-001` asserts that reset tokens are stored
   hashed. A tester with no database access can only confirm the token does not
   appear in any screen. The storage itself has to be taken from the code or
   confirmed by the owner.
3. **Production.** No production access exists on the QA side.
   [Section 11](11-uat-acceptance.md) is written for the owner to run, and its
   backup evidence is read from the release log rather than from a server.

## 12.7 Where to look when a case fails

| The symptom                                         | Look here first                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| An empty list for a manager                         | Their team, branch or region placement — [02](02-roles-and-personas.md) §2.3's three edge cases |
| A refused action the matrix says is allowed         | The workspace's **actual** role grants, not [03](03-access-matrix.md)'s defaults                |
| A "deferred" outcome that never arrives             | Whether the worker is running — [04](04-environment-and-data.md) §4.2                           |
| A 403 where a 404 was due, or the reverse           | §6.0's status table; it is a real defect, report it                                             |
| A masked value that is not masked                   | Which egress path you looked at — `TEN-FIELD-001`'s grid                                        |
| A screen refusing with a friendly panel             | The workspace's entitlement, not its permissions                                                |
| A navigation entry that is missing                  | Entitlement first, then permission, then `unlessModule` (`LE-NAV-002`)                          |
| A figure that looks wrong on the daily board        | The definitions in `SALES-DAILY-001` step 8 — especially that `called` is **distinct**          |
| A money action refused for the person who set it up | That is the design. [05e](05e-real-estate.md)'s opening table                                   |
| A permission change that has not taken effect       | Up to 60 seconds; beyond that, a defect (`E2E-PERM-007`)                                        |

## 12.8 Recommended next steps

In order.

1. **Run [Section 9](09-smoke.md)** on a seeded local environment. Half a day.
   It will shake out the environment, not the product.
2. **Resolve F-06 and F-07 first** (`TEN-FIELD-005` step 8 and
   `ADMIN-ROLE-004` steps 6–8). They are two requests each, and either one
   failing is a release blocker that changes the priority of everything else.
3. **Run [Section 7](07-tenancy-authz.md) in full.** It is the section a release
   is blocked on, and it needs no business knowledge — only care with the API
   requests.
4. **Ask the owner about F-01, F-02, F-03 and F-10** before writing any more
   Lead Eagle or mobile cases.
5. **Run the money cases** (10.4) with two finance accounts. They are the cases
   with the clearest right answer and the highest cost of being wrong.
6. **Then the role-wise cases** in [Section 5](README.md), module by module.
7. **Then the eight workflows** in [Section 8](08-e2e-workflows.md), which will
   mostly pass if steps 3–6 did.
8. **Fill the Excel matrix as you go**, not afterwards.

## 12.9 Keeping the suite true

- A new feature gets its cases **in the same change**, as the project's own rule
  requires of documentation.
- A defect found in production gets a **new row in [Section 10](10-regression.md)**,
  so the same failure cannot recur unnoticed.
- The role matrix in [Section 3](03-access-matrix.md) is generated from
  `prisma/seed/roles.ts`. When that file changes, regenerate it rather than
  hand-editing, or the two will disagree within a month — which is exactly why
  the seed and the repair script share one file.
- Every **Needs UI Verification** mark is a question, not a finding. Each one
  resolved should be struck out and replaced with what was actually seen.
