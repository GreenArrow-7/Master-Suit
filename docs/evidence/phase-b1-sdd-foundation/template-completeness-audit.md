# Template completeness audit

Eleven templates required, eleven present, each checked against the fields the
Phase B1 brief specifies.

| Template | Required fields present | Notes |
|---|---|---|
| `SPEC_TEMPLATE.md` | **all 25 mandatory sections** plus the metadata block (ID, Title, Status, Risk, Owner, Created, Last updated, Supersedes, Superseded by) | Separates what/why from how in its header; `Implementation Constraints` is explicitly limited to genuinely mandatory constraints; `Open Questions` blocks progression; `Evidence / Existing-System References` requires claim classification; `Approval` table covers four gates |
| `CLARIFICATION_TEMPLATE.md` | Question, Why it matters, Possible interpretations, Recommended interpretation, Decision, Decision owner, Status, Affected requirements | Carries the full 16-item ambiguity checklist as tick-boxes so a reviewer can see what was *not* asked; the five statuses match the standard |
| `PLAN_TEMPLATE.md` | All 25 plan sections from `PLAN_STANDARD.md` | `AD-` block requires Decision, Reason, Alternatives, Trade-offs, Requirements supported |
| `THREAT_MODEL_TEMPLATE.md` | Asset, Trust boundary, Threat actor, Threat, Attack path, Preconditions, Impact, Existing controls, Required controls, Verification, Residual risk, Status | Uses `TH-` and `CTRL-`; traces to `SEC-` requirements, tests and tasks; states proportionality so R1 cosmetic work does not require it; forbids publishing a working exploit path |
| `TEST_PLAN_TEMPLATE.md` | Test ID, Type, Requirements, Purpose, Preconditions, Input, Expected outcome, Negative case, Security relevance, Automation status | Supports UT, IT, E2E, ST, PT, REG; has all 11 required coverage sections including tenant isolation, concurrency, retries and external dependency failure; requirement-coverage table forces "none" rather than omission |
| `TASKS_TEMPLATE.md` | Task ID, Purpose, Requirements, Dependencies, Allowed scope, Expected files/components, Required tests, Security implications, Data/migration implications, Definition of Done, Status | Names the three scope-failure modes explicitly |
| `TRACEABILITY_TEMPLATE.md` | The six-column matrix plus acceptance-criteria and security views | Ten gap checks that must be able to fail; anti-gaming rule stated |
| `CONVERGENCE_TEMPLATE.md` | All 14 required checks plus a fifteenth for `AGENTS.md` §8 | `CONV-` findings with the four statuses; three verdicts; unrequested-behaviour section; verification summary table |
| `CHANGE_RECORD_TEMPLATE.md` | Change, Reason, Requested by, Affected requirements, Affected plan, Affected tests, Security impact, Migration impact, Compatibility impact, Risk change, Approval required, Approval status, Date | Adds Change type from the seven defined; a "when this is the wrong artefact" section routing to new-spec, EVC or revision history |
| `BUG_TEMPLATE.md` | BUG ID, Title, Risk, Observed, Expected, Reproduction, Affected requirement/spec, Root cause, Security impact, Data impact, Regression test, Fix scope, Verification, Status | Forces the three-way outcome on affected requirement; requires the regression test to fail against unfixed code |
| `EMERGENCY_CHANGE_TEMPLATE.md` | Reason normal process cannot be followed, blast radius, rollback, monitoring, explicit human authorisation, post-change validation, retrospective, reconciliation | Authorisation table precedes application; reconciliation checklist is mandatory to close |

## Cross-checks

- **Every identifier used in a template is defined** in
  `docs/sdd/IDENTIFIER_STANDARD.md`. 22 prefixes used, 22 defined, zero
  orphans.
- **Every template points at its governing standard** in its header comment,
  so a user filling one in can reach the rules.
- **No template contains a real specification.** `SPEC-NNNN` and
  `SPEC-0001-short-slug` appear as placeholders only; no `specs/SPEC-0001-*`
  directory exists.
- **Statuses match their standards.** Clarification statuses, task statuses,
  convergence finding statuses, threat statuses and bug statuses each match
  the document that defines them.

## Post-B1 correction pass (2026-09-07)

Two templates gained R1 guidance so that the single storage model is visible
at the point of use rather than only in the standards:

- `SPEC_TEMPLATE.md` — a header note stating that at R1 the template still
  lives in a `SPEC-NNNN` directory, used in lightweight form with seven
  sections filled and the rest deleted; and that R0 gets no directory at all.
- `CHANGE_RECORD_TEMPLATE.md` — a header note stating that a change record
  always lives inside a specification directory from R1 upward, because a
  `CHG-` identifier is unique only within its owning specification.

No field was removed from any template, and no template changed structurally.

## Result

**PASS.** Eleven of eleven templates present and complete against the brief.

## Evidence Sources

E1: the 11 files in `specs/templates/`, read in full; identifier extraction
across the B1 set.
E4: the Phase B1 brief's per-template field lists; `docs/sdd/` standards.
