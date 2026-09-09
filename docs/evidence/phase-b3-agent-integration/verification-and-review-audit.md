# Verification and review record audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

## Verification records

A `VER-NNNN` record answers *what was run and what did it return*. It carries
test identifiers with outcomes, command names with exit codes, an overall
result, and the role and type of the actor that ran it.

### Tests must exist in the plan

`verificationFindings` builds the set of test identifiers declared in the
specification test plan and rejects any cited identifier that is not in it
(`SDD-V054`). `UT-124` adds an unplanned identifier to an otherwise valid
record and confirms the rejection.

This closes the simplest way to fabricate coverage: inventing a test name that
sounds like it passed. A test identifier now has to be planned before it can
be claimed.

### Records carry no output

The schema admits a command name and an exit code, and no field for captured
standard output or standard error. `SPEC-0002/SEC-006` records the reason: a
repository artefact that copies logs will eventually copy a credential, and a
specification directory is more widely readable and longer-lived than a CI log.

The environment field is a sentence about where the run happened, bounded to
200 characters, and the schema says explicitly that it is never a connection
string.

### Result values are not interchangeable

`PASS` requires every required test in scope to have run and passed. The
schema states that a skipped test is not a pass, and `SKIPPED` and `NOT_RUN`
are distinct outcomes so that "we did not run it" cannot be recorded as "it
was fine".

## Review records

A `REV-NNNN` record answers *who looked at this and what did they conclude*.

| Field | Constraint |
|---|---|
| Reviewed session | must name an existing session (`SDD-V055`) |
| Review actor | must differ from the reviewed session actor (`SDD-V051`) |
| Reviewing session | must differ from the reviewed session (`SDD-V051`) |
| Decision | `APPROVE`, `REQUEST_CHANGES` or `BLOCKED` only |
| Human gate flag | false for any AI reviewer (`SDD-V053`) |

A decision of `APPROVE` is an engineering opinion. The schema says on the
field itself that it never discharges a human approval gate, because that is
exactly the misreading the word invites.

## Malformed records

`UT-118` and `UT-119` set an invalid result and an invalid decision
respectively. Both surface as findings naming the field, and both return
exit 1. A record the tool cannot understand is never treated as a record that
passed.

**Result:** verification and review records are bounded, cross-checked against
the test plan and the session set, and cannot claim authority they do not have.
