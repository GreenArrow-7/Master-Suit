# 10 — Human pilot-selection decision

> **SUPERSEDED by `13`.** `PC-01` is ineligible pending `EVC-016`; the
> recommended candidate is now `PC-02`.

**Phase:** B4.0 · **Date:** 2026-09-08 · **Status: PENDING**

**Nothing is selected. No agent may select the first pilot.**

## Decision

**Select the first B4 controlled pilot.**

## Eligible candidates

`PC-01`, `PC-02`, `PC-03`, `PC-04`, `PC-05`

All five pass the first-pilot exclusion check: none touches authentication,
authorization, tenant isolation, billing, secrets, production infrastructure,
destructive migrations, external financial systems, destructive data
modification, or release architecture.

## Recommended candidate

**`PC-01`** — consolidate the drifted client-side CSV encoders onto the
hardened `src/lib/csv.ts`.

Scoped to `people/attendance`, `people/compliance`, `people/work-locations`.
`people/face-activity` **excluded** and proposed as separate follow-on work.

## Recommended risk class

**R3**, on the reading set out in `06-risk-classification.md`.

**This needs settling before implementation.** If the Solution Architect reads
`docs/RISK_CLASSIFICATION.md`'s "PII/biometric handling" as triggered by
re-encoding a PII-bearing export, `PC-01` is **R4** and is disqualified as
pilot #1 under this phase's own rules. The fallback is then `PC-02`.

## Human decision options

| Option | Consequence |
|---|---|
| **SELECT `PC-01`** | `SPEC-0003` is created for it; the R3 gate set applies |
| **SELECT ANOTHER CANDIDATE** | Name `PC-02`, `PC-03`, `PC-04` or `PC-05`; the gate set follows its class |
| **REQUEST MORE ANALYSIS** | Name what is missing — more candidates, a different product area, deeper risk work |
| **REJECT ALL CANDIDATES** | No pilot begins; the B4.0 output stands as a readiness record |

## Two things to decide alongside the selection

**1. The R3/R4 reading for `PC-01`** — Solution Architect. Only needed if
`PC-01` is selected, and it changes the required gate set.

**2. Whether `people/face-activity` follows separately** — Product Owner.
Excluding it is a scoping decision, not a judgement that it does not matter.
The same defect is present there.

## What happens after selection

```text
human selects the pilot
        ↓
SPEC-0003 created  (NEXT AVAILABLE SPEC ID — reserved, not created)
        ↓
clarifications → plan → threat model where required → test plan → tasks
        ↓
specification approval, by the role the risk class requires
        ↓
preflight → agent session → bounded implementation
        ↓
scope check → verification → independent review → traceability → convergence
```

**`SPEC-0003` has not been created.** Creating a specification for a candidate
nobody chose would let an AI recommendation become authoritative product scope
by default, which is exactly what this decision point exists to prevent.

## Recorded

| | |
|---|---|
| Decision | **PENDING** |
| Selected candidate | **none** |
| Decided by | **nobody** |
