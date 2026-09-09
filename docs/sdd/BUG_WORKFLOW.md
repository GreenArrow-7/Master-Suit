# Bug Workflow

`NORMATIVE — engineering process requirement.`

A bug report names a symptom. The workflow exists to get from the symptom to
the cause, and to leave behind a test that fails if the cause returns.

## The path

```text
REPORT
  ↓
REPRODUCE
  ↓
EXPECTED VS ACTUAL
  ↓
ROOT CAUSE
  ↓
AFFECTED REQUIREMENT
  ↓
REGRESSION TEST
  ↓
FIX PLAN
  ↓
IMPLEMENT
  ↓
VERIFY
  ↓
CONVERGE
```

## Step notes

**Report.** Record the observed behaviour, environment, and who saw it. Do not
rewrite it as a diagnosis.

**Reproduce.** A bug that cannot be reproduced is not yet ready to fix.
Record the exact steps, or record that reproduction failed and what was tried.
Reproduce locally against disposable data; never against production.

**Expected versus actual.** State both. "Expected" must come from somewhere —
an existing requirement, a documented behaviour, or a reasonable inference
that is then confirmed. If expected behaviour cannot be sourced, that is
itself the finding.

**Root cause.** Find where all affected callers route through, not just the
path the report names. `AGENTS.md` §1 requires reading every caller of the
function being changed; the smallest correct fix is usually one guard in the
shared function rather than a guard in each caller. A fix that addresses only
the reported path leaves the sibling paths broken.

**Affected requirement.** Three outcomes, and the third is the important one:

1. An existing requirement covers this and the code violates it. The
   requirement stands; the code is wrong.
2. An existing requirement is wrong. Raise a change record; the fix follows
   the change, not the other way round.
3. **No requirement covers this.** The bug has exposed a missing requirement.
   Add it — to an existing specification under change control, or in a new
   specification if none fits. A defect in an unspecified area is a
   specification gap as much as a code defect, and closing the code without
   closing the gap guarantees the argument recurs.

**Regression test.** Written before or with the fix, and demonstrated to fail
against the unfixed code. A regression test that has never failed proves
nothing. It gets a `REG-` identifier and joins the test plan.

**Fix plan.** Proportional to risk. A one-line guard at R2 needs a paragraph;
a fix inside `src/lib/auth/*` is R4 and needs the R4 artefacts and gates.
Classify the fix by what it touches, not by the size of the diff.

**Implement.** The minimum change that removes the cause. No opportunistic
refactors in a fix, however tempting the surrounding code.

**Verify.** The regression test passes, the previously passing suites still
pass, and the reported symptom is gone by the original reproduction steps.

**Converge.** Even a small fix answers the convergence questions: was
anything else changed, was any behaviour altered that nobody asked for, is
documentation still true.

## Risk classification for bugs

The severity of the symptom and the risk of the fix are different things. A
cosmetic symptom fixed in `src/lib/security/*` is R4. A severe symptom fixed
by a null check in a component is R2. Classify by the blast radius of the
change, then treat urgency separately: if it cannot wait for the normal path,
it is an incident and uses `docs/sdd/EMERGENCY_CHANGE_WORKFLOW.md`.

## Security-relevant bugs

If the bug has any security dimension — authorization, tenant isolation, data
exposure, session handling, audit — it is at least R4, Application Security is
involved from the report rather than at review, and the record avoids
publishing an exploit path. Where the finding concerns the existing system
rather than the change, it also belongs in
`docs/security/SECURITY_OBSERVATIONS.md` under that register's evidence rules,
with an exploitability status rather than a confirmed-vulnerability claim.

## Authority / References

- `AGENTS.md` §1 (root cause, read every caller), §5 (tests), §3 (security)
- `docs/RISK_CLASSIFICATION.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`
- `docs/sdd/CHANGE_CONTROL.md` — when the requirement, not the code, is wrong
- `docs/security/SECURITY_OBSERVATIONS.md` — the observation register
- `specs/templates/BUG_TEMPLATE.md`
