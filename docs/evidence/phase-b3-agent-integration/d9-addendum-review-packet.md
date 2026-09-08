# D9 addendum — human code review packet

**Prepared for:** a qualified human reviewer who is not the author
**Date:** 2026-09-08 · **Prepared by:** AI · **Status: PENDING**

**This is a packet, not a decision.** No `APPROVE` is recorded here and none
may be recorded by an agent.

## Why an addendum

`D9` was decided on 2026-09-08 and covered the control plane as it stood
**before** `TASK-014` through `TASK-017`. Four tasks have since changed
governance trust-boundary tooling, including a mechanism that can downgrade a
validator ERROR.

The original `REV-0004` is **not replaced**. It remains the record of what was
reviewed then. This addendum covers only what came after.

## Scope — what is new since D9

| File | Lines | What changed |
|---|---|---|
| `tools/sdd/lib/exceptions.mjs` | 129 | **New.** The entire exception mechanism |
| `tools/sdd/lib/traceability.mjs` | 160 | Exact verdict matching replaced prefix matching |
| `tools/sdd/lib/approvals.mjs` | 126 | Specification-approval validation added |
| `tools/sdd/lib/validate.mjs` | 520 | `SDD-V059`, `SDD-V060`, `SDD-V061`, exception application |
| `tools/sdd/rules/rules.mjs` | 94 | Three rules added |
| `tools/sdd/tests/validator.test.mjs` | 943 | 33 tests added |
| `docs/sdd/validation-exceptions.json` | 26 | **New.** The machine register, holding `EXC-001` |
| `tools/sdd/tests/fixtures/valid/specs/SPEC-0004-approval-example/` | — | **New.** R3 fixture |

Also in scope: `SDD-V059` and `SDD-V060` logic, late-approval ordering,
duplicate and ambiguous verdict handling, the exception negative fixtures, and
the `TASK-016` invariant test.

## The one file that matters most

`tools/sdd/lib/exceptions.mjs` can turn an `ERROR` into an `INFO`. Everything
else in this packet is ordinary validation logic; this is a control-bypass
surface and deserves the reviewer's attention first.

Read `exceptionProblem()` and ask whether any input reaching it could produce
`null` when it should not.

## Thirteen review questions, with what the evidence currently shows

These are AI analysis prepared for the reviewer. **They are not human
findings**, and the reviewer should verify rather than inherit them.

| # | Question | Evidence | Reviewer verifies |
|---|---|---|---|
| 1 | Can one exception suppress another rule? | `UT-037` — exception for `SDD-V059` leaves `SDD-V060` at ERROR | exact `ruleId` match in `exceptionFor()` |
| 2 | Can one exception suppress another specification? | `UT-038` — exception naming `SPEC-0003` leaves it at ERROR | exact `specId` match, no prefix or pattern |
| 3 | Can malformed input fail open? | `UT-040` — eight malformed shapes, each fails closed and raises `SDD-V061` | every branch of `exceptionProblem()` returns a reason |
| 4 | Can `actorType: "ai"` approve an exception? | `UT-045` — rejected | the check is on the record, not the caller |
| 5 | Can an unsupported role approve one? | `UT-041` — Product Owner, QA, Intern and empty all rejected | `EXCEPTION_APPROVER_ROLES` is Solution Architect and Application Security only |
| 6 | Can a wildcard scope bypass enforcement? | `UT-040` — `SPEC-*` rejected by `^SPEC-\d{4}$` | no glob, regex or list is accepted in `specId` |
| 7 | Is the original finding still visible? | `UT-036` — severity `INFO`, rule id kept, message preserved, prefixed `EXCEPTED under EXC-900` | nothing is deleted from the finding set |
| 8 | Does the validator hard-code `SPEC-0002` or `EXC-001`? | `UT-045` asserts neither literal appears in `exceptions.mjs`. A repository-wide scan finds both ids **only inside comments**; **no executable line** in any library, rule or CLI file references either | read the comments and confirm they are provenance notes, not logic |
| 9 | Does a future R3 late approval still fail? | `UT-044` — synthetic R3, late approval, no exception → `SDD-V060` ERROR, result FAIL | the rule is not conditioned on the register |
| 10 | Can `PASS WITH ACCEPTED LIMITATIONS` collapse to `PASS`? | `UT-019`, `UT-025` — exact match; verified live: returns itself | prefix matching is gone from `convergenceVerdict()` |
| 11 | Can multiple verdict declarations create ambiguity? | `UT-025` — conflicting duplicates return `AMBIGUOUS`, which fails the enum check; agreeing duplicates do not | `declaredVerdicts()` collects all, not the first |
| 12 | Is `SDD-V059` distinct from `SDD-V060`? | `UT-035` — different titles, both ERROR; a missing approval raises `V059` only, never `V060` | presence and ordering are separate concerns |
| 13 | Do R4/R5 implementation gates still work? | `UT-035` — removing the implementation approval from the R4 fixture still raises `SDD-V020` and **not** `SDD-V059` | `requiresImplementationApproval` still returns true for R4 and R5 only |

## Limitations the reviewer should weigh, not rediscover

Recorded in `security-re-review.md` and not hidden:

- **An exception is only as trustworthy as the commit containing it.** The
  record is a structured claim in a file anyone who can commit can write.
  Nothing proves the named Solution Architect approved anything.
- **A lapsed exception does not self-expire.** Expiry is enforced by `status`,
  not by the clock, because the validator must stay deterministic. A human
  must review and flip it — rule 8 of the standard.
- **Two registers, unchecked against each other.**
  `docs/sdd/VALIDATION_EXCEPTIONS.md` is the authority and
  `validation-exceptions.json` is what the validator reads. Nothing verifies
  they agree.

## Allowed decisions

| Decision | What happens next |
|---|---|
| APPROVE | An addendum review record is added under `execution/` with `actorType: "human"`; this input to `D10` is satisfied |
| REQUEST_CHANGES | A `CHG-` record, a scoped task, a session, and re-review. `D10` stays ineligible |
| BLOCKED | The blocker is recorded as a convergence finding; `D10` stays ineligible |

## How it will be recorded

Only what the reviewer actually says. If the statement is *"I reviewed the
listed post-D9 changes and approve"*, that is what the record carries — no
invented findings, no elaborated rationale.

Required: reviewing role, scope reviewed, decision, date, evidence reference.
