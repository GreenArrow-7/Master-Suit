# Acceptance

**Phase:** B3 — Agent Integration and Controlled Execution
**Specification:** `SPEC-0002` · **Risk:** `R3` · **Date:** 2026-09-07
**Prepared by:** AI · Revised after the governance closure pass

## Status

**FORMALLY ACCEPTED — PASS WITH ACCEPTED LIMITATIONS**

`D10` was accepted on 2026-09-08 by the **reviewer** role (gate 6 at R3).

`D1` to `D9` were decided by humans on 2026-09-08 and are recorded in
`human-governance-decisions.md`. `D10` was explicitly withheld, so this phase
is **not** formally accepted.

| | |
|---|---|
| Engineering | complete; 56 of 56, 48 of 48, zero validation errors |
| Convergence verdict | `PASS WITH ACCEPTED LIMITATIONS` — 10 resolved, 5 accepted with named owners, 0 open |
| Approvals recorded | 4 gates plus 1 human review, all `actorType: "human"` |
| Human decisions taken | **12** — `D1`–`D9`, the `D9` addendum, `CONV-012`, `CONV-014` |
| Human review of the change | **completed** — `REV-0004` (pre-D9 plane) and `REV-0009` (post-D9 addendum) |
| B3 formally accepted | **yes** — `D10` ACCEPTED 2026-09-08 |

The verdict moved from `FAIL` to `PASS WITH ACCEPTED LIMITATIONS` because
humans made the decisions the standard requires, not because anything about
the code changed. Three residual risks are accepted with named owners; that is
what the verdict means and it is not a claim that they are fixed.

## The two R3 approval questions

Kept separate, because they have different answers.

**A. Does R3 require an implementation-readiness approval?**
**No. This is unambiguous.** Six sources agree with no dissent:
`docs/RISK_CLASSIFICATION.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`,
`docs/sdd/HUMAN_APPROVAL_GATES.md` gate 5, `docs/sdd/SPEC_LIFECYCLE.md`,
`docs/sdd/SDD_WORKFLOW.md`, `tools/sdd/lib/lifecycle.mjs`. An agent is
permitted to execute at R3, and did.

**B. Who may approve an R3 specification?**
**Settled: Option A** (`D2`, Solution Architect, 2026-09-08). A Product Owner
or Solution Architect must approve before implementation begins. `EVC-015` is
RESOLVED and six governing documents were corrected.

## No role was inferred

Each decision named the role it was exercised under, and each is recorded
independently. Nothing was collapsed into "approved all".

Two fields were left as placeholders by the decider and were **not** filled in
by guessing: every date (recorded as the 2026-09-08 receipt date, labelled as
such) and `D1`'s role (recorded as "Product Owner or Solution Architect
(specific role not stated by the approver)"). Gate 1 accepts either role, so
the gate is discharged; a human should confirm which for traceability.

---

## Human Decisions Required

**Ten decisions. Nine can be taken now; one cannot.**

The previous revision said "seven". That was wrong twice over: it counted the
numbered items and omitted both the final convergence acceptance and
architecture approval, and it separately mis-stated architecture approval as
"not a convergence blocker". Both errors are corrected below. A tenth
decision, human code review, had not been surfaced at all.

## Authoritative decision table

Every decision carries the same eleven fields. Blocking means: blocks `D10`.

