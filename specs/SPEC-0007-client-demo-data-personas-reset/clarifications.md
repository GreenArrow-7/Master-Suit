# SPEC-0007 — Clarifications

| Field | Value |
|---|---|
| Specification | `SPEC-0007` |
| Risk | `R3` |
| Last updated | 2026-09-08 |

Six material ambiguities. Four are answered from the repository and are
recorded resolved with the evidence that settled them. Two require a human
decision and are recorded open; neither blocks approval, and each states the
default that applies if no decision is taken.

---

- `CL-001` — Which roles do the three demonstration personas hold?

**Status:** RESOLVED · Answered from the repository.

**Question.** The request named `sales_rep`, `hr_admin` and `org_admin` as
expectations to be verified rather than as facts.

**Evidence.** `apps/web/prisma/seed/roles.ts` defines a catalogue of 26 roles.
`sales_rep` grants leads, opportunities, activities, tasks, reports and
dashboards at OWN scope with accounts and contacts at TEAM scope. `hr_admin`
grants employee, attendance, leave, shifts, holidays, HR documents and HR
reports at ORGANIZATION scope, with payroll at VIEW only. `org_admin` grants a
tenant-wide wildcard and carries no platform role; platform authority lives on
the platform identity, not on a workspace membership.

**Resolution.** Use `sales_rep`, `hr_admin` and `org_admin` unchanged. The
Management persona is tenant-scoped by construction: a wildcard inside one
workspace is not a platform role, and nothing in this specification grants one.

---

- `CL-002` — Is the existing Sales dataset sufficient, or does it need
  rebuilding?

**Status:** RESOLVED · Answered from the repository.

**Evidence.** The seed generates 500 leads, 1000 activities, 8 accounts, 25
contacts, a pipeline with its full stage set, 14 opportunities across open, won
and lost, follow-ups including deliberately overdue ones, targets, calls with
transcripts, AI analyses, scored audits, 3 campaigns, communications, events,
2 forms and 2 landing pages, plus eleven role personas.

**Resolution.** Reuse it. Do not rebuild. `FR-009` requires the audit to name
any screen that is genuinely empty and to fill only that, so this resolution
stays falsifiable rather than becoming an assumption.

---

- `CL-003` — Does the existing demo reset already cover HRMS?

**Status:** RESOLVED · Answered from the repository.

**Evidence.** The reset branch of `apps/web/prisma/seed/index.ts` performs 47
ordered deletions covering the CRM chain, lead configuration, roles and users.
It deletes no HR record. The schema declares 38 models with an `Hr` prefix,
plus department, designation and biometric-consent models, none of which the
reset touches.

**Resolution.** Extend the existing reset rather than replacing it, and add the
coverage check in `FR-015` so the same omission cannot recur silently. A
hand-maintained deletion list is what produced this gap.

---

- `CL-004` — Are payroll, payslips and the WPS bank-file export demonstrable?

**Status:** RESOLVED · Product Owner decision, 2026-09-08.

**Resolution.** Payroll is out of scope for `SPEC-0007`. No payroll run,
payslip, compensation, salary, bank account, IBAN or wage-protection record is
seeded, synthetic or otherwise. If the HR interface exposes payroll navigation,
no business data is fabricated to populate it; the limitation is recorded
truthfully in the client-demo walkthrough instead. No payroll product
functionality changes under this specification.

**Question as raised.** `hr_admin` holds payroll at VIEW scope, so payroll screens open.
With no compensation or payslip data seeded they open empty.

**Consideration.** Seeding payroll would mean synthetic salary figures and, for
the WPS export to function, synthetic IBANs and labour-card identifiers. That
is the highest-sensitivity surface in the HR module and the one whose export
path bulk-exports those fields.

**Default if undecided.** Out of scope, as recorded in `spec.md`. Payroll
screens open and are legitimately empty, and `FR-008` accepts an empty state
that is correct because the feature is deliberately excluded.

**Decision owner.** Product Owner, with Application Security.

---

- `CL-005` — What is an acceptable duration for seed and reset?

**Status:** RESOLVED · Product Owner decision, 2026-09-08.

**Resolution.** 45 working days of deterministic attendance history, inside the
30-to-60 range the specification intended. Variation uses only the statuses the
data model actually declares — `PRESENT`, `ABSENT`, `LATE`, `REMOTE`,
`ON_LEAVE`. Half-day behaviour is represented through the `halfDay` flag on a
leave request, and no `HALF_DAY` attendance value is invented. Approved leave
and generated attendance must stay mutually coherent. No duration threshold for
the seed itself is set; the seed reports its elapsed time under `OBS-001` and a
threshold may be set later from observation.

