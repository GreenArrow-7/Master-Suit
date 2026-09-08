# Human governance decisions — D1 to D9

**Received:** 2026-09-08 · **Recorded by:** AI, verbatim in substance
**Scope limit stated by the decider:** these apply to Phase B3 only. They are
not production release approval, staging deployment approval, database
migration approval, destructive-operation approval, acceptance of unrelated
Phase A/B limitations, approval of future product features, or approval to
begin Phase B4.

Each decision is recorded independently. None is broadened.

## The decisions as given

| ID | Role exercised | Decision | Recorded in |
|---|---|---|---|
| `D1` | **Product Owner** | APPROVE `SPEC-0002` | `sdd.json` approvals, gate `specification` |
| `D2` | Solution Architect | **Option A** for `EVC-015` | `EVC-015` resolution; six normative documents corrected |
| `D3` | Solution Architect | APPROVE the B3 architecture | `sdd.json` approvals, gate `architecture` |
| `D4` | Application Security | ACCEPT `CONV-001` | `CONV-001` → `ACCEPTED_RISK`; gate `security` |
| `D5` | Product Owner | ACCEPT `CONV-003` | `CONV-003` → `ACCEPTED_RISK`; gate `residualRisk` |
| `D6` | DevOps / Production Engineering | **REQUIRE REMEDIATION** of `CONV-005` | `CHG-004` → `TASK-013` → `ASES-0004` → `VER-0004` → `REV-0005` |
| `D7` | Product Owner | ACCEPT `CONV-009` | `CONV-009` → `ACCEPTED_RISK`; gate `residualRisk` |
| `D8` | QA / Release Engineering | **Option A** for `CONV-010` | `CONVERGENCE_TEMPLATE.md` documents the interpretation; `CONV-010` → `RESOLVED` |
| `D9` | Qualified Human Code Reviewer | APPROVE | `REV-0004`, `actorType: "human"`, `satisfiesHumanGate: true` |

`D10` was explicitly withheld and is **not** recorded.

## Two fields the decider left as placeholders

Stated plainly rather than filled in silently. One has since been clarified.

**Dates.** Every decision carried `Date: [YYYY-MM-DD]`. All records use
**2026-09-08**, the date the decisions were received in this session, and each
record says that is what the date means. No decision date was invented.

**`D1`'s role — clarified 2026-09-08.** The decision text originally read
*"Acting in the role of [Product Owner / Solution Architect]"* without
selecting between them, and I did not choose one. The record then named both
roles and flagged that the specific one was unstated.

The approver has since stated explicitly: *"For D1, I acted as Product Owner
when approving SPEC-0002."* The approval record now names **Product Owner**.

The original approval date and evidence reference are preserved and the
clarification is appended to the evidence reference. **No new approval
decision was created** — only the role field of the existing record was
completed, from an explicit human statement rather than an inference.

## What each decision did and did not authorise

**`D1`** approved the specification. It did not approve the architecture,
accept security risk, authorise DevOps work, or accept convergence. Those are
`D3`, `D4`, `D6` and `D10`, and each was decided separately.

**`D2`** selected Option A: an R3 specification must be approved by a Product
Owner or Solution Architect before implementation begins, with no separate
implementation-readiness approval at R3, and no AI self-approval. Six
governing documents were corrected to stop contradicting that. Nothing
unrelated was touched.

**`D3`** approved the architectural pattern and `tools/sdd/` as the control
plane boundary for Phase B3. It did not approve future architectural expansion
without review.

**`D4`** accepted the `CONV-001` residual risk **with** the compensating
controls named in the decision. Those controls are recorded with the
acceptance, not summarised away.

**`D5`** accepted the bootstrap boundary and required that all future
applicable work use the approved session process. It explicitly forbade
retroactive sessions. None was created.

**`D6`** did **not** accept the CI gap. It required remediation, which
supplied the R5 infrastructure authorisation `CL-005` had named and left open.
The remediation was performed under change control and is verified
repository-locally only.

**`D7`** accepted the historical digest limitation and required digest capture
for future sessions. `ASES-0004` is the first session created under that
requirement.

**`D8`** confirmed `OPEN` as the canonical pre-acceptance status and added no
new status. B3 did not extend B1's vocabulary for its own convenience.

**`D9`** is a human code-review decision only. No findings were stated by the
reviewer, so none are recorded. `REV-0004` contains no invented review
comments.

## What is still not approved

Production release. Staging deployment. Database migration. Phase B4. Future
product features. Future architectural expansion. And `D10`, convergence
acceptance, which the decider explicitly withheld.

---

## Addendum decisions, 2026-09-08

Three further human decisions, recorded to their stated scope and no wider.