| ID | Decision | Why required | Required role | Eligible now | Blocking | Prerequisites | Status | Allowed decisions | Evidence | Artifacts changed after the decision |
|---|---|---|---|---|---|---|---|---|---|---|
| `D1` | `SPEC-0002` specification approval | Gate 1 at R3 | Product Owner **or** Solution Architect | **yes** | **yes** — `CONV-004` | none | **APPROVE (`D1`, 2026-09-08)** | APPROVE / REQUEST_CHANGES / REJECT | `spec.md`, `clarifications.md`, `r3-approval-rule-resolution.md` | `sdd.json` approvals; `CONV-004` |
| `D2` | `EVC-015` R3 specification-approval policy | Two normative statements select different R3 approvers | Solution Architect, as owner of `HUMAN_APPROVAL_GATES.md` | **yes** | **yes** — determines whether `CONV-004` is a deviation | none | **Option A (`D2`, 2026-09-08)** | Option A / Option B | `docs/EVIDENCE_CONFLICTS.md` `EVC-015`; `r3-approval-rule-resolution.md` | `HUMAN_APPROVAL_GATES.md` gate 1 or 5; `EVC-015` |
| `D3` | Architecture approval for the agent-control pattern | Gate 2 at R3; a new pattern is introduced | Solution Architect | **yes** | **yes** — `AGENTS.md` §8, check 15 | none | **APPROVE (`D3`, 2026-09-08)** | APPROVE / REQUEST_CHANGES / REJECT | `architecture-review-pack.md`; `plan.md` `AD-001`–`AD-007` | `sdd.json` approvals; check 15 |
| `D4` | `CONV-001` security residual-risk disposition | Gates 3 and 9 | Application Security | **yes** | **yes** — check 13 | none | **ACCEPT (`D4`, 2026-09-08)** | ACCEPT / REQUIRE_REMEDIATION | `security-review.md`, `security-re-review.md`, `separation-of-duty-audit.md` | `CONV-001`; `sdd.json` gate-3 approval |
| `D5` | `CONV-003` bootstrap-boundary disposition | Gate 9, functional limitation | Product Owner | **yes** | **yes** — check 13 | none | **ACCEPT (`D5`, 2026-09-08)** | ACCEPT / REQUIRE_REMEDIATION | `bootstrap-session-audit.md` | `CONV-003` |
| `D6` | `CONV-005` agent-tests-in-CI disposition | Gate 9, operational limitation; or an R5 infrastructure approval | DevOps / Production Engineering | **yes** | **yes** — check 13 | none | **REQUIRE REMEDIATION (`D6`) — remediated** | ACCEPT / REQUIRE_REMEDIATION | `ci-integration-audit.md`; `CL-005` | `CONV-005`; if remediation: `CHG-`, task, session, `.github/workflows/sdd-validate.yml` |
| `D7` | `CONV-009` historical digest limitation | Gate 9, functional limitation | Product Owner | **yes** | **yes** — check 13 | none | **ACCEPT (`D7`, 2026-09-08)** | ACCEPT / REQUIRE_REMEDIATION | `attribution-remediation.md` | `CONV-009` |
| `D8` | `CONV-010` convergence status model | An `OPEN` finding must reach a terminal state | QA / Release Engineering | **yes** | **yes** — check 13 | none | **Option A (`D8`, 2026-09-08)** | Option A / Option B | `convergence-status-model-audit.md` | `CONV-010`; if Option B: `CONVERGENCE_TEMPLATE.md` under `CHG-` |
| `D9` | Human code review of the B3 change | R3 requires 1 human reviewer; `AGENTS.md` §8 | any qualified human reviewer, not the author | **yes** | **yes** — check 15 | none | **APPROVE (`D9`, 2026-09-08)** | APPROVE / REQUEST_CHANGES / BLOCKED | `human-code-review-pack.md` | A `REV-` record with `actorType: "human"`; check 15 |
| `D10` | **Final B3 convergence acceptance** | Gate 6 at R3 | reviewer | — | met | **ACCEPTED 2026-09-08** | ACCEPT / REJECT | `convergence.md` after re-run | `sdd.json` status; `convergence.md` verdict |

**`D1` to `D9`: all decided on 2026-09-08.** Recorded verbatim in substance
in `human-governance-decisions.md`; none was broadened.

**`D10` is now ELIGIBLE and has NOT been taken.** Every precondition is met —
nine decisions recorded, the `D6` remediation completed and verified,
`EVC-015` resolved, no finding `OPEN`, all suites green, convergence re-run.
The decider withheld it explicitly.

### Roles are exercised, not held

One person may legitimately hold several of these roles. If so, each decision
is still recorded independently under the role being exercised. "Approved all"
is not a decision this table can absorb — `D1` under Product Owner and `D3`
under Solution Architect remain two records even when one person makes both.

### Are `D1` and `D3` the same gate?

