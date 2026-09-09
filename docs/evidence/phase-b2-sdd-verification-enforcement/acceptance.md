# Phase B2 — formal acceptance record

Subject: Phase B2, SDD Verification and Enforcement, for YOUHAN ONE /
Master Suite.
Repository state: commit `f16ed67`, branch `dev/yourhan-next`.
Verified 2026-09-07 against the current repository. No production or staging
system was accessed.

## Verdict

**PASS WITH KNOWN LIMITATIONS**

The B1 rules are now machine-checkable: 41 rules, a deterministic validator
using only the Node standard library, 54 passing tests including 32 negative
fixtures each proving a specific rule fires. An AI cannot structurally satisfy
a human-required gate. Application behaviour was untouched.

The limitations are real and named: the validator checks structure and not
quality; an approval record proves a record exists, not that a human decided;
and the CI workflow, though applied, has never actually run.

## Scope change after convergence, 2026-09-07

After `SPEC-0001` reached `CONVERGED`, the requester authorised the CI workflow
that had been out of scope. It was applied under `CHG-001` as a `SCOPE CHANGE`,
with the specification returning
`CONVERGED -> IMPLEMENTING -> VERIFYING -> CONVERGED` rather than being edited
in place. No approved requirement changed. `CONV-001` moved from
`ACCEPTED_RISK` to `RESOLVED`, so the convergence verdict for `SPEC-0001` is
now `PASS`. Two tests were added, taking the suite from 52 to 54.

The phase verdict stays **PASS WITH KNOWN LIMITATIONS**, because the
limitations in `known-limitations.md` are unaffected by the CI change.

## What this verdict does not mean

Not a production certification. Not a resolution of any Phase A unknown. Not
evidence that every existing code change has a specification. Not a
demonstration that the process works on a real product feature. Not the
completion of Phase B.

## Definition of Done

| Requirement | Result |
|---|---|
| B2 governed by an internal specification | MET — `SPEC-0001`, R3, ten artefacts including a change record |
| Machine-readable SDD contract exists | MET — `docs/sdd/MACHINE_CONTRACT.md` |
| Manifest schema exists | MET — JSON Schema 2020-12 |
| Validator rule ids documented | MET — 41 rules, two-way agreement |
| Deterministic validator exists | MET — byte-identical repeat runs |
| Human-readable output | MET |
| JSON output | MET — stable field set, sorted, no timestamps |
| Exit codes correct | MET — 0, 1, 2, each tested |
| R1 / R2 / R4 validation works | MET — one valid fixture each |
| Invalid fixtures fail | MET — 32 of 32 with the expected rule |
| Human approval mechanically distinguishable | MET — approvals and reviews are separate structures |
| AI cannot satisfy a human gate | MET — `SDD-V022`, tested |
| Lifecycle transitions validated | MET — `SDD-V018`, `SDD-V019` |
| Artefact requirements validated by risk | MET — status-aware |
| Requirement ids validated | MET — `SDD-V014`, `SDD-V015`, `SDD-V016` |
| Traceability validated | MET — five rules |
| Convergence structure validated | MET — `SDD-V031`–`SDD-V033` |
| EVC references validated | MET — `SDD-V035`, `SDD-V036` |
| Exceptions have a formal process | MET — `docs/sdd/VALIDATION_EXCEPTIONS.md` |
| Validator security review completed | MET — 12 concerns, no blocking defect |
| Validator tests pass | MET — 54 of 54 |
| B2's own spec passes the validator | MET — after fixing both the artefacts and one validator defect |
| Current repository SDD artefacts pass | MET — `errors=0`, exit 0 |
| CI validation exists **or** a documented justified blocker | MET — `.github/workflows/sdd-validate.yml` applied under `CHG-001`; read-only, no secrets, cannot deploy or reach production |
| Pre-SDD work not falsely rejected | MET — 36 modified application files, zero errors |
| Application behaviour unchanged | MET |
| Dependencies unchanged | MET — no manifest or lock file touched |
| Migrations unchanged | MET — 65 at HEAD and 65 in the tree |
| Production configuration unchanged | MET |
| No secret values in B2 artefacts | MET |
| No product pilot implemented | MET |

## Change integrity

| Category | Result |
|---|---|
| Application source and tests | unchanged |
| Dependencies and lock files | unchanged |
| Prisma schema and migrations | unchanged |
| `.github/` | one workflow added; `ci.yml`, `deploy.yml`, `build-images.yml` unchanged |
| `apps/web/infra/`, `infrastructure/`, `apps/web/scripts/` | unchanged |
| Environment files | unchanged, none read |
| Pre-existing UI redesign | 36 entries preserved untouched |

## Answers to the acceptance questions

**Can Phase B2 be formally accepted?** Yes, with the limitations recorded.
Every Definition-of-Done item is met, including CI enforcement, which is now
applied rather than deferred.

**Are the B1 SDD rules now machine-checkable?** Yes, for structure,
presence, consistency and reference integrity. Not for quality, which was
never claimed and is stated as out of scope.

**Does the validator fail correctly on invalid artefacts?** Yes. 32 negative
fixtures, each emitting its specific rule. One rule was found inert during
this verification and was fixed rather than excused.

**Can an AI structurally self-approve human-required work?** No.
`actorType: "ai"` cannot satisfy any of the nine gates. The residual risk is
that anyone with commit access can write a `human` record; that is `TH-005`,
accepted, and it needs branch protection rather than tooling.

**Is current enforcement safe for the brownfield repository?** Yes. 38 of 41
rules can only fire on artefacts created by the SDD system. The one rule that
could touch legacy work is advisory, and the validator reports zero errors
against a working tree containing 36 uncommitted application changes.

**Was application behaviour untouched?** Yes.

**Is YOUHAN ONE ready for Phase B3?** Yes.

**What must happen before code-without-spec becomes blocking?** The five
conditions in `docs/sdd/ENFORCEMENT_STANDARD.md` §6: a completed real pilot,
approval roles assigned to people, CI enforcement green for a sustained
period, an agreed legacy boundary, and a recorded Product Owner and DevOps
approval. None holds today.

**What must happen before the first real product pilot?** Push so the CI job
actually runs and is proven green on Linux; confirm branch protection so a red
check cannot be merged past (GAP-CI-01); assign the six approval roles to
people; add negative fixtures for the four untested rules; choose a genuinely
low-risk R2 feature; and expect the process to need revision from what the
pilot exposes.

## Signature block

Prepared by: AI agent under `AGENTS.md` §7, which permits an agent to prepare
and recommend but not to approve. This is a recommendation for human
acceptance. The convergence verdict for `SPEC-0001` is likewise pending a
reviewer, because at R3 an agent does not accept its own convergence.

Human acceptance: _pending_
Accepted by: ______________________  Date: ______________

## Evidence Sources

E1: the 28 files of this package; validator and test runs at commit `f16ed67`.
E3: `tools/sdd/tests/validator.test.mjs`, 54 of 54.
E4: `specs/SPEC-0001-sdd-verification-enforcement/`, `docs/sdd/**`.
Unverified: everything in `known-limitations.md`.