| Decision | Role exercised | Outcome | Recorded in |
|---|---|---|---|
| `D9` addendum | Qualified Human Code Reviewer | APPROVE | `REV-0009`, `actorType: "human"`; `CONV-015` → `RESOLVED` |
| `CONV-012` | Product Owner | ACCEPT RISK | `CONV-012` → `ACCEPTED_RISK`; `sdd.json` gate `residualRisk` |
| `CONV-014` | Product Owner | ACCEPT RISK | `CONV-014` → `ACCEPTED_RISK`; `sdd.json` gate `residualRisk` |

### What each did and did not authorise

**The `D9` addendum** approved the post-`D9` control-plane changes only: the
exception mechanism, `SDD-V059`, `SDD-V060`, the verdict parser and their
tests. `REV-0004` is **not replaced** — both reviews stand, covering the
pre-`D9` and post-`D9` plane respectively.

The decision supplied was `APPROVE` with no findings stated. **None are
recorded and none were invented.** `CONV-015` moved to `RESOLVED`, not to
`ACCEPTED_RISK`: a completed review is not a residual risk.

**`CONV-012`** accepted the `ASES-0004` scope deviation as a historical
execution-process risk, scoped to `CONV-012` only. The accepting role stated
explicitly that it **does not authorise future scope violations** and **does
not permit agents to widen task scope after detecting an out-of-scope change**.
`ASES-0004` and `VER-0004` remain `PARTIAL`; the `SDD-V046` occurrence is
untouched.

**`CONV-014`** accepted the `TASK-017` bootstrap as a narrowly scoped
historical risk, **non-precedential**, scoped to `CONV-014` only. It does not
authorise future work outside session governance, bypassing a failed
preflight, arbitrary exception creation, retroactive session fabrication, or
weakening `SDD-V059` or `SDD-V060`. **No retroactive session was created.**

### Still not approved

`D10`, convergence acceptance. Production release. Staging deployment.
Database migration. Phase B4. Future product features. Future architectural
expansion.

`D10` is now **eligible** and has **not been taken**.

---

## D10 — final human convergence acceptance, 2026-09-08

| | |
|---|---|
| Decision | **ACCEPT** |
| Verdict accepted | `PASS WITH ACCEPTED LIMITATIONS` |
| Gate | 6, convergence acceptance |
| Role exercised | **reviewer** |
| Recorded in | `sdd.json` gate `convergence`; `convergence.md` header |

### Gate-6 role verification

The decision text left the role as a placeholder instructing that the exact
functional role required by gate 6 be inserted. **It was resolved by lookup,
not by inference**, because gate 6 admits exactly one answer at R3:

> `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 6 — "R0–R2: author. **R3: reviewer.**
> R4: Application Security … R5: QA / Release Engineering and Human Release
> Authority."

> `docs/sdd/RISK_TO_PROCESS_MATRIX.md`, "Convergence verdict accepted by" —
> R3: **reviewer**.

Two authoritative sources, one answer, no choice to make. This differs from
`D1`, where the placeholder offered a genuine choice between two roles and was
left unresolved until the approver stated which one they had exercised.

The accepting statement itself named the role in prose — *"Acting in the human
role authorized by the Phase B3 convergence-acceptance gate"* — so what was
resolved was the standard's name for it, not the identity of the approver.

**Note on the standard, not a conflict.** "reviewer" is not one of the six
enumerated functional roles in the role table, which assigns "convergence
verdict" to QA / Release Engineering. Gate 6 names the heavier roles
explicitly at R4 and R5 and deliberately uses the lighter "reviewer" at R3.
That reads as intended risk gradation rather than a contradiction, so no
evidence conflict was raised.

### What this acceptance covers

Phase B3 convergence, and nothing else. Explicitly **not**: production release
approval, staging or production deployment, migration approval,
destructive-operation approval, acceptance of unrelated Phase A/B production
unknowns, approval of a future product feature, automatic authorisation to
begin Phase B4, or waiver of any accepted-risk compensating control.

### What was not changed by it

No `ACCEPTED_RISK` finding became `RESOLVED`. The five limitations —
`CONV-001`, `CONV-003`, `CONV-009`, `CONV-012`, `CONV-014` — remain accepted
limitations with their owners, scopes, rationales and compensating controls
intact.

`ASES-0001` and `ASES-0004` remain `PARTIAL`. `VER-0004` remains `PARTIAL`.
`REV-0001` remains `REQUEST_CHANGES`. `EXC-001` remains in force and its
condition is still reported at `INFO` on every run.

### Lifecycle

`IMPLEMENTING` → `VERIFYING` → `CONVERGED`. Both transitions are legal under
`docs/sdd/SPEC_LIFECYCLE.md`; `IMPLEMENTING` → `CONVERGED` directly is not,
and was not used.

`SPEC-0002` is now `CONVERGED`. It is **not** `READY_FOR_RELEASE` and not
`RELEASED`; neither was sought and neither is authorised.
