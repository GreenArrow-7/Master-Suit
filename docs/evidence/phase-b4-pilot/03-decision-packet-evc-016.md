# Decision packet — EVC-016 (PII export formatting as an R4 trigger)

| Field | Value |
|---|---|
| Evidence conflict | `EVC-016` — whether export formatting of already-authorised PII is an R4 trigger |
| Severity | `C2` · non-blocking for release, blocking for classification |
| Resolution owner | **Solution Architect**, with **Application Security** consulted |
| Prepared | 2026-09-08 by AI agent, Planner role |
| Status | **OPEN — not decided here** |

`EVC-016` in `docs/EVIDENCE_CONFLICTS.md` states the conflict, the evidence on
both sides and the material impact. That record is not repeated here. **This
packet adds only the thing it does not contain: the decision options and their
consequences.**

This is prepared, not decided. It is deliberately **not** bundled with the
`SPEC-0003` packet — different question, different owners, different urgency.

---

## The question in one sentence

Does changing *how* PII is formatted in an export the caller is already
authorised to download count as "PII handling", and therefore trigger `R4`?

Three kinds of change share those four words in the `R4` row, and no governing
document distinguishes them:

- **A** — access control over PII (who may export)
- **B** — new collection or new disclosure of PII (a new field, a new flow)
- **C** — transformation or formatting of PII the caller may already read

**A** and **B** are uncontroversially `R4`. **C** is the question.

## Why it needs deciding

It decides the gate set for a live candidate. `PC-01` — consolidating four
drifted client-side CSV encoders across three HR pages, where only some apply
the formula-injection guard — is category **C** exactly.

| | If **C** is `R3` | If **C** is `R4` |
|---|---|---|
| Specification approval | Product Owner **or** Solution Architect | Product Owner **and** Solution Architect |
| Threat model | if security-sensitive | **required** |
| Security review | self-check, flag authz | **Application Security, mandatory** |
| Security tests | not required as such | **a `tests/security` case proving the boundary** |
| Implementation-readiness approval | not required | **required, human, before implementation** |
| Human code review | 1 reviewer | **2 reviewers, one security-literate** |
| First-pilot eligible? | **Yes** | **No** — this phase excludes `R4` from first-pilot |

`PC-01` scored highest of the five candidates in B4.0 and was **not** selected
because of this conflict. It was not downgraded to preserve its eligibility.

## Options

| | Option | Consequence |
|---|---|---|
| **(a)** | **C is not an R4 trigger.** Qualify the `R4` row to "PII *access, collection or disclosure* changes" | `PC-01` becomes `R3` and first-pilot eligible. Risk: a formatting change *is* how CSV injection reaches a spreadsheet, so a real security defect class sits in `R3` |
| **(b)** | **C is an R4 trigger.** Qualify the `R4` row to say formatting and re-encoding count | `PC-01` becomes `R4`, needs the full security gate set, and is permanently ineligible as a *first* pilot. Risk: every cosmetic export tweak inherits mandatory Application Security review |
| **(c)** | **Split by security relevance.** C is `R3` by default, but `R4` when the formatting change is itself a security control — escaping, sanitisation, injection guards | Fits `PC-01` precisely: the formula-injection guard is a security control, so `PC-01` is `R4` on its merits, while renaming a column header stays `R3`. Costs one extra sentence of governance text |

## Framing, not a recommendation

**(c)** is the only option that distinguishes the two things option (a) and
option (b) each collapse — a security control that happens to live in a
formatter, versus formatting that carries no control. It is offered because
the conflict record shows the artefacts never drew that line, not because an
agent should choose it. **The Solution Architect decides.**

Note that under **(c)**, `PC-01` is `R4` and stays ineligible as a first
pilot — so (c) does **not** unblock `PC-01` for that role. It unblocks
`PC-01` as *work*, with the correct gate set.

## What is explicitly not proposed

Deciding this to make `PC-01` eligible. The B4.0 reconciliation already
declined to resolve the ambiguity downward, and that reasoning stands.

## Affected documents, once decided

`docs/RISK_CLASSIFICATION.md` (the `R4` row),
`docs/sdd/RISK_TO_PROCESS_MATRIX.md` (escalation triggers),
`docs/security/SECURITY_MODEL.md` (sensitive data categories).

`EVC-016` then moves to the resolved section with its original disagreement
preserved and a `RESOLUTION` block recording who decided and what changed.

## Relationship to the current pilot

**None, and deliberately so.** `SPEC-0003` / `PC-02` touches no PII, no
export and no security control. This packet is for a separate sitting and does
not block the pilot.
