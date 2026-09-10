# Transition policy audit

## The constraint

The repository holds substantial application work that predates SDD entirely,
plus an uncommitted UI redesign of 36 files. Safety rule 16 of the Phase B2
brief forbids making a current release fail merely because historical work
predates the system.

## How the policy satisfies it

| Category | Enforcement | Why safe |
|---|---|---|
| Structural rules over SDD artefacts | **Blocking now** | Every such artefact is new by definition. A repository with no specifications passes trivially |
| Code changed without a linked specification (`SDD-V041`) | **Advisory** | This is the only rule that could touch pre-existing work |

The distinction is precise: 38 of 41 rules can only fire on a file that did
not exist before Phase B1. They cannot retroactively invalidate anything.

## Legacy versus governed work

`docs/sdd/ENFORCEMENT_STANDARD.md` §6 draws the line as a date and a
decision, not a reconstruction of history. Work merged before the first
specification is legacy and is never required to acquire one. **No
specification will be manufactured for existing code.**

## Promotion conditions

`SDD-V041` becomes blocking only when all five hold, and a human records the
decision:

1. A real product feature has completed the full lifecycle, so the workflow
   is known to be usable rather than assumed to be.
2. The six approval roles are assigned to people.
3. Validator CI enforcement exists and has been green on the default branch
   for a sustained period.
4. A legacy boundary is agreed and written down.
5. Product Owner and DevOps approve the promotion, recorded as a change.

Condition 3 is now unblocked: the CI workflow exists. It has not yet run, so
"green for a sustained period" is not satisfied. Conditions 1, 2, 4 and 5 do
not hold. Promotion therefore remains correctly out of reach.

## Verified

`node tools/sdd/cli.mjs validate --all` reports `errors=0`, exit 0, against
the repository as it stands — with 36 modified application files in the
working tree and no specification covering any of them. Pre-SDD work is not
falsely rejected.

## Evidence Sources

E1: validator run at commit `f16ed67`; `sdd.config.json`;
`tools/sdd/rules/rules.mjs`.
E4: `docs/sdd/ENFORCEMENT_STANDARD.md` §6,
`specs/SPEC-0001-sdd-verification-enforcement/clarifications.md` `CL-003`.
