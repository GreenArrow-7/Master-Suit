# Artifact authority audit

## The model as defined

```text
AGENTS.md → spec.md → clarifications.md → plan.md
→ threat-model.md / test-plan.md → tasks.md → implementation
→ traceability.md / convergence.md
```

Defined in `docs/sdd/ARTIFACT_AUTHORITY.md`, restated in the same order in
`docs/sdd/SDD_WORKFLOW.md` and `AGENTS.md` §2. **VERIFIED — the three
statements agree.**

## Required rules, and where each is enforced

| Rule from the B1 brief | Where stated | Reinforced in |
|---|---|---|
| Lower-level artefacts cannot override higher-level requirements | `ARTIFACT_AUTHORITY.md` rule 1 | `SDD_WORKFLOW.md`, `AGENTS.md` §2 |
| PLAN cannot silently modify SPEC | rule 2 | `PLAN_STANDARD.md`, `PLAN_TEMPLATE.md`, `CHANGE_CONTROL.md` |
| TASKS cannot silently expand scope | rule 3 | `TASKS_TEMPLATE.md`, `TRACEABILITY_STANDARD.md` check 4, `CLAUDE.md` |
| Tests cannot redefine intended behaviour | rule 4 | `TEST_PLAN_TEMPLATE.md` header, `AGENTS.md` §5 |
| Implementation does not become the requirement by existing | rule 5 | `CONVERGENCE_TEMPLATE.md` "Unrequested behaviour" |
| Existing production behaviour does not automatically override an approved requirement | rule 6 | `SDD_WORKFLOW.md` brownfield rule 3 |
| Record the conflict and decide whether code or requirement changes | "When reality contradicts the specification", 5 steps | `BUG_WORKFLOW.md` "Affected requirement" |
| Approved specification changes require change control | rule 7 | `CHANGE_CONTROL.md`, `SPEC_LIFECYCLE.md` |
| Material ambiguity blocks progression | rule 8 | `CLARIFICATION_STANDARD.md`, `SPEC_LIFECYCLE.md` |

**All nine required rules are present**, each in the authority document and at
least one operational document, so a reader arriving from either direction
meets the same rule.

## Evidence conflicts and SDD artefacts

`ARTIFACT_AUTHORITY.md` places the `EVC` register upstream of specifications
and states four rules: a specification may cite a conflict; it may not close
one; an open C4 or release-blocking conflict in the affected area must appear
in the specification's Risks section and be seen by the approver; and a
conflict resolved as a side effect of implementation is recorded by
convergence and closed in its own register under that register's rules.

**VERIFIED — consistent with `docs/EVIDENCE_CONFLICTS.md`**, which owns
conflict status and requires the original disagreement to be preserved.

## Precedence for current-state facts

The Phase A hierarchy is restated unchanged: direct implementation, executable
configuration, automated tests, repository documentation, structural
inference, with runtime-only facts marked
`UNKNOWN — requires runtime/infrastructure verification`. Two B1 documents
carry it and `SPEC_TEMPLATE.md` requires claim classification in its Evidence
section. No B1 document weakens it.

## Separation of normative rules from current-state claims

Each `docs/sdd/` document and `specs/README.md` opens with `NORMATIVE —
engineering process requirement`. Where a B1 document states a fact about the
system it is labelled: `VERIFIED` for the existing CI script names, the deploy
workflow's environment protection and the absence of a migration down path;
`UNKNOWN — requires runtime/infrastructure verification` for whether those
protections are configured as intended in the GitHub account.

**No B1 document presents a newly written process rule as existing
behaviour.**

## Result

**PASS.** The authority model is internally consistent, completely stated, and
correctly connected to the pre-existing evidence and conflict machinery.

## Evidence Sources

E1: `docs/sdd/ARTIFACT_AUTHORITY.md` and the 25 other B1 documents;
`AGENTS.md`, `CLAUDE.md`.
E4: `docs/EVIDENCE_CONFLICTS.md`,
`docs/evidence/phase-a-foundation/evidence-audit.md`.
