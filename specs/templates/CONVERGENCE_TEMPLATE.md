# SPEC-NNNN — Convergence

> Copy to `specs/SPEC-NNNN-short-slug/convergence.md`.
> Convergence asks whether specification, plan, implementation and
> verification actually agree. Passing tests alone are not completion
> (`AGENTS.md` §8).
> An AI agent may produce this report and recommend a verdict. Acceptance is
> a human decision from R3 upward (`docs/sdd/HUMAN_APPROVAL_GATES.md`, gate 6).

| Field | Value |
|---|---|
| Specification | `SPEC-NNNN` |
| Risk | `R?` |
| Prepared by | |
| Date | YYYY-MM-DD |
| Recommended verdict | `PASS` / `PASS WITH ACCEPTED LIMITATIONS` / `FAIL` |
| Accepted by | role, date — required from R3 |

## Checks

Each check gets a result and, where it fails, a `CONV-` finding.

| # | Check | Result |
|---|---|---|
| 1 | Every requirement is implemented | |
| 2 | Every acceptance criterion is verified | |
| 3 | Every security requirement is verified by a security test | |
| 4 | All required tests pass; failures are explained | |
| 5 | No task left `TODO`, `IN_PROGRESS` or `BLOCKED` without a decision | |
| 6 | No behaviour was implemented that no requirement asked for | |
| 7 | No undocumented architecture change | |
| 8 | No undocumented dependency change | |
| 9 | Migration matches the plan; no unplanned schema divergence | |
| 10 | Documentation updated where this change made it untrue | |
| 11 | No new evidence conflict introduced, or it is registered | |
| 12 | Known limitations recorded with owners | |
| 13 | Residual risk recorded and accepted by the right role | |
| 14 | Rollback is written down and feasible | |
| 15 | The applicable items of `AGENTS.md` §8 hold | |

## Findings

### CONV-001

**Check:** which check above.
**Finding:** what was actually observed.
**Evidence:** file, test, command output.
**Impact:** why it matters.
**Recommendation:**
**Status:** `OPEN` / `RESOLVED` / `ACCEPTED_RISK` / `NOT_APPLICABLE`
**Owner:** functional role — required for `ACCEPTED_RISK`.

> **`OPEN` is the canonical pre-acceptance status.** It covers a finding that
> has not yet received its required disposition, whether that is unresolved
> engineering work, pending governance action, or a residual risk awaiting
> human acceptance. The owner, reason and required-decision fields distinguish
> the three; the status does not, and is not intended to.
>
> A residual risk transitions `OPEN` → `ACCEPTED_RISK` only when an authorised
> human accepts it, with the accepting functional role and evidence recorded.
> An AI may recommend acceptance and may never record it.
>
> No additional status such as `PENDING_RISK_ACCEPTANCE` is required.
> Confirmed by QA / Release Engineering, decision `D8` (Option A), 2026-09-08,
> resolving `SPEC-0002/CONV-010`.

## Unrequested behaviour

Anything the implementation does that no requirement asked for. Options are:
remove it, or add the requirement under change control. Leaving it
undocumented is not an option — it is how a system stops matching its own
specification.

## Verification summary

What was actually run, when, and what it produced. Include environmental
failures rather than hiding them; Windows and Linux differ here in known ways
(`docs/standards/CODING_STANDARDS.md`).

| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | |
| Types | `npm run typecheck` | |
| Lint | `npm run lint` | |
| Format | `npm run format:check` | |
| Tests | the relevant suites | |
| Schema drift | `npm run check:drift` | if schema touched |
| RLS | `npm run check:rls` | if tenant tables touched |
| Raw SQL scope | `npm run check:raw-sql` | if raw SQL touched |

## Verdict

- `PASS` — every check passes; no `CONV-` finding is `OPEN`.
- `PASS WITH ACCEPTED LIMITATIONS` — every open finding is `ACCEPTED_RISK`
  with a named human owner and, where relevant, a condition for revisiting.
- `FAIL` — a check fails materially. The specification returns to
  `IMPLEMENTING`, or to change control if a requirement was wrong.

An agent that believes the work is complete states the recommended verdict and
stops. It does not mark itself converged at R3 or above.
