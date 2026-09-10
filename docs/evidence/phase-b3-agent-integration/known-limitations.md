# Known limitations

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

Nothing here is closed by this phase. Each item names what is not known and
who would have to decide.

## Introduced or made explicit by B3

### 1. Separation of duty proves distinct records, not distinct judgement

`SDD-V051` compares recorded actor labels. Two sessions of the same model
share the same blind spots, and a second session is not a second reviewer in
the sense a human reviewer is.

**Required accepting role:** Application Security. **Status:** `OPEN`,
awaiting risk acceptance. Recorded as `CONV-001`, `SEC-005`, `TH-007`,
`CTRL-007`. **Not an accepted risk** — no human has accepted it.

### 2. Actor identity is a self-declared label

`actorId` is opaque text with no cryptographic binding. Nothing prevents a
record naming any actor it likes. The field is useful for separation checks
and is not an identity claim.

**Owner:** Application Security. **Status:** open.

### 3. The agent test suite does not run in CI

The workflow was not modified: that is R5 and infrastructure approval was
withheld. `validate --all` in CI does apply the new rules to real artefacts,
so an artefact violating one would be caught. A regression in a rule itself
would not.

**Required accepting role:** DevOps / Production Engineering. **Status:**
`OPEN`, awaiting risk acceptance or approval of the workflow change. Recorded
as `CONV-005` and `CL-005`. One workflow step would close it.

### 4. Four of the approval gates R3 requires are unresolved

Specification approval, architecture approval, security risk acceptance and
convergence acceptance. The approvals array is empty. Implementation proceeded
on a written requester instruction, which is not a role-specific approval and
was not recorded as one.

R3 requires **no** implementation-readiness approval; that gate applies at R4
and R5 only, and the earlier blanket phrase "every approval gate is
unresolved" was wrong. Corrected under `CHG-002`; full reasoning in
`docs/evidence/phase-b3-agent-integration/r3-approval-rule-resolution.md`.

**Owner:** Product Owner, Solution Architect, Application Security by gate.
**Status:** open. Recorded as `CONV-004`, with the documentary conflict found
while establishing the rule open as `EVC-015`.

### 5. The phase that built session governance is only partly governed by it

`TASK-001` to `TASK-009` and the early part of `TASK-010` ran before the
control plane existed. One real session, `ASES-0001`, governs the tail.

**Required accepting role:** Product Owner. **Status:** `OPEN`, awaiting risk
acceptance. Recorded as `CONV-003` and in
`docs/evidence/phase-b3-agent-integration/bootstrap-session-audit.md`.

### 6. A session record is only as trustworthy as the commit containing it

Attribution now depends on digests the session itself records. An agent that
can write code can write that record, and a fabricated entry would make its
own change look pre-existing. The digest makes attribution *decidable*, not
*trustworthy*.

Same class as the B2 limitation on approval records. Real assurance comes from
commit authorship, review and branch protection, from outside this tool.

**Owner:** Application Security. **Status:** open. See
`docs/evidence/phase-b3-agent-integration/security-re-review.md` §8.

### 7. A task naming a test range records only its endpoints — RESOLVED

`taskScope` reads "UT-008 to UT-017" as two identifiers, not ten, so
`SDD-V057` could be satisfied by verifying two of ten. No test was actually
skipped — all twelve ran — but the mechanism would not have noticed.

**Status:** **RESOLVED** under `CHG-003`. Every task now enumerates its test
identifiers; all twelve re-parse to identifiers declared in the test plan.

### 8. The remediation sessions carry no digests of their own

`ASES-0002` and `ASES-0003` were created before `TASK-012` implemented digest
capture, so their scope checks report review warnings rather than a clean
result. Not backfilled: writing digests into an existing record would
fabricate evidence about a past moment nobody can verify.

**Required accepting role:** Product Owner. **Status:** `OPEN`, awaiting risk
acceptance. Recorded as `CONV-009`.

### 9. The control plane has never been used on a product change

Everything it has governed is process tooling. Whether it helps or obstructs
on a real feature is unknown.

**Owner:** Engineering. **Status:** open, and deliberately so — B3 is not a
product pilot.

## Carried forward from B2, unchanged

The phase brief listed seven. None is silently closed.

| # | Limitation | Status after B3 |
|---|---|---|
| 1 | `.github/workflows/sdd-validate.yml` has never run on GitHub | **still open.** Not pushed; result on a Linux runner is `UNKNOWN — requires verification` |
| 2 | Branch protection and required status checks externally unverified | **still open.** Cannot be established from inside the repository; `gh` is unauthenticated here |
| 3 | Structured approval records prove presence, not human authenticity | **still open.** B3 adds nothing and depends on nothing here |
| 4 | The validator checks structure, not engineering quality | **still open, and now wider.** The agent rules check process correctness, not whether the work was good |
| 5 | The SDD workflow has not been exercised on a real product feature | **still open.** See item 6 above |
| 6 | Code-without-spec remains advisory | **still open by instruction.** `SDD-V041` stays `WARNING`; see the transition policy audit |
| 7 | Rules without dedicated negative fixtures remain tracked | **narrowed.** All seventeen new rules have dedicated negative fixtures. The B2 position on B2 rules is unchanged |

## Carried forward from Phase A

Every production unknown recorded in `docs/PHASE_A_GAP_ANALYSIS.md` and every
entry in `docs/EVIDENCE_CONFLICTS.md` remains as Phase A left it. B3 accessed
no production system and resolved none of them.

## Environmental

The repository is configured with automatic line-ending conversion, and most
tracked files differ between index and working tree on that basis alone. Three
unit specifications fail on Windows for path-separator, line-ending and
POSIX-mode reasons.