**Question as raised.** `NFR-003` deliberately asserts no numeric threshold. Adding 24 to
30 employees with 30 to 60 days of attendance each adds on the order of a
thousand rows to a seed that already writes several thousand.

**Default if undecided.** No threshold is enforced. The seed reports its
duration alongside the counts required by `OBS-001`, and a threshold is set
later from observation rather than invented now.

**Decision owner.** Solution Architect.

---

- `CL-006` — Which domain do synthetic electronic addresses use?

**Status:** RESOLVED · Answered from the repository and standing policy.

**Evidence.** The existing seed uses two shapes: a workspace domain for the
demonstration personas, and a placeholder domain for the legacy accounts.
`docs/TEST-DATA-POLICY.md` requires synthetic identifiers that resolve to
nobody.

**Resolution.** Generated records use a domain reserved for documentation and
testing, so that a misdirected message cannot reach a real mailbox by
construction. `DATA-005` states the requirement; the specific domain is an
implementation detail recorded in `plan.md` under `AD-006`. The controlling
protection is that the demo environment dispatches nothing externally
(`SEC-006`), and the domain choice is defence in depth behind it.

---

- `CL-007` — The Sales seed's demonstration domains are not reserved ones

**Status:** RESOLVED · Product Owner decision, taken in session and implemented;
transcribed here 2026-09-09. **Option A** — every demonstration address moved to
`example.com`. Ten persona addresses changed, and the default addresses in
`apps/web/scripts/demo-smoke.mjs`, `apps/web/scripts/mobile-audit.mjs` and
`apps/web/scripts/ensure-workspace-admin.mjs` with them. Two pieces of logic that
had keyed on the domain were re-keyed onto `DEMO_PERSONA_EMAILS` at the same
time, because `endsWith('@example.com')` would otherwise have matched all 41
seeded accounts.

The transcription is late and that is the finding: the decision was made and
built, but the entry was left reading OPEN, so the corpus disagreed with the
code for a day. Recorded rather than quietly corrected.

**Superseded in part by `CHG-004`.** The single client-facing login is now
`demo@youhan.in`, which is Option **B** — an organisation-controlled domain — for
exactly one address. Option B was unavailable to this entry only because control
of `manathhomes.ae` had not been established; control of `youhan.in` is not in
doubt. Every *generated* address remains on `example.com` under Option A above.
`CHG-004` is **not approved**, so this paragraph records what was built, not a
requirement that has been amended.

**Question as raised.** The Product Owner asked that the original question not
be resolved by an agent; it was not.

**What was found.** `DATA-005` requires every generated electronic address to
sit on a domain reserved for demonstration use, so a misdirected message cannot
reach a real mailbox. Measured against the seeded workspace, the addresses are:

| Domain | Addresses | Reserved? |
| --- | --- | --- |
| `example.com` | 31 | Yes — RFC 2606 |
| `manathhomes.ae` | 9 | **No** |
| `manathhomes.com` | 1 | **No** |

The ten non-reserved addresses are the demonstration personas, and they predate
`SPEC-0007`: they come from the Sales seed and are documented in `docs/DEMO.md`
as the demonstration cast. The HR dataset this specification added introduced
none of them.

**The actual communication risk, separated from strict compliance.** It is
close to zero, and by three independent mechanisms rather than one: the demo
environment selects the mock mail provider so nothing is dispatched; the
workspace holds no integration connection so nothing can be dispatched through
a vendor either; and `ST-008` and `ST-009` assert both. The exposure is a
requirement that its own fixture does not satisfy, not a message that can
escape.

**Options.**

- **A — Move the personas to a reserved domain.** Compliant, and it changes ten
  documented logins, `docs/DEMO.md`, and anything anyone has bookmarked or put
  in a runbook. It also makes the demonstration read less convincingly to a
  prospect, who sees the login on screen.
- **B — Amend `DATA-005`** to accept a deterministic non-customer demonstration
  domain the organisation controls, alongside the reserved ones. Honest about
  what the requirement is really protecting against, and needs the organisation
  to actually control `manathhomes.ae` — which has not been established.
- **C — Keep it open** as a recorded non-compliance with the risk stated above.

**What is needed to decide:** whether the organisation controls
`manathhomes.ae`. If it does not, B is unavailable and the choice is A or C.

*Decision owner: Product Owner, with the security owner.*
