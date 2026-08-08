# Feature matrix

Traceability from the HRMS specification to this repository (§116). One row per
requirement area, with the honest state of each layer.

**Read the stack note first.** The specification names Python, FastAPI,
SQLAlchemy and Alembic. This repository does not use them. The Python HRMS was
archived in `docs/adr/0001-archive-python-hrms.md` and HRMS now runs natively in
the Next.js application against PostgreSQL, with Prisma migrations in place of
Alembic. Everything below is assessed against that stack; the spec's §1 is
treated as superseded, not unmet.

Legend: **DONE** = database, API, authorization, UI and tests all exist ·
**PARTIAL** = some layer missing, named in the row · **MISSING** = not built.

## Built before this work

| ID | Feature | DB | API | UI | Tests | Status |
|---|---|:--:|:--:|:--:|:--:|---|
| AUTH | Login, JWT + refresh, logout-all, lockout, reset, forced change | ✅ | ✅ | ✅ | ✅ | DONE |
| MFA | TOTP enrol, QR, replay block, recovery codes, admin reset | ✅ | ✅ | ✅ | ✅ | DONE |
| RBAC | Roles, granular permissions, scopes, assignment history | ✅ | ✅ | ✅ | ✅ | DONE |
| BIO | Consent, server-side embeddings, encrypted templates | ✅ | ✅ | ✅ | ✅ | DONE |
| LIVE | Challenge-response liveness | ✅ | ✅ | ✅ | ✅ | DONE — not certified PAD |
| PUNCH | Geofence, GPS accuracy, reject codes, result states, offline sync | ✅ | ✅ | ✅ | ✅ | DONE |
| ATT-R | Review queue, daily roll-up, location snapshots, retention | ✅ | ✅ | ✅ | ✅ | DONE |
| LOC | Work locations, assignments, temporary requests, exceptions | ✅ | ✅ | ✅ | ✅ | DONE |
| LEAVE | 9 UAE types, accrual, approval, holidays, carry-forward, calendar | ✅ | ✅ | ✅ | ✅ | DONE |
| LIFE | Onboarding 16 + RERA 4, offboarding 16, settlement, gratuity | ✅ | ✅ | ✅ | ✅ | DONE |
| DOC | Categories, magic-byte validation, sha256, expiry dashboard | ✅ | ✅ | ✅ | ✅ | DONE |
| AUDIT | Event capture and the audit browser | ✅ | ✅ | ✅ | ✅ | DONE |
| NOTIF | In-app notifications, SMTP provider, templates | ✅ | ✅ | ✅ | ✅ | DONE |
| SHIFT | Shift definitions and employee assignment | ✅ | ✅ | ✅ | ✅ | DONE |
| SET | 30-parameter HR policy registry, audited, workspace-scoped | ✅ | ✅ | ✅ | ✅ | DONE |

## Built in this work

| ID | Feature | DB | API | UI | Tests | Status |
|---|---|:--:|:--:|:--:|:--:|---|
| OT-01 | Overtime claims — model, enums, RLS, check constraint | ✅ | — | — | ✅ | DONE |
| OT-02 | Detection from the attendance roll-up, idempotent | ✅ | ✅ | ✅ | ✅ | DONE |
| OT-03 | Manual claim with reason; one per person per day | ✅ | ✅ | ✅ | ✅ | DONE |
| OT-04 | Approve / reject / time-off-in-lieu, no self-approval | ✅ | ✅ | ✅ | ✅ | DONE |
| OT-05 | Rate categories: normal, night, weekend, holiday | ✅ | ✅ | ✅ | ✅ | DONE |
| OT-06 | Multiplier frozen at approval (§106 historical integrity) | ✅ | ✅ | ✅ | ✅ | DONE |
| OT-07 | `overtime` permission module + backfill migration | ✅ | ✅ | ✅ | ✅ | DONE |
| OT-08 | 9 workspace-tunable overtime settings | ✅ | ✅ | ✅ | ✅ | DONE |
| OT-09 | `approvedOvertimeMinutes` — the payroll input | ✅ | — | — | ✅ | DONE — no consumer yet |

