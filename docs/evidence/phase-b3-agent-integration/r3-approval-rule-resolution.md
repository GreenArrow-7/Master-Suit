# R3 approval rules — two questions, one answered

**Phase:** B3 convergence · **Date:** 2026-09-07
Two questions were tangled together in the first B3 report. They have
different answers and are separated here.

| | Question | Answer |
|---|---|---|
| **A** | Does R3 require an **implementation-readiness** approval? | **No. Unambiguous** — seven sources, no dissent |
| **B** | Who may approve an **R3 specification**? | **Unsettled.** `EVC-015` is OPEN |

Nothing in this document resolves question B, and no statement here should be
read as saying the R3 approval position as a whole is settled. It is not.

## Question A — implementation-readiness approval

**Not required at R3.** The B2 evidence statement was correct and the B3
report statement was wrong.

### The seven sources, quoted

| Source | Statement |
|---|---|
| `docs/RISK_CLASSIFICATION.md` | "An AI agent may prepare any level, and may execute R0–R3 locally. R4 requires a human to accept the plan before implementation." |
| `docs/sdd/RISK_TO_PROCESS_MATRIX.md` | Row "Approval before implementation may start": `—` at R0–R3, "required, human" at R4 and R5. Row "Agent may execute": "yes" at R3 |
| `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 5 | "Implementation readiness — permission to start writing code. Required at R4 and R5." |
| `docs/sdd/SPEC_LIFECYCLE.md` | Entry to `APPROVED_FOR_IMPLEMENTATION` requires "human approval is recorded **where the risk level requires it**"; "For R4 and R5 an AI agent may not enter this state on its own judgement" |
| `docs/sdd/SDD_WORKFLOW.md` | Its risk table places "**human approval before implementation**" at R4. The R3 row reads "Full specification, plan, test plan, traceability, review" and omits it |
| `docs/sdd/CHANGE_WORKFLOW.md` | "At R4 and R5 that approval is human and is recorded before any code is written." R3 is not named |
| `tools/sdd/lib/lifecycle.mjs` | `requiresImplementationApproval(risk)` returns true for `R4` and `R5` only |

Seven sources, no disagreement on this question, and the implementation matches
the documentation. No document was found that places an
implementation-readiness gate at R3.

## Question B — specification-approval authority

**Unsettled, and deliberately left so.**

`docs/sdd/HUMAN_APPROVAL_GATES.md` gate 1 and
`docs/sdd/RISK_TO_PROCESS_MATRIX.md` place R3 specification approval with the
Product Owner or Solution Architect. Gate 5 of the same document says that at
R0–R3 **the author** proceeds once the required artefacts exist. At R3 those
select different approvers.

Six of the nine governing documents defer or are silent, including
`docs/RISK_CLASSIFICATION.md`, the authoritative risk model, whose rigour
table has no specification-approval row at all.

The full audit — Evidence A, Evidence B, authority level per document,
material impact, current conclusion and the required human decision — is
`EVC-015` in `docs/EVIDENCE_CONFLICTS.md`. It is OPEN and this pass did not
close it.

**This phase operated under the stricter reading**, treating the gate as
required and therefore as crossed, and recorded `CONV-004`. That is a
statement about what B3 did, not a finding about which reading is correct. If
a human selects the other reading, `CONV-004` should be reassessed.

## Which earlier statement was wrong

The Phase B2 evidence said *"R3 does not require an implementation-gate
approval."* **Correct.**

The Phase B3 report said, in prose, that the instruction to build was *"not a
Product Owner approval, an architecture approval, or a security risk
acceptance"* alongside the claim that **"every approval gate is unresolved"**.
The list of gates was right; the blanket phrase was wrong, because two of the
gates in question are not required at R3 at all and cannot be unresolved.

`spec.md` itself was accurate throughout: its gate table has recorded
"Implementation readiness — not required at R3 — gate applies at R4/R5 only"
since it was written. The error was in the summarising prose, not the
specification. The evidence files that repeated the blanket phrase are
corrected in this pass.

## Did the bootstrap cross a required gate?

**Not the implementation gate — there is none at R3.** The agent was
permitted to execute. `AGENTS.md` and the risk model both allow it.

**The specification-approval gate: depends on `EVC-015`.** `SPEC-0002`
entered `APPROVED_FOR_IMPLEMENTATION` with no Product Owner or Solution
Architect approval recorded. Whether that crossed a required gate is precisely
the question `EVC-015` leaves open:

- Under gate 1 and the risk matrix, it did, and `CONV-004` is a real
  governance deviation.
- Under gate 5's "at R0–R3 the author proceeds" clause, it did not, and
  `CONV-004` largely dissolves.

B3 recorded it as a deviation, because acting as though the looser reading
applied would have been an agent excusing itself. The recording is in
`spec.md`, in the manifest's status history at the point of transition, and as
`CONV-004`. No retroactive approval was fabricated and the approvals array is
empty. **It is a conservative posture pending a decision, not a determination
that the gate was required.**

**Does it prevent B3 acceptance?** Convergence cannot be accepted while it is
open, and at R3 convergence acceptance is a reviewer's (gate 6), separately
unresolved. A human can resolve `EVC-015` and `CONV-004` together with the
deviation visible. What no artefact in this phase does is treat the work as
accepted.

## On not resolving question B by counting

An earlier draft of this document observed that two statements side with gate
1 against one for gate 5, and inferred that gate 5's clause was probably
over-broad. **That inference has been withdrawn.**

A two-to-one tally is not an authority argument. The document that would
settle the question, `docs/RISK_CLASSIFICATION.md`, does not address
specification approval at all, so there is no authoritative tie-break to
appeal to. `EVC-015` now presents both interpretations and what each would
mean for a future agent, and selects neither.

Choosing the stricter reading because it is stricter would be the mirror image
of the failure this register exists to prevent: an agent settling a governance
question by picking the interpretation that suits its own narrative. B3 had to
act, so it acted conservatively and said so. That is not the same as deciding.

## Corrections made as a result

Under `CHG-002`, two entries in the `spec.md` approval table were made
**stricter**, not softer:

- **Security risk acceptance** was recorded as "not required at R3, threat
  model produced voluntarily". Gate 3 is triggered whenever a threat model is
  required; this specification implements security controls and carries six
  `SEC-` requirements, so the threat model was required. Now recorded as
  required and unresolved.
- **Architecture approval** was recorded as unresolved with no basis. Gate 2
  applies at R3 when a new pattern is introduced, and the agent execution
  record is one. Now recorded as required, with the basis stated, and
  unresolved.

## Corrected gate status for `SPEC-0002`

| Gate | Required at R3 | Status |
|---|---|---|
| 1. Specification approval | **subject to `EVC-015`** | **UNRESOLVED** — crossed under the reading B3 applied |
| 2. Architecture approval | yes, a new pattern is introduced | **UNRESOLVED** |
| 3. Security risk acceptance | yes, a threat model was required | **UNRESOLVED** |
| 4. Data model / migration | no, no schema change | not applicable |
| 5. Implementation readiness | **no, R4 and R5 only** | **not required** |
| 6. Convergence acceptance | yes, reviewer | **UNRESOLVED** |
| 7. Production release | no, nothing is released | not applicable |
| 8. Emergency change | no | not applicable |
| 9. Accepted residual risk | yes, one per open limitation | **UNRESOLVED** |

Five gates require a human and are unresolved; whether gate 1 was required
*before implementation* is itself Decision 2. One is not required at R3 and
cannot be unresolved. Three do not apply.

That is the precise picture the phrase "every approval gate is unresolved"
obscured, and it is also why "the R3 approval rule is settled" would be just
as wrong in the other direction. **Question A is settled. Question B is not.**