**No. Two genuinely independent gates.**

| | Gate 1 (`D1`) | Gate 2 (`D3`) |
|---|---|---|
| Question | Are the requirements correct? | Is the technical approach acceptable? |
| Approver at R3 | Product Owner **or** Solution Architect | Solution Architect, specifically |
| Trigger at R3 | always | only when a new pattern is introduced |
| Evidence | `spec.md` | `plan.md`, the `AD-` decisions |

**A Product Owner may satisfy gate 1 and cannot satisfy gate 2.** They are not
merged.

### Why `D4` carries two components and the others do not

`HUMAN_APPROVAL_GATES.md` gate 3 reads: *"that the threat model is adequate
**and** any residual risk is accepted knowingly."* The standard itself bundles
those into one gate held by one role, so `D4` carries both and names each.

`CONV-003`, `CONV-005` and `CONV-009` are not security risks. Gate 9 routes a
functional limitation to the Product Owner and an operational one to DevOps.
Three separate decisions, two different roles, not bundled.

---

## Decision detail

### D1 — SPEC-0002 specification approval

**Decision:** APPROVE / REJECT / REQUEST_CHANGES
**Question:** are the requirements of `SPEC-0002` correct and complete enough
to have been built?

| Outcome | What changes |
|---|---|
| APPROVE | An approval record is added to `sdd.json` naming role, decision, date and scope. `CONV-004` moves to `RESOLVED` |
| REQUEST_CHANGES | `spec.md` is amended under a `CHG-` record; `CONV-004` stays `OPEN` |
| REJECT | `SPEC-0002` moves to `CANCELLED` or `SUPERSEDED`; the B3 tooling stays in the tree unapproved and B4 does not proceed on it |

**Interaction with `D2`, stated neutrally.** Under Option A this approval was
required before implementation and was crossed. Under Option B the author
proceeds — but the author of `SPEC-0002` is an AI, and `AGENTS.md` forbids an
agent granting itself an approval, so a human would still have to stand behind
it. **A human decision is needed under either option.** What `D2` changes is
the form the record takes, not whether one is needed.

### D2 — EVC-015 policy resolution

**Decision:** select Option A or Option B, then correct the losing statement
under change control.
**Question:** who may approve an R3 specification?

Both options are presented as the documents state them. **No recommendation is
made, and the fact that one option is stricter is not a reason to choose it.**

| | **Option A** | **Option B** |
|---|---|---|
| Source | `HUMAN_APPROVAL_GATES.md` gate 1: "R3: Product Owner or Solution Architect", supported by the matrix row "Spec approval" | `HUMAN_APPROVAL_GATES.md` gate 5: "At R0–R3 the author proceeds once the artefacts the risk matrix requires exist" |
| Approver at R3 | a named non-author role | the author |
| **Operational effect on every future R3 specification** | An agent completes the artefacts, moves to `READY_FOR_APPROVAL`, and **stops**. Implementation waits for a Product Owner or Solution Architect. Throughput is lower; a named human owns every R3 requirement set | An agent completes the artefacts and **proceeds** to implementation once they exist. Throughput is higher; R3 requirement sets carry no independent sign-off, and an AI-authored specification still needs a human to adopt authorship for `AGENTS.md` to be satisfied |
| Effect on `SPEC-0002` | the gate was crossed; `CONV-004` is a real deviation | the gate was not crossed; `CONV-004` closes as `NOT_APPLICABLE` |
| Effect on tooling | none — `requiresImplementationApproval` already excludes R3 | none |

**Neither document that would settle it addresses the question.**
`docs/RISK_CLASSIFICATION.md`, the authoritative risk model, has no
specification-approval row. There is no tie-break to appeal to.

| Outcome | What changes |
|---|---|
| Option A chosen | Gate 5's "at R0–R3" clause is narrowed to R0–R2 under a `CHG-` record; `EVC-015` moves to Resolved Conflicts; `CONV-004` stands |
| Option B chosen | Gate 1's R3 row and the matrix "Spec approval" row are corrected; `EVC-015` moves to Resolved Conflicts; `CONV-004` is reassessed and likely closes |

