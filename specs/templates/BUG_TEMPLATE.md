# BUG-NNNN — <title>

> Workflow: `docs/sdd/BUG_WORKFLOW.md`.
> A bug report names a symptom. This template exists to get to the cause and
> leave a test behind that fails if the cause returns.
> Classify risk by what the **fix** touches, not by the size of the symptom.

| Field | Value |
|---|---|
| Bug ID | `BUG-NNNN` |
| Title | |
| Risk | `R?` — by what the fix touches (`docs/RISK_CLASSIFICATION.md`) |
| Severity | impact on users, separate from risk |
| Reported by | |
| Date | YYYY-MM-DD |
| Status | `REPORTED` / `REPRODUCED` / `DIAGNOSED` / `FIXING` / `VERIFYING` / `CLOSED` / `CANNOT_REPRODUCE` / `WONT_FIX` |

## Observed behaviour

What actually happens, in the reporter's terms. Do not rewrite this as a
diagnosis.

## Expected behaviour

What should happen, and **where that expectation comes from**: a requirement
identifier, a documented behaviour, or a reasonable inference that still needs
confirming. If the expectation cannot be sourced, that is itself the finding.

## Reproduction

Exact steps, environment, data, actor and permissions. Reproduce locally
against disposable data; never against production. If reproduction failed,
record what was tried.

## Affected requirement or specification

One of three, and the third matters most:

- [ ] An existing requirement covers this and the code violates it →
      the requirement stands, the code is wrong. Cite it.
- [ ] An existing requirement is wrong → raise `CHG-` first; the fix follows
      the change.
- [ ] **No requirement covers this** → the bug exposed a missing requirement.
      Add it to an existing specification under change control, or open a new
      one. Closing the code without closing the gap guarantees a repeat.

## Root cause

Where the defect actually is, not where it surfaced. State every caller that
routes through the affected code — `AGENTS.md` §1. A fix that patches only the
reported path leaves the sibling paths broken.

## Security impact

None, or: what an attacker could do with it. Any security dimension makes this
at least R4 and involves Application Security from the report onward. Do not
publish an exploit path. Where the finding concerns the existing system rather
than this change, also register it in
`docs/security/SECURITY_OBSERVATIONS.md` with an exploitability status.

## Data impact

Was data lost, corrupted, exposed or written wrongly. Does existing data need
repair, and if so, under whose approval
(`docs/sdd/HUMAN_APPROVAL_GATES.md`, gate 4).

## Regression test

| Field | Value |
|---|---|
| Test ID | `REG-001` |
| Location | which suite |
| Fails against unfixed code | yes / no — **must be yes** |
| Passes against the fix | |

A regression test that has never failed proves nothing.

## Fix scope

The minimum change that removes the cause. State explicitly what is **not**
being changed. No opportunistic refactors in a fix.

## Verification

- [ ] Regression test fails before the fix and passes after
- [ ] The original reproduction steps no longer produce the symptom
- [ ] Previously passing suites still pass
- [ ] Adjacent callers checked
- [ ] Applicable items of `AGENTS.md` §8

## Convergence

Was anything else changed. Was any behaviour altered that nobody asked for. Is
documentation still true. Did this reveal a missing requirement that has now
been added.

**Status:** `REPORTED`