This is unchanged by B3 and is not a regression. Remediation would renormalise
most tracked files on top of uncommitted redesign work, so it stays deferred.

---

## Added by the governance closure pass, 2026-09-08

Both were discovered while recording the human decisions. Neither is fixed,
because no decision authorised the scope.

### 10. No validator rule enforces R3 specification approval

`D2` selected Option A: an R3 specification must be approved by a Product
Owner or Solution Architect before implementation begins. **Nothing checks
it.** `SDD-V020` reports a missing implementation approval at R4 and R5 only,
so an R3 specification can still enter `APPROVED_FOR_IMPLEMENTATION` with no
gate 1 record and the validator will stay silent.

The policy is now unambiguous and unenforced. That is a worse combination than
an ambiguous policy, because it reads as covered.

**Fix:** extend the approval check to require a `specification` gate record at
R3. New tooling work against `SPEC-0001`, needing its own task and scope.
**Owner:** Solution Architect, as the deciding role for `EVC-015`.
**Status:** open, recorded in the `EVC-015` resolution.

### 11. `PASS WITH ACCEPTED LIMITATIONS` is read back as `PASS`

`convergenceVerdict` in `tools/sdd/lib/traceability.mjs` iterates the
permitted verdicts in order and returns the first prefix match. `PASS` is
first, so `PASS WITH ACCEPTED LIMITATIONS` collapses to `PASS`.

Confirmed by direct call. `SDD-V033` still passes, because both are valid
verdicts, so nothing fails — the value is simply misread. Any consumer reading
the verdict programmatically sees `PASS` where the truth is that limitations
were accepted. **`SPEC-0002` is such a case right now.**

The recorded verdict in `convergence.md` is correct; only the machine read-back
is wrong.

**Fix:** match the longest verdict first, or match exactly. A pre-existing B2
defect in `SPEC-0001` tooling, discovered by B3, not introduced by it.
**Route:** `docs/sdd/BUG_WORKFLOW.md`.
**Owner:** Engineering.
**Status:** open. Not fixed here — `tools/sdd/` was outside every authorised
task scope in this pass, and `TASK-013` declared it **prohibited**.

### A note on what the three accepted risks mean

`CONV-001`, `CONV-003` and `CONV-009` are now `ACCEPTED_RISK` with named human
owners. Accepted is not fixed. Separation of duty still compares labels rather
than judgement; most of B3 still predates its own governance; three sessions
still carry no digests. Each acceptance carries the compensating controls the
accepting role specified, and those controls are the reason the risk is
tolerable — not the acceptance itself.

---

## Added by the technical closure pass, 2026-09-08

### 12. SPEC-0002 fails the ordering rule it commissioned — EXCEPTED, not fixed

`SDD-V060` reports that this specification's approval (2026-09-08) postdates
its transition into `APPROVED_FOR_IMPLEMENTATION` (2026-09-07). True, and
immutable: the dates are history.

**Resolved by `EXC-001`**, a scoped historical exception approved by the
Solution Architect on 2026-09-08. The condition still exists and is still
reported at `INFO` on every run. `SDD-V060` remains fully enforced everywhere
else, proven by `UT-044`.

**Owner:** Solution Architect. **Status:** `CONV-011`, RESOLVED. Audit:
`docs/evidence/phase-b3-agent-integration/historical-exception-audit.md`.

### 13. A knowingly-broken test — RESOLVED

`UT-025` pinned `SPEC-0002`'s verdict value rather than the parser invariant,
and the convergence re-run changed that value. `TASK-016` was raised to correct
it, scoped to the test file with the parser prohibited.

Preflight refused the session while limitation 12 stood. Once `EXC-001` took
effect, `TASK-016` ran through the normal control plane as `ASES-0007`.
Preflight was never bypassed.

**Status:** `CONV-013`, RESOLVED. The new assertion checks strictly more than
the one it replaces.

### 14. R4/R5 gate 1 remains unenforced

`SDD-V059` covers R3 only. Gate 1 at R4 and R5 requires Product Owner **and**
Solution Architect, and no rule checks it. Named in
`docs/sdd/VALIDATION_RULES.md` so it reads as a known gap rather than covered.

**Owner:** Engineering. **Status:** open, not a B3 deliverable.

### 15. Scope attribution is weak on an untracked tree

git collapses an untracked directory to one status entry, so file-level
changes under `tools/` cannot be attributed to a session. They are reported as
unattributable rather than assumed in scope — fail-safe, but it means scope
enforcement is materially weaker before a first commit than after one.

**Owner:** Engineering. **Status:** open. Observed in `ASES-0005`.

### 16. TASK-017 ran outside a session

The exception mechanism could not be built inside a session, because preflight
was blocked by the very finding the exception exists to cover. A control
cannot govern its own construction — the same shape as the original bootstrap
boundary.

The boundary is visible: `TASK-017` ran ungoverned, `TASK-016` immediately
afterwards ran through preflight, session, scope check, verification and
independent review.

**Owner:** unassigned. **Status:** `CONV-014`, OPEN — awaiting a human
disposition. **Not** labelled `ACCEPTED_RISK`; nobody has accepted it.

### 17. A lapsed exception does not self-expire

Expiry is enforced by `status`, not by the clock, because the validator must
stay deterministic. A human must review and flip the status at expiry — rule 8
of `docs/sdd/VALIDATION_EXCEPTIONS.md`. `EXC-001` itself carries a condition
rather than a date, so this does not currently bite.

**Owner:** Engineering. **Status:** open.