### D3 — Architecture approval

**Decision:** APPROVE / REJECT / REQUEST_CHANGES
**Question:** does the agent execution-record pattern fit the system?
**Required role:** Solution Architect. A Product Owner cannot satisfy this.
**Evidence:** `plan.md`, decisions `AD-001` to `AD-007`.

| Outcome | What changes |
|---|---|
| APPROVE | An approval record is added to `sdd.json` for the architecture gate; convergence check 15 can pass |
| REQUEST_CHANGES | `plan.md` is amended under a `CHG-` record and the affected tasks re-executed |
| REJECT | The pattern is withdrawn; `SPEC-0002` returns to `PLANNED` |

### D4 — Security risk acceptance

**Decision:** ACCEPT / REJECT — REQUIRE REMEDIATION
**Required role:** Application Security. **Two components, both named:**

1. **Threat-model adequacy** — are `TH-001` to `TH-007` and `CTRL-001` to
   `CTRL-007` sufficient for what B3 built?
2. **`CONV-001` residual risk** — separation of duty compares recorded actor
   labels. It proves two records differ; it does not prove two independent
   minds reviewed the work. `CTRL-007` is documentary, not technical.

Also within this reviewer's remit, recorded in `security-re-review.md`: a
session record is only as trustworthy as the commit containing it; the
security checks are textual rather than semantic; the tool reports on a moment
(TOCTOU); `git` is resolved through `PATH`.

| Outcome | What changes |
|---|---|
| ACCEPT | `CONV-001` moves to `ACCEPTED_RISK` with Application Security named as owner; a gate-3 approval record is added to `sdd.json` |
| REJECT — REQUIRE REMEDIATION | `CONV-001` stays `OPEN`; a new task and session are raised under a `CHG-` record to add a technical control; B3 returns to implementation |

### D5 — CONV-003, the bootstrap boundary

**Decision:** ACCEPT / REJECT — REQUIRE REMEDIATION
**Required role:** Product Owner (gate 9, functional limitation)
**Risk:** one session governs the tail of one task out of twelve. The rest
predate the control plane they built.

| Outcome | What changes |
|---|---|
| ACCEPT | `CONV-003` moves to `ACCEPTED_RISK` with the Product Owner named |
| REJECT — REQUIRE REMEDIATION | The phase is re-executed under full session governance from `TASK-001`. In practice this means redoing B3 |

### D6 — CONV-005, agent tests not in CI

**Decision:** ACCEPT the gap / APPROVE the remediation / REJECT both
**Required role:** DevOps / Production Engineering
**Risk:** the agent suite does not run in CI. `validate --all` does apply the
new rules to real artefacts, so a violating artefact is still caught; a
regression in a rule itself is not.

Two ways to close, one decision point:

| Outcome | What changes |
|---|---|
| ACCEPT the gap | `CONV-005` moves to `ACCEPTED_RISK` with DevOps named |
| APPROVE the remediation | This is an **R5 infrastructure approval**. One step is added to `.github/workflows/sdd-validate.yml`, exact text in `ci-integration-audit.md`; `CONV-005` moves to `RESOLVED` |
| REJECT both | `CONV-005` stays `OPEN` and `D10` remains ineligible |

### D7 — CONV-009, sessions predate digest capture

**Decision:** ACCEPT / REJECT — REQUIRE REMEDIATION
**Required role:** Product Owner (gate 9, functional limitation)
**Risk:** all three sessions carry no content digests, so their scope checks
report review warnings rather than a clean result.

| Outcome | What changes |
|---|---|
| ACCEPT | `CONV-009` moves to `ACCEPTED_RISK` with the Product Owner named |
| REJECT — REQUIRE REMEDIATION | New sessions are created for the affected tasks and the work re-verified. Backfilling digests into the existing records is **not** an option: it would fabricate evidence about a past moment nobody can verify |

### D8 — CONV-010, the convergence status model

**Decision:** ADD the status / CONFIRM `OPEN` covers both cases
**Required role:** QA / Release Engineering, which owns the convergence
verdict per the role table in `HUMAN_APPROVAL_GATES.md`.