| PAY-01 | Effective-dated compensation; a raise is a new row | ✅ | ✅ | ✅ | ✅ | DONE |
| PAY-02 | Payroll runs, one per period, DRAFT→…→PAID | ✅ | ✅ | ✅ | ✅ | DONE |
| PAY-03 | Calculation: package, unpaid leave, overtime, adjustments | ✅ | ✅ | ✅ | ✅ | DONE |
| PAY-04 | Maker-checker — the preparer cannot approve their own run | ✅ | ✅ | ✅ | ✅ | DONE |
| PAY-05 | Lock freezes the overtime claims and adjustments consumed | ✅ | ✅ | ✅ | ✅ | DONE |
| PAY-06 | Payslips with a line breakdown; self-service, approved runs only | ✅ | ✅ | ✅ | ✅ | DONE |
| PAY-07 | One-off adjustments, consumed once | ✅ | ✅ | ✅ | ✅ | DONE |
| PAY-08 | `payroll` permission module, deliberately not backfilled | ✅ | ✅ | ✅ | ✅ | DONE |
| WPS-01 | SIF generation, versioned layout, EDR + SCR totals | ✅ | ✅ | ✅ | ✅ | DONE — layout needs bank validation |
| WPS-02 | Employee bank fields; unbankable staff reported, not dropped | ✅ | ✅ | ✅ | ✅ | DONE |
| ROS-01 | Per-date roster entries, split shifts allowed, duplicates refused | ✅ | ✅ | ✅ | ✅ | DONE |
| ROS-02 | Conflict engine: overlap, rest, consecutive days, leave, retired shift | ✅ | ✅ | ✅ | ✅ | DONE |
| ROS-03 | Bulk assign over a range and weekday filter, partial success reported | ✅ | ✅ | ✅ | ✅ | DONE |
| ROS-04 | Copy a week forward, re-checked rather than blindly duplicated | ✅ | ✅ | ✅ | ✅ | DONE |
| ROS-05 | Weekly grid; employees see only their own | ✅ | ✅ | ✅ | ✅ | DONE |
| ROS-06 | Shift change requests, manager decision | ✅ | ✅ | ✅ | ✅ | DONE |
| ROS-07 | Employee-to-employee swap, both sides moved in one transaction | ✅ | ✅ | ✅ | ✅ | DONE |
| ROS-08 | `shifts:APPROVE` permission, backfilled from `shifts:EDIT` | ✅ | ✅ | ✅ | ✅ | DONE |
| ROS-09 | 3 roster settings: consecutive-day cap, rest hours, leave blocking | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-01 | Requisitions with approval; hiring manager cannot approve own headcount | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-02 | Candidates, one application per person per role | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-03 | Pipeline with a transition rule and full stage history | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-04 | Interviews with panels; feedback restricted to the panel | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-05 | Scorecards — rating, recommendation, per-competency scores | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-06 | Offers versioned by row; approve → send → response | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-07 | Hire from an accepted offer only; issues an invitation | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-08 | §109 traceability — `EmployeeProfile.hiredFromCandidateId` | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-09 | Salary bands behind `recruitment:VIEW_SENSITIVE_FIELDS` | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-10 | Pipeline summary: counts by stage, time-to-hire | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-01 | Review cycles — annual/semiannual/quarterly/probation/custom | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-02 | Opening a cycle materialises one review per eligible employee | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-03 | Goals with weights capped at 100% across a cycle, progress, evidence | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-04 | Self → manager → calibration → acknowledgement, no skipping | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-05 | Manager review restricted to the actual reporting line | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-06 | Manager assessment hidden from the employee until released | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-07 | Calibration keeps the manager's rating alongside the final one | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-08 | Configurable competency framework, seeded idempotently | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-09 | PIPs with checkpoints; unacknowledged plans cannot be failed | ✅ | ✅ | ✅ | ✅ | DONE |
| PRF-10 | Rating distribution, outstanding reviews, active PIPs — scoped | ✅ | ✅ | ✅ | ✅ | DONE |
| RPT-01 | Report registry — 17 reports across all seven domains | — | ✅ | ✅ | ✅ | DONE |
| RPT-02 | Each report carries its *data* permission, not a reporting one | — | ✅ | ✅ | ✅ | DONE |
| RPT-03 | List shows only runnable reports; run re-asserts the permission | — | ✅ | ✅ | ✅ | DONE |
| RPT-04 | CSV export through the same gate — §56 parity, asserted registry-wide | — | ✅ | ✅ | ✅ | DONE |
| RPT-05 | Date-window filters; exports audited with the permission used | — | ✅ | ✅ | ✅ | DONE |
| RPT-06 | Formula-injection guard and UTF-8 BOM on every export | — | ✅ | ✅ | ✅ | DONE |
| DSH-01 | Employee self-service panel — today, my requests, payslips | — | ✅ | ✅ | ✅ | DONE |
| DSH-02 | "Waiting on me" queue, each count gated on the acting permission | — | ✅ | ✅ | ✅ | DONE |
| DSH-03 | Security panel — failed sign-ins, locked accounts, 2FA coverage | — | ✅ | ✅ | ✅ | DONE |
| NTF-01 | 18 HR events wired at every decision point, in-app + queued email | ✅ | ✅ | ✅ | ✅ | DONE |
| NTF-02 | Recipients resolved by permission, not role name | ✅ | ✅ | ✅ | ✅ | DONE |
| NTF-03 | `notifications` queue and worker; delivery state on the row | ✅ | ✅ | ✅ | ✅ | DONE |
| NTF-04 | A notification failure never rolls back the decision behind it | ✅ | ✅ | ✅ | ✅ | DONE |
| PDF-01 | Payslip PDF — dependency-free writer, valid xref and stream lengths | ✅ | ✅ | ✅ | ✅ | DONE |
| ATS-11 | Onboarding checklist built automatically at invitation acceptance | ✅ | ✅ | ✅ | ✅ | DONE |

