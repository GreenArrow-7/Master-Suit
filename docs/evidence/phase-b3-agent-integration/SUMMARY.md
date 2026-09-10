# Phase B3 — Agent Integration and Controlled Execution

**Specification:** `SPEC-0002` · **Risk:** `R3` · **Date:** 2026-09-07
**Recommended verdict:** `PASS WITH KNOWN LIMITATIONS`
**Status:** FORMALLY ACCEPTED — Phase B3
**Verdict:** `PASS WITH ACCEPTED LIMITATIONS` — accepted by the reviewer role, 2026-09-08
**Accepted by:** reviewer (gate 6), 2026-09-08. All twelve human decisions taken.

## What B3 built

A control plane that lets an AI agent execute approved work without letting it
decide what it is allowed to execute, approve itself, or judge whether its own
output passed.

| Component | Where |
|---|---|
| Seven agent standards | `docs/sdd/AGENT_*.md` |
| Three record schemas | `docs/sdd/schemas/` |
| Three record templates | `specs/templates/` |
| Control plane library | `tools/sdd/lib/agent.mjs` |
| Command line subcommands | `tools/sdd/cli.mjs` |
| Seventeen validation rules | `SDD-V042` to `SDD-V058` |
| Synthetic fixtures and 36 tests | `tools/sdd/tests/` |

## The shape of it

```text
preflight → create-session → work → scope-check → verify-session → review-check
    │                                     │              │              │
  refuses                          reports drift    VER-NNNN       REV-NNNN
  and writes                       never repairs                 different actor
  nothing
```

Preflight is the only place that says no, and when it says no,
`create-session` writes no file. There is no override flag.

## Results

| Check | Result |
|---|---|
| Agent tests | 48 of 48 pass |
| Validator suite | 89 of 89 pass |
| Artefact validation | `PASS`, 0 errors, 0 warnings |
| Rule catalogue agreement | 58 rules, 0 undocumented, 0 unimplemented |
| Negative fixture coverage | 17 of 17 new rules |
| Preflight latency | about 0.3 s |
| Application files changed | 0 |
| Dependencies changed | 0 |
| Infrastructure files changed | 0 |
| Migrations | 0 |
| Approvals fabricated | 0 |

## The three claims this system refuses to merge

| Claim | Who may make it |
|---|---|
| The assigned scope was executed | the implementing agent |
| The required tests ran and passed | a verification record |
| The work is accepted | a human, from R3 upward |

`SDD-V057` refuses `COMPLETE` while a required test has no recorded
verification. `SDD-V053` refuses an AI actor on a human-required gate. The
word "accepted" appears nowhere in the session vocabulary.

## What this does not establish

Read this before quoting anything above.

- **Separation of duty checks labels, not judgement.** Two sessions of one
  model share the same blind spots. A second session is not a second reviewer.
- **The phase that built session governance is only partly governed by it.**
  One session, `ASES-0001`, governs the tail of one task out of ten.
- **The agent tests do not run in CI.** That needs DevOps approval, which was
  withheld.
- **Nothing here has been used on a product feature.** B3 is not a pilot.
- **The validator checks process, not quality.** A green result means the
  process was followed, not that the engineering was good.
- **Two defects were found, and closed the long way round.** `ASES-0001`
  found them in its own work and refused to fix either, because each needed a
  file outside its approved scope. Both were remediated in a second pass under
  `CHG-001`, each through its own task, session, verification and independent
  review. `ASES-0001` keeps its `PARTIAL` result: rewriting it would destroy
  the evidence that the control worked.
- **Two findings remain open.** `CONV-004`, the specification-approval gate
  that R3 does require was crossed; and `CONV-008`, a task naming a test range
  records only its endpoints.

## Reading order

| To understand | Read |
|---|---|
| what was built and whether it works | `agent-role-model-audit.md`, `preflight-audit.md`, `scope-enforcement-audit.md` |
| whether it can be gamed | `separation-of-duty-audit.md`, `security-review.md` |
| what was actually run | `agent-test-results.md`, `valid-fixture-results.md`, `invalid-fixture-results.md` |
| what is honest about the boundaries | `bootstrap-session-audit.md`, `known-limitations.md` |
| what a human must decide | `acceptance.md` — the authoritative table of 10 decisions |
| the R3 approval rule, settled | `r3-approval-rule-resolution.md` |
| how the two defects were closed | `allowlist-security-review.md`, `attribution-remediation.md` |
| the post-remediation regression | `remediation-regression-results.md`, `security-re-review.md` |

## Package contents

Thirty-three files after the convergence pass. `phase-b3-files.txt` carries a SHA-256 for each,
generated after every other file was final.