*A note on that role assignment:* `docs/sdd/` does not explicitly name an
owner for amending its own templates. QA / Release Engineering is the closest
fit by the role table. Confirming who owns SDD template changes is itself
worth doing, and is not resolved here.

**Question:** should the standard gain a `PENDING_RISK_ACCEPTANCE` status, so
a limitation awaiting a signature is distinguishable from one awaiting
engineering work?

| Outcome | What changes |
|---|---|
| ADD | `specs/templates/CONVERGENCE_TEMPLATE.md` gains the status under a `CHG-` record, permitted only where a recommended disposition and a required accepting role are both named; the validator may need a matching rule; `CONV-010` moves to `RESOLVED` |
| CONFIRM `OPEN` is intended | `CONV-010` moves to `NOT_APPLICABLE`; the distinction stays in prose the validator cannot check |

### D9 — Human code review of the B3 change

**Decision:** APPROVE / REQUEST_CHANGES
**Why required:** R3 requires **1 human reviewer**
(`docs/RISK_CLASSIFICATION.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`), and
`AGENTS.md` §8 makes "human review completed at the level required" part of
Done.
**Required role:** any qualified human reviewer who is not the author.

**Currently zero human review exists.** Every record in `execution/` carries
`actorType: "ai"`, and all three review records set `satisfiesHumanGate:
false`. `REV-0002` and `REV-0003` are AI reviews under a distinct actor label;
they satisfy `SDD-V051` separation and they do not satisfy this requirement.

**Scope to review:** `tools/sdd/lib/agent.mjs`, `tools/sdd/cli.mjs`, the
rewritten `ST-002` and `ST-009` in `tools/sdd/tests/validator.test.mjs`, and
`tools/sdd/tests/agent.test.mjs`.

| Outcome | What changes |
|---|---|
| APPROVE | A review record with `actorType: "human"` is added; convergence check 15 can pass |
| REQUEST_CHANGES | A new task and session are raised under a `CHG-` record |

### D10 — B3 convergence acceptance

**Status: NOT YET ELIGIBLE.**

**Decision:** ACCEPT / REJECT convergence of `SPEC-0002`
**Required role:** reviewer (gate 6 at R3)

**Preconditions, all of which must hold first:**

1. `D1` to `D9` are decided and recorded.
2. Every `CONV-` finding is `RESOLVED`, `NOT_APPLICABLE`, or `ACCEPTED_RISK`
   **with a named functional-role owner**.
3. `EVC-015` is resolved, or explicitly determined non-blocking by its owner.
4. `node tools/sdd/cli.mjs validate --all` re-run clean.
5. Both test suites re-run green.
6. **Convergence re-run** and the verdict recomputed. It is `FAIL` today
   because six findings are `OPEN`; it cannot become `PASS` or `PASS WITH
   ACCEPTED LIMITATIONS` until the decisions above change those statuses.

Taking `D10` before its preconditions would record an acceptance of findings
nobody had decided.

## What the remediation and closure passes changed

| | First pass | Now |
|---|---|---|
| B2 validator suite | 53 of 54 | **56 of 56** |
| B3 agent suite | 36 of 36 | **48 of 48** |
| `CONV-006` security allowlist | open | **resolved** |
| `CONV-007` scope attribution | open | **resolved** |
| `CONV-008` unresolvable test shorthand | open | **resolved** |
| `ASES-0001` scope check | 34 errors | **0 errors**, 25 review warnings |
| Findings mislabelled `ACCEPTED_RISK` | 4 | **0** |
| Sessions · verifications · reviews | 1 · 1 · 1 | **3 · 3 · 3** |

## History preserved

| Record | Value | Status |
|---|---|---|
| `ASES-0001` | `PARTIAL` | unedited |
| `REV-0001` | `REQUEST_CHANGES` | unedited |
| `CONV-004` | gate crossing | intact |
| `CONV-006`, `CONV-007` | original findings | intact, with remediation appended |
| `ASES-0003` | two required tests | unedited; annotated, not rewritten |

Resolved findings keep their original text and gain a remediation reference.
Nothing was rewritten to look successful.