`OT-09` is the only seam between overtime and payroll: payroll reads approved
claims, never raw attendance.

Two things about payroll that are choices, not oversights. **The `payroll`
permissions are not backfilled onto any existing role** — every other HR
permission here was derived from a coarser one a role already held, but nobody
has ever been able to read salaries in this product, so there is no prior grant
to derive from and inventing one would hand payroll to whoever administers HR.
§90 says the opposite. Grant them deliberately in the roles screen. **The SIF
layout is one documented variant**, not a universal standard: banks differ on
date format and column order, so `SIF_LAYOUTS` is keyed and the builders are
pure. Validate against the receiving bank before the first live run.

## Not built

| ID | Feature | Spec | Status |
|---|---|---|---|
| RPT-x | Report export as native .xlsx | §56 | MISSING — CSV only, and deliberately: the BOM makes Excel open it correctly, so a workbook writer would be a dependency for formatting rather than for function |
| ATS-x | Public careers page and job-board integration | §48 | MISSING — candidates are entered by a recruiter; there is no self-service application route |
| ATS-x | Offer-letter document | §48 | MISSING — offer *terms* are recorded and versioned; no letter is rendered. `src/lib/pdf.ts` is the piece that was missing and now exists |
| PRF-x | 360° and peer review | §53 | MISSING — self, manager and HR calibration only |
| DASH-x | Executive roll-up dashboard | §55 | MISSING — employee, manager and security panels exist; there is no cross-module executive summary |

## Notes

All six modules identified as missing are built. What remains in the table above
is narrower than a module: two export formats, two dashboard panels, and the
notification wiring.

**The notification gap is the one worth planning.** Every approval queue this
work added — overtime, shift changes, payroll runs, requisitions, offers,
reviews — is *pull-only*: it is visible on the page and on the dashboard's
"waiting on me" panel, but nothing tells anyone it is there. The service and the
SMTP provider already exist; what is missing is an event emitter on each decision
point. §107 asks for exactly that shape, and doing it once against the audit
events these modules already write would cover all of them.

Performance visibility is three-way rather than one permission: an employee reads
their own and writes only the self-assessment; a line manager reads and writes
the manager section for their own reports via `reportingLine`; HR reads the
workspace and is the only party that can calibrate. The manager's assessment is
withheld from the employee until calibration releases it — a draft rating read
early changes the conversation permanently.

**One manual step remains in the §109 chain.** `hireCandidate` issues an
invitation rather than creating an account outright, because the employee record
is created when the joiner accepts and sets a password only they have seen — the
same rule the manual "add employee" path follows. Acceptance is an
unauthenticated request with no HR actor to attribute a checklist to, so
onboarding is a second, explicit click (`candidate-onboard`), surfaced on the
candidate page as soon as the employee row appears. Everything else in the chain
is automatic, and `EmployeeProfile.hiredFromCandidateId` plus the invitation's
`joiningDate` carry the trail and the agreed start date across the gap.

One thing rostering does **not** yet feed: overtime detection still compares a
worked day against `HrEmployeeShift`, the standing assignment, not against
`HrRosterEntry`. For a workspace that rosters properly the published roster is
the better comparison, and pointing `scheduleLookup` at it — falling back to the
standing assignment when a day was not rostered — is the natural next change.
