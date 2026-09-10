# SPEC-0002 — Convergence

| Field | Value |
|---|---|
| Specification | `SPEC-0002` |
| Risk | `R3` |
| Prepared by | AI, Convergence Reviewer role |
| Date | 2026-09-07 |
| Recommended verdict | `PASS WITH ACCEPTED LIMITATIONS` |
| Why | No finding is `OPEN`. Five residual risks are accepted, each with a named functional-role owner. Accepted is not fixed |
| Phase status | **FORMALLY ACCEPTED** — Phase B3, PASS WITH ACCEPTED LIMITATIONS |
| Accepted by | **reviewer** (gate 6 at R3) · 2026-09-08 · `D10` ACCEPTED |

An AI prepared this report and recommended a verdict. At R3 acceptance is a
human decision (gate 6), and it was taken: **`D10` ACCEPTED on 2026-09-08 by
the reviewer role.** The specification is converged.

The accepting role acknowledged that the five `ACCEPTED_RISK` findings remain
limitations rather than resolved work, and that this acceptance covers Phase
B3 only — not production release, deployment, migration, destructive
operations, unrelated Phase A/B unknowns, a future product feature, Phase B4,
or a waiver of any compensating control.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Every requirement is implemented | PASS — `FR-001` to `FR-010`, `SEC-001` to `SEC-006`, `NFR-001` to `NFR-003`, `DATA-001`, `OBS-001` all trace to a task |
| 2 | Every acceptance criterion is verified | PASS — `AC-001` to `AC-008` each map to at least one passing test |
| 3 | Every security requirement is verified by a security test | PASS — `ST-001` to `ST-008`, except `SEC-005`, verified by documentation review (`CONV-001`) |
| 4 | All required tests pass; failures are explained | **PASS** — B2 validator suite 89 of 89; B3 agent suite 48 of 48; `validate --all` 0 errors |
| 5 | No task left `TODO`, `IN_PROGRESS` or `BLOCKED` without a decision | PASS — `TASK-001` to `TASK-017` all `DONE`. Two execution-process deviations recorded as `CONV-012` and `CONV-014` |
| 6 | No behaviour implemented that no requirement asked for | PASS — see *Unrequested behaviour*. `CONV-007` remediated under `CHG-001` |
| 7 | No undocumented architecture change | PASS — no application architecture was touched |
| 8 | No undocumented dependency change | PASS — no dependency added, removed or upgraded |
| 9 | Migration matches the plan | NOT APPLICABLE — no schema change, no migration |
| 10 | Documentation updated where this change made it untrue | PASS — validation rules, identifier standard, workflow, `AGENTS.md`, `CLAUDE.md` |
| 11 | No new evidence conflict introduced, or it is registered | PASS — none introduced |
| 12 | Known limitations recorded with owners | PASS — `docs/evidence/phase-b3-agent-integration/known-limitations.md` |
| 13 | Residual risk recorded and accepted by the right role | **PASS** — five residual risks accepted: `CONV-001` by Application Security; `CONV-003`, `CONV-009`, `CONV-012` and `CONV-014` by the Product Owner. Each carries scope, rationale, compensating controls and a date |
| 14 | Rollback is written down and feasible | PASS — see *Rollback* |
| 15 | The applicable items of `AGENTS.md` §8 hold | **PASS** — human code review completed for the pre-`D9` control plane (`REV-0004`) and for the post-`D9` tooling (`REV-0009`). Architecture approval recorded (`D3`). Production release remains a separate human decision and is not sought |

## Findings

### CONV-001

**Check:** 3
**Finding:** `SEC-005`, separation of duty, has no technical control. `CTRL-007`
is documentary. `SDD-V051` compares recorded actor labels, which proves two
records differ, not that two independent parties exist.
**Evidence:** `docs/sdd/AGENT_ROLE_MODEL.md`; `docs/evidence/phase-b3-agent-integration/separation-of-duty-audit.md`;
`UT-120`, `UT-121`.
**Impact:** A second AI session is not an independent reviewer in the sense a
human reviewer is. Correlated blind spots survive the check.
**Recommendation:** Keep the structural check, keep the limitation stated in
the standard rather than only in evidence, and require a human reviewer where
independence must be real.
**Status:** `ACCEPTED_RISK`
**Accepted by:** Application Security · **Decision:** `D4` · **Date:**
2026-09-08
**Scope:** the Phase B3 control plane only. No future security review
requirement is waived.
**Rationale as given:** deterministic tooling can validate role labels,
structured records, artefact presence and metadata-represented separation
rules; it cannot prove reviewer competence, genuine organisational
independence, review depth, or the semantic correctness of a security
assessment.
**Compensating controls recorded with the acceptance:** human Application
Security involvement for security-sensitive R4 and R5 work; required human
review where the risk model demands it; AI-generated review records not
treated as proof of human competence; human risk acceptance where required;
final human convergence and release authority remaining outside AI control.

### CONV-002

**Check:** 4
**Finding:** The `SPEC-0001` validator suite failed its repository self-check
(`IT-005/006`) during most of this phase, because `SPEC-0002` cited documents
that did not exist yet. The count fell from 22 to 5 to 2 to 0 as those
documents were written.
**Evidence:** `docs/evidence/phase-b3-agent-integration/agent-test-results.md`; `docs/evidence/phase-b3-agent-integration/validation-rule-audit.md`.
**Impact:** None remaining. It resolved by producing the referenced documents.
**Recommendation:** None. This is the rule working: a specification that cites
a document it has not written is incomplete, and the validator said so.
**Status:** `RESOLVED`

### CONV-003

**Check:** 5
**Finding:** The bootstrap boundary. `TASK-001` to `TASK-009`, and the earlier
part of `TASK-010`, were executed **before** the session control plane existed
to govern them. Only the tail of `TASK-010` ran inside a real session,
`ASES-0001`.
**Evidence:** `docs/evidence/phase-b3-agent-integration/bootstrap-session-audit.md`;
session `ASES-0001` under this directory.
**Impact:** The phase that built session governance is itself only partly
governed by it. This is unavoidable for a first implementation and is stated
rather than disguised.
**Recommendation:** Treat `ASES-0001` as a demonstration that the tooling
works, not as evidence that this phase was governed throughout. The first
fully governed specification will be the next one.
**Status:** `ACCEPTED_RISK`
**Accepted by:** Product Owner · **Decision:** `D5` · **Date:** 2026-09-08
**Scope:** the Phase B3 bootstrap boundary only.
**Rationale as given:** part of Phase B3 necessarily existed before the B3
agent-session mechanism was available to govern its own creation.
**Compensating requirement recorded with the acceptance:** all future
applicable work after the bootstrap boundary must use the approved
agent-session and verification process. Historical execution remains truthful;
no retroactive session or evidence was created, and none may be.

### CONV-004

**Check:** 13
**Finding:** Every approval gate on this specification is unresolved.
`sdd.json` carries an empty approvals array. Implementation proceeded on a
written requester instruction, which is not a role-specific approval and is not
recorded as one.
**Evidence:** `sdd.json`; `spec.md`;
`approval-gate-status` section below.
**Impact:** The specification cannot be accepted, released, or treated as
converged. Residual risk is recorded and nobody has accepted it.
**Resolution, in two parts.**

*Was the gate required?* `EVC-015` was open on exactly that question. The
Solution Architect selected **Option A** (`D2`, 2026-09-08): an R3
specification must be approved by a Product Owner or Solution Architect before
implementation begins. So yes — the gate was required, and this specification
did cross it. The deviation is real and is not dissolved by the policy choice.

*Is it now satisfied?* Yes. The specification was approved (`D1`,
2026-09-08), and an approval record naming the role, decision, date and scope
is recorded in `sdd.json`.

The approval arrived after implementation rather than before it. That
sequencing is the deviation, and it stays on the record: it is why this
finding exists, why `ASES-0001` is `PARTIAL`, and why the manifest's status
history carries a note at the point of transition. What has changed is that
the missing approval now exists, not that it was never missing.

**One field could not be filled.** The approving decision stated the role as
"[Product Owner / Solution Architect]" without selecting between them. Gate 1
at R3 accepts either, so the gate is discharged; the approval record names
both and flags that the specific role was not stated. A human should confirm
which role was exercised, for traceability. This is not a blocker and is not
treated as one.
**Status:** `RESOLVED`

### CONV-005

**Check:** 4
**Finding:** The agent test suite does not run in continuous integration. The
workflow was not modified, because doing so is R5 and infrastructure approval
was withheld.
**Evidence:** `docs/evidence/phase-b3-agent-integration/ci-integration-audit.md`; `CL-005`.
**Impact:** A regression in the agent rules would not be caught by CI, though
an artefact violating them would be, because `validate --all` shares the rule
catalogue.
**Resolution:** DevOps / Production Engineering decided `REQUIRE
REMEDIATION` (`D6`, 2026-09-08) rather than accepting the gap. That decision
supplied the R5 infrastructure authorisation `CL-005` had named and left open.

Remediated under `CHG-004` by `TASK-013`, executed in `ASES-0004` with
`apps/`, `tools/sdd/` and `prisma/` declared **prohibited**. The workflow now
runs the B2 validator suite, the B3 agent-control suite and `validate --all`.

All six constraints from the authorising decision were re-verified against
executable content, with comment prose excluded from the scan: every run step
is a node test or the validator; no deploy, publish or release action; no
migration command; no network fetch; no secrets reference; no services block.
`permissions: contents: read`, `persist-credentials: false`, and `SDD-V041`
is not promoted.
**Verification:** `VER-0004` — `IT-008` passes; the three commands the
workflow invokes were executed locally and all pass. **Repository-local:
VERIFIED.**
**GitHub-hosted execution: `UNKNOWN — requires runtime/infrastructure
verification`.** The repository has not been pushed and the workflow has never
run remotely. Nothing in this specification asserts that it will pass there.
**Independent review:** `REV-0005`, `APPROVE`, distinct actor.
**Status:** `RESOLVED`

### CONV-006

**Check:** 4
**Finding:** The `SPEC-0001` security test `ST-002` now fails. It scans the
tool directory for dynamic execution constructs and permits `child_process`
only in `tools/sdd/lib/diff.mjs` and the validator test. B3 added a second
legitimate git caller, `tools/sdd/lib/agent.mjs`, and its test file. Both are
outside that allowlist.
**Evidence:** `node --test tools/sdd/tests/validator.test.mjs` — 53 of 54
pass; `ST-002` reports two offenders.
**Impact:** A security test is red. The underlying code is not unsafe: both
new files use `execFileSync` with a fixed argument array and no shell, the
same reviewed pattern `tools/sdd/lib/diff.mjs` uses, and the universal checks for `eval`,
`new Function`, `execSync` and `shell: true` still pass everywhere.
**Recommendation:** A human extends the allowlist, and should strengthen it
while doing so: require that any file permitted to import `child_process`
also uses `execFileSync` and never enables a shell. That leaves the test
stricter than it is today rather than looser.
**Why it was not fixed by `ASES-0001`:** `tools/sdd/tests/validator.test.mjs`
was outside the declared scope of `TASK-010`. The stop protocol forbids
widening a task to cover what the agent turned out to want to change, and an
agent adding its own new file to a security allowlist without approval is
precisely the failure mode this phase exists to prevent.
**Remediation:** `CHG-001` raised `TASK-011`, executed by `ASES-0002` with the
caller files declared **prohibited**, so the session reviewing them could not
edit them. Each caller was verified against six properties before anything was
allowlisted: fixed-argument execution, an explicitly disabled shell, a literal
executable, no untrusted input reaching command text, validated git refs, and
no environment-derived command. The allowlist now authorises by property and
detects stale entries; `spawn`, `fork` and an implicit shell are newly
prohibited. It ends stricter than it began.
**Verification:** `VER-0002` — `ST-002` and `ST-009` pass; the B2 suite is 56
of 56. Twelve synthetic probes confirm the predicates are not vacuous.
**Independent review:** `REV-0002`, `APPROVE`, distinct actor.
**Evidence:** `docs/evidence/phase-b3-agent-integration/allowlist-security-review.md`
**Status:** `RESOLVED`

### CONV-007

**Check:** 6
**Finding:** `agent scope-check --base HEAD` reports the 34 pre-existing
modified application files as scope violations. `scopeFindings` compares the
diff directly and, unlike `driftFindings`, does not subtract the session's
recorded `initialChangedPaths`.
**Evidence:** `node tools/sdd/cli.mjs agent scope-check --spec SPEC-0002
--session ASES-0001 --base HEAD` returns `SDD-V046` for every pre-existing
file.
**Impact:** On a repository with a dirty working tree, the command is
unusable, and it contradicts the documented intent that pre-existing user work
is never attributed to the agent.
**Why it was not fixed by `ASES-0001`:** `tools/sdd/lib/agent.mjs` was outside
the declared scope of `TASK-010`.
**Remediation:** `CHG-001` raised `TASK-012`, executed by `ASES-0003` with the
B2 security test declared **prohibited**, so the session could not relax a
security check to make its own work pass.

The original recommendation — subtract the initial path set — was **rejected
during implementation as unsafe**. A file that was already dirty and is then
modified *again* by the session appears in both sets, so subtraction removes
it and silently authorises the agent's own change. That is a guess in the
permissive direction.

Attribution is therefore decided by content. A session records a SHA-256 for
each initially-changed path, and every changed path classifies as `SESSION`,
`PRE_EXISTING` or `UNATTRIBUTED`. Only `SESSION` is judged against scope;
`UNATTRIBUTED` raises `SDD-V052` review warnings and never a pass.
**Verification:** `VER-0003` — `UT-008` to `UT-017` pass, twelve tests over
real throwaway git repositories. The `ASES-0001` scope check went from 34
`SDD-V046` errors to zero errors and 25 review warnings: the pre-existing
interface work is no longer attributed to any session.
**Independent review:** `REV-0003`, `APPROVE`, distinct actor.
**Status:** `RESOLVED`

### CONV-008

**Check:** 5
**Finding:** `taskScope` reads a test range written as "UT-008 to UT-017" as
two identifiers, not ten. A task naming a range therefore records only its
endpoints in the session, and `SDD-V057` would be satisfied by verifying two
of ten.
**Evidence:** `ASES-0003` records two required tests while `TASK-012` names
ten.
**Impact:** Under-coverage that looks like coverage. No test was actually
skipped here — all twelve ran and passed — but the mechanism would not have
noticed if they had not.
**Resolution:** Explicit enumeration, chosen over implementing range notation.
Range support is not an approved standard anywhere in `docs/sdd/`, and adding
a parser feature to interpret shorthand is more machinery and more ways to be
wrong than simply writing the identifiers out.

Corrected under `CHG-003`:

| Task | Was | Now |
|---|---|---|
| `TASK-012` | "`UT-008` to `UT-017`" | ten identifiers, listed |
| `TASK-011` | "`ST-009`, and the whole B2 suite" | `ST-009`, `ST-002`; the extra run noted as non-normative prose |
| `TASK-010` | "`REG-001`, and the full agent suite" | `REG-001`; the extra run noted as non-normative prose. **The required set is unchanged**, so the basis on which `ASES-0001` was measured is unchanged |
| `TASK-008` | "this task delivers them" | stated as requiring none |

`tasks.md` now carries a rule forbidding ranges and prose in a required-test
declaration.
**Verification:** every `Required tests` declaration across all twelve tasks
was re-parsed with `taskScope` and every identifier resolves to one declared
in `test-plan.md`. No task yields an unresolvable or unplanned identifier.
**Note on `ASES-0003`:** it recorded two required tests because it was created
before this correction. It was **not** rewritten. `VER-0003` records all ten
tests running and passing, so coverage is proven by the verification record.
**Status:** `RESOLVED`

### CONV-009

**Check:** 5
**Finding:** `ASES-0002` and `ASES-0003` carry no recorded digests, because
both were created before `TASK-012` implemented digest capture. Their own
scope checks therefore report review warnings rather than a clean result.
**Evidence:** `agent scope-check --session ASES-0003` reports 0 errors and 25
`SDD-V052` warnings.
**Impact:** None to correctness. The conservative fallback is behaving exactly
as designed, reporting rather than assuming. It does mean the remediation
cannot demonstrate its own clean path on its own session.
**Recommendation:** Accept. A session created after this task does capture
digests, confirmed by building one against this repository read-only, which
produced 55 entries and wrote nothing. Backfilling digests into an existing
record would fabricate evidence about a past moment nobody can verify.
**Status:** `ACCEPTED_RISK`
**Accepted by:** Product Owner · **Decision:** `D7` · **Date:** 2026-09-08
**Scope:** the historical sessions `ASES-0001`, `ASES-0002` and `ASES-0003`
only.
**Rationale as given:** those records predate the digest-based attribution
mechanism. No digest evidence that did not exist at the time may be
fabricated or reconstructed, and none was.
**Forward-looking requirement recorded with the acceptance:** all new
applicable agent sessions must use the current digest and session-state
capture mechanism, so that pre-existing work, session-introduced changes and
unattributable changes are distinguished according to the current standard.
**Already demonstrated:** `ASES-0004` is the first session created under the
new mechanism. It captured 55 digests, correctly attributed 41 pre-existing
paths as untouched, and reported 12 directory entries as unattributable for
review.

### CONV-010

**Check:** 12
**Finding:** The convergence standard has no status for *"a limitation that is
recorded, recommended for acceptance, and awaiting a human decision"*.
`specs/templates/CONVERGENCE_TEMPLATE.md` permits `OPEN`, `RESOLVED`,
`ACCEPTED_RISK` and `NOT_APPLICABLE`, and requires a named functional-role
owner for `ACCEPTED_RISK`.

Four findings in this specification were previously marked `ACCEPTED_RISK`
with the owner recorded as unresolved. That combination is not permitted by the
standard and overstated their status: nobody had accepted them. All four are
now `OPEN`.
**Evidence:** `specs/templates/CONVERGENCE_TEMPLATE.md` lines defining the four
statuses and the owner requirement.
**Impact:** `OPEN` cannot distinguish "needs engineering work" from "needs only
a human signature". `CONV-004` and these four now share a status while
requiring very different actions. The distinction is carried in the
**Awaiting** line of each finding, which is prose the validator cannot check.
**Recommendation:** Add a `PENDING_RISK_ACCEPTANCE` status to the convergence
standard, permitted only where a recommended disposition and a required
accepting role are both named.
**Why it was not implemented unilaterally:** `specs/templates/CONVERGENCE_TEMPLATE.md`
is a Phase B1 governance artefact. Extending a normative status vocabulary to
make this phase read better is precisely the kind of edit that must not be
made by the phase that benefits from it.
**Resolution:** QA / Release Engineering selected **Option A** (`D8`,
2026-09-08). The four existing statuses remain authoritative and no new status
is added. `OPEN` is confirmed as the canonical pre-acceptance status,
covering unresolved engineering work, pending governance action and a residual
risk awaiting human acceptance alike; the owner, reason and required-decision
fields distinguish the three.

`specs/templates/CONVERGENCE_TEMPLATE.md` now documents this interpretation,
including that a residual risk transitions `OPEN` → `ACCEPTED_RISK` only on an
authorised human acceptance, and that an AI may recommend acceptance and never
record it.
**Status:** `RESOLVED`

### CONV-011

**Check:** 4
**Finding:** `SPEC-0002` fails the rule it commissioned. `SDD-V060` reports
that its specification approval is dated 2026-09-08 while it entered
`APPROVED_FOR_IMPLEMENTATION` on 2026-09-07, so the gate was crossed before it
was approved.

`node tools/sdd/cli.mjs validate --all` returns **1 error**, and the B2
self-check `IT-005/006` fails with it.
**Evidence:** `sdd.json` approval date against `statusHistory`; `VER-0006`;
`REV-0007` records it as a BLOCKER.
**Impact:** **Blocking.** `D10` eligibility requires `validate --all` to have
no ERROR, and it has one.
**This was predicted, not discovered late.** `CHG-005` recorded the expected
outcome before `TASK-015` was executed: *"the rule is therefore expected to
fire on this specification. That is the correct result … the rule is not being
softened to avoid that outcome."*
**Why it cannot be fixed by editing an artefact:** the dates are history. The
approval genuinely came after implementation, which is the deviation
`CONV-004` has recorded from the beginning. Changing either date would be
falsification.
**Options, all of which belong to a human:**

1. Grant a scoped, expiring validation exception naming `SDD-V060` and
   `SPEC-0002` only. A draft is prepared in
   `docs/evidence/phase-b3-agent-integration/validation-exception-proposal.md`;
   it is a proposal, not an entry in the register, and no agent may approve it.
2. Accept the failing validation state explicitly and take `D10` with it
   recorded.
3. Reject, and treat the ordering breach as disqualifying.

**Not an option:** softening `SDD-V060`, or narrowing it so this
specification escapes. The rule was written to catch exactly this.
**Resolution:** the Solution Architect approved a scoped historical exception,
`EXC-001`, on 2026-09-08. Route 1 of the three above.

Neither date was altered. `SDD-V060` was not weakened, narrowed, or given a
specification-aware branch. The generic mechanism that gives the decision
effect was built under `CHG-006` / `TASK-017`, and `UT-045` asserts it
contains no hard-coded specification or exception identifier.

The condition still exists and is still reported. It now appears at `INFO`
severity reading *"EXCEPTED under EXC-001: Specification approval is dated
after the specification entered APPROVED_FOR_IMPLEMENTATION"*. It was
downgraded, never deleted.
**Proof the rule survives:** `UT-044` — a synthetic R3 specification with a
late approval and no exception still fails `SDD-V060`. `UT-037`, `UT-038`
and `UT-043` prove the exception covers only this rule on this specification
and nothing else.
**Non-precedential.** It authorises no future R3 implementation transition
without timely specification approval.
**Status:** `RESOLVED`

### CONV-012

**Check:** 5
**Finding:** `ASES-0004` produced an out-of-scope change.
`docs/EVIDENCE_CONFLICTS.md` was edited for `D2` governance work while the
session was open for `TASK-013`, whose declared scope was the workflow file
alone. The scope checker reported `SDD-V046` correctly.
**Evidence:** `ASES-0004`, `VER-0004`, and `REV-0005` finding 2.
**Impact:** Process, not product. The `TASK-013` deliverable is correct,
verified and independently reviewed; `CONV-005` remains legitimately
`RESOLVED` on that basis. What failed was sequencing: the `D2` corrections
should have been completed before the session was opened.
**What was done about it:** the deviation was recorded in three artefacts and
the task was **not** widened to absorb it. No retroactive session was created
to cover work that had already happened. An audit on 2026-09-08 additionally
corrected `VER-0004` and `ASES-0004` from `PASS` to `PARTIAL`, because a
result of `PASS` sat above a command that had returned exit 1.
**Recommendation:** accept as a recorded process deviation. The compensating
control is the one that caught it: scope checking works, and it caught its own
operator.
**Status:** `ACCEPTED_RISK`
**Accepted by:** Product Owner · **Date:** 2026-09-08 · **Scope:** `CONV-012`
only.
**Acknowledged facts, as stated by the accepting role:** `ASES-0004` remains
`PARTIAL`; `VER-0004` remains `PARTIAL`; `SDD-V046` correctly detected an
out-of-scope change; the session scope was not widened retroactively; the
deviation has not been erased or rewritten; the intended `D6` CI remediation
was separately verified and independently reviewed.
**Rationale as given:** accepted as a historical execution-process risk.
**Compensating controls recorded with the acceptance:** session scope checks
remain mandatory; detected scope deviations remain visible; `PARTIAL`
historical records remain immutable; future work must stop or use formal
scope-change governance rather than silently widening scope.
**Explicitly not authorised by this acceptance:** future scope violations, and
agents widening task scope after detecting an out-of-scope change.
**Evidence:** `ASES-0004`, `VER-0004`, `REV-0005`;
`docs/evidence/phase-b3-agent-integration/conv-disposition-packets.md`.

### CONV-013

**Check:** 4
**Finding:** `UT-025` fails. It asserted that `SPEC-0002` reads back as `PASS
WITH ACCEPTED LIMITATIONS`, pinning a value that this very convergence re-run
legitimately changed to `FAIL`. The test was brittle: it should have asserted
the parser invariant, that whatever verdict is declared round-trips exactly,
rather than one particular verdict.
**Evidence:** B2 suite 76 of 78; `UT-025` and `IT-005/006` fail.
**Impact:** The parser itself is correct — `UT-018` to `UT-024` all pass and
the multi-word verdict is proven not to collapse. Only the assertion pinned to
a moving value is wrong.
**Remediation prepared and blocked:** `TASK-016` was raised under the
`CHG-005` amendment, scoped to the test file alone with the parser declared a
prohibited path so the fix cannot be made by editing the code under test.
**Preflight refused to open a session for it**, because `CONV-011` was a
blocking validation error and no agent action is authorised while one stands.
There is no override and none was sought.
**Resolution:** once `EXC-001` took effect, preflight passed and `TASK-016`
ran through the normal control plane as `ASES-0007`, verified by `VER-0007`
and reviewed by `REV-0008`. Preflight was not bypassed at any point.

The assertion now reads the verdict declaration out of the document
independently and requires the parser to return exactly that, plus a
round-trip of all three permitted verdicts. It checks strictly more than the
assertion it replaces and still fails the moment prefix matching returns.
The parser was a prohibited path for the task, so the test could not be made
to pass by editing the code under test.
**Status:** `RESOLVED`

### CONV-014

**Check:** 5
**Finding:** `TASK-017`, the exception mechanism, was executed **outside an
agent session**. Preflight refuses to authorise a session while a blocking
validation error stands, and the blocker was `SDD-V060` on this
specification — the exact finding the exception exists to cover. The control
could not authorise the work that removes the blocker.
**Evidence:** `CHG-006`; `TASK-017` execution note; the refused preflight
recorded in `CONV-013`.
**Impact:** Process, not product. The mechanism is generic, deterministic and
covered by eleven tests, and no session record was fabricated for work that
had no session.
**Why it could not be avoided:** the same shape as `CONV-003`. A control
cannot govern its own construction. The alternative was to leave an approved
human decision with no means of taking effect.
**What bounds it:** the boundary is visible rather than smoothed over.
`TASK-017` ran ungoverned; `TASK-016`, immediately afterwards, ran through
preflight, session, scope check, verification and independent review. The line
between them is exactly where the exception took effect.
**Recommendation:** accept as a recorded bootstrap deviation. The compensating
control is that the mechanism it produced is generic and adversarially tested,
including a test asserting it contains no specification-specific branch.
**Status:** `ACCEPTED_RISK`
**Accepted by:** Product Owner · **Date:** 2026-09-08 · **Scope:** `CONV-014`
only.
**Acknowledged facts, as stated by the accepting role:** `SDD-V060` was
already blocking preflight; no generic exception capability yet existed;
creating a retroactive session would have falsified history; `TASK-017` was
truthfully recorded as outside normal session governance; after `EXC-001`
became available, subsequent applicable work returned to the standard
preflight, session, verification and review workflow.
**Rationale as given:** accepted as a narrowly scoped historical bootstrap
risk. **Non-precedential.**
**Compensating controls recorded with the acceptance:** the exception
mechanism is now available; exceptions remain structured, scoped and visible;
malformed or unauthorised exceptions fail closed; future applicable work must
use normal preflight and agent-session controls.
**Explicitly not authorised by this acceptance:** future work outside
agent-session governance; bypassing a failed preflight; arbitrary creation of
validation exceptions; retroactive session fabrication; weakening `SDD-V059`
or `SDD-V060`.
**No retroactive session was created**, and none may be.
**Evidence:** `CHG-006`; `TASK-017` execution note;
`docs/evidence/phase-b3-agent-integration/conv-disposition-packets.md`.

### CONV-015

**Check:** 15
**Finding:** the `D9` human code review predates `TASK-014` to `TASK-017`,
which changed governance trust-boundary tooling — including a mechanism that
can downgrade a validator ERROR. `REV-0004` is truthful about what it covered
and does not cover this.
**Evidence:** `REV-0004` scope statement; the eight post-`D9` files listed in
`docs/evidence/phase-b3-agent-integration/d9-addendum-review-packet.md`.
**Impact:** R3 requires one human reviewer, and no human has reviewed the
exception mechanism, `SDD-V059`, `SDD-V060` or the verdict parser.
**Remediation prepared:** an addendum packet, with the thirteen review
questions answered from test evidence for the reviewer to verify rather than
inherit. The original `D9` review is **not** replaced.
**Resolution:** a qualified human reviewer approved the supplemental review of
the post-`D9` control-plane changes on 2026-09-08. Recorded as `REV-0009`
with `actorType: "human"`.

The decision supplied was `APPROVE` with no findings stated, so none are
recorded and none were invented. The original `REV-0004` is **not** replaced;
both reviews stand, covering the pre-`D9` and post-`D9` control plane
respectively.
**Evidence:** `REV-0009`;
`docs/evidence/phase-b3-agent-integration/d9-addendum-review-packet.md`.
**Status:** `RESOLVED`

## Approval gate status

Two distinct questions about R3 approval, deliberately kept apart.

**Question A — does R3 require an implementation-readiness approval?**
**No, and this is unambiguous.** Six sources agree with no dissent found:
`docs/RISK_CLASSIFICATION.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`,
`docs/sdd/HUMAN_APPROVAL_GATES.md` gate 5, `docs/sdd/SPEC_LIFECYCLE.md`,
`docs/sdd/SDD_WORKFLOW.md`, and `tools/sdd/lib/lifecycle.mjs`. An agent is
permitted to execute at R3.

**Question B — who may approve an R3 specification?**
**Settled by decision `D2` (Solution Architect, 2026-09-08): Option A.** An R3
specification must be approved by a Product Owner or Solution Architect before
implementation begins. The register entry records the resolution, the six
documents corrected, and the original disagreement.

Under that policy the gate was required and this specification crossed it.
`D1` supplies the approval and `CONV-004` is resolved on that basis, not
dissolved by the policy choice.

| Gate | Required at R3 | Status |
|---|---|---|
| 1. Specification approval | yes — settled by `D2`, Option A | **APPROVED** (`D1`, 2026-09-08). Crossed at the time; the approval now exists |
| 2. Architecture approval | yes, a new pattern is introduced | **APPROVED** (`D3`, Solution Architect) |
| 3. Security risk acceptance | yes, a threat model was required | **ACCEPTED** (`D4`, Application Security) |
| 5. Implementation readiness | **no — R4 and R5 only** | **not required**, unambiguous across seven sources |
| 6. Convergence acceptance | yes, reviewer | **NOT TAKEN** — `D10`, explicitly withheld |
| 9. Accepted residual risk | yes, one per accepted limitation | **RECORDED** — `D4`, `D5`, `D7`, each with a named owner |
| Infrastructure change (R5) | for the CI step | **AUTHORISED** (`D6`) and remediated under `CHG-004` |
| 4. Data model / migration | no schema change | not applicable |
| 7. Production release | nothing is released | not applicable |

Approval records now exist because a human made the decisions and stated the
role for each. They were recorded verbatim in substance and none was
broadened: `D1` approved the specification and nothing else, `D3` the
architecture and nothing else, and so on.

**No role was inferred.** Each decision named the role it was exercised under.
`D1` left the choice between Product Owner and Solution Architect unstated;
gate 1 accepts either, so the gate is discharged, and the record says the
specific role was not stated rather than guessing one.

`D10`, convergence acceptance, was explicitly withheld and is not recorded.

## Unrequested behaviour

One item, disclosed rather than left in the diff.

`validate()` in `tools/sdd/lib/validate.mjs` was changed so that
specification filtering no longer breaks cross-specification reference
resolution. No `SPEC-0002` requirement asked for it. It was a pre-existing
defect in `SPEC-0001` tooling, discovered while `SDD-V016` produced false
positives under `--spec`, and fixing it was necessary for the agent commands
to work at all.

The alternative, adjusting artefacts to avoid triggering a tooling bug, would
have recorded a validator defect as a documentation problem. It is disclosed
here and in `docs/evidence/phase-b3-agent-integration/validation-rule-audit.md`.

## Verification summary

| Check | Command | Result |
|---|---|---|
| Agent control plane | `node --test tools/sdd/tests/agent.test.mjs` | 48 of 48 pass |
| Validator suite | `node --test tools/sdd/tests/validator.test.mjs` | 56 of 56 pass; grew from 54 by the two `ST-009` tests |
| Scope attribution | `agent scope-check --session ASES-0001` | 0 errors, 25 review warnings; was 34 errors |
| Sessions and reviews | `agent verify-session`, `agent review-check` | 3 sessions, 3 verifications, 3 reviews, all valid |
| Artefact validation | `node tools/sdd/cli.mjs validate --all` | `PASS`, 0 errors, 0 warnings |
| Rule catalogue agreement | code against documentation, both directions | 58 rules, 0 undocumented, 0 unimplemented |
| Build, types, lint, format | not run | B3 changed no application code |
| Schema drift, RLS, raw SQL | not run | no schema, tenant table or raw SQL touched |

The application checks were not run because nothing in the application
changed. That is stated rather than reported as a pass.

## Rollback

Every file this phase produced is untracked. Removing `tools/sdd/lib/agent.mjs`,
`tools/sdd/tests/agent.test.mjs`, the agent fixtures, the seven agent standards,
the three schemas and templates, and reverting the additive sections of
`AGENTS.md`, `CLAUDE.md`, `docs/sdd/VALIDATION_RULES.md`,
`docs/sdd/IDENTIFIER_STANDARD.md` and `docs/sdd/SDD_WORKFLOW.md` returns the
repository to its B2 state.

No migration, no deployment, no infrastructure change, nothing to undo outside
the working tree.

## Verdict

**Recommended: `PASS WITH ACCEPTED LIMITATIONS`.**

B2 is 89 of 89, B3 is 48 of 48, and `validate --all` returns no error. No
finding is `OPEN`: ten are `RESOLVED` and five are `ACCEPTED_RISK`, each
with a named functional-role owner.

**Not `PASS`, and the difference is the point.** Five limitations are
*accepted*, not solved:

| Finding | What remains true | Owner |
|---|---|---|
| `CONV-001` | Separation of duty compares recorded labels, not judgement | Application Security |
| `CONV-003` | Most of this phase predates its own governance | Product Owner |
| `CONV-009` | Three sessions carry no digests | Product Owner |
| `CONV-012` | A real scope deviation happened during `ASES-0004` | Product Owner |
| `CONV-014` | The exception mechanism was built outside session governance | Product Owner |

Each carries the compensating controls its accepting role specified. None is
fixed by having been accepted.

**A correction carried from the previous run.** That run recommended `PASS
WITH ACCEPTED LIMITATIONS` while two findings were still `OPEN`, which the
standard does not permit. It was corrected to `FAIL` and now returns to `PASS
WITH ACCEPTED LIMITATIONS` on a different basis: the findings were
dispositioned by a human, not reclassified by an agent.

And `SPEC-0002` still fails `SDD-V060` on the facts. That has not been made
untrue. It is excepted under `EXC-001`, reported at `INFO` on every run, and
the rule remains fully enforced everywhere else.

The reason this is not `PASS` is unchanged and deliberate: three residual
risks are **accepted, not fixed**. Separation of duty still compares labels
rather than judgement. Most of this phase still predates its own governance.
Three sessions still carry no digests. Each has a named human owner and the
compensating controls that owner specified.

Two process findings, `CONV-012` and `CONV-014`, remain `OPEN` awaiting a
human disposition. Neither is a product defect and neither is labelled
`ACCEPTED_RISK`, because no human has accepted either.

And `SPEC-0002` still fails `SDD-V060` on the facts. That has not been made
untrue — it is excepted under `EXC-001`, reported at `INFO` on every run, and
the rule remains fully enforced for everything else.

`FAIL` is the correct value because the standard defines the alternatives out
of reach. `specs/templates/CONVERGENCE_TEMPLATE.md` permits `PASS` only when
no finding is `OPEN`, and `PASS WITH ACCEPTED LIMITATIONS` only when every
open finding is `ACCEPTED_RISK` **with a named human owner**. Six findings are
`OPEN` and none has an accepting owner, because no human has accepted
anything. **Two checks fail materially**: check 13, residual risk accepted by
the right role; and check 15, human review completed at the level R3 requires
— no human has reviewed the change, and architecture approval is outstanding.
The standard's own consequence for `FAIL` — the specification stays at
`IMPLEMENTING` — is exactly where `SPEC-0002` sits.

The honest phase status is **TECHNICALLY READY — AWAITING HUMAN GOVERNANCE
DECISIONS**. The standard has no verdict for that, which is `CONV-010`.

Ten findings across three passes. Four resolved, six open.

| Finding | Status | Awaiting |
|---|---|---|
| `CONV-001` separation checks labels, not judgement | `OPEN` | risk acceptance — Application Security |
| `CONV-002` forward references failed the self-check | `RESOLVED` | — |
| `CONV-003` bootstrap boundary | `OPEN` | risk acceptance — Product Owner |
| `CONV-004` specification approval gate crossed | `OPEN` | specification approval, and `EVC-015` |
| `CONV-005` agent tests not in CI | `OPEN` | risk acceptance — DevOps |
| `CONV-006` stale security allowlist | `RESOLVED` via `TASK-011` | — |
| `CONV-007` scope attribution | `RESOLVED` via `TASK-012` | — |
| `CONV-008` unresolvable test shorthand | `RESOLVED` via `CHG-003` | — |
| `CONV-009` remediation sessions predate digests | `OPEN` | risk acceptance — Product Owner |
| `CONV-010` no status for "awaiting acceptance" | `OPEN` | the owner of the convergence standard |

**No finding is marked `ACCEPTED_RISK`, because nobody has accepted one.**
Four previously carried that status with an unresolved owner, which the
standard does not permit and which overstated them. An AI may recommend
acceptance; it may not record it. Each open finding carries a recommended
disposition and the role that must decide.

`CONV-006` and `CONV-007` were the two defects `ASES-0001` found in its own
work and refused to fix, because each needed a file outside its approved
scope. Both are now closed the long way round: a change record, a new task
with its own declared scope, a new session, its own verification, and an
independent review by a distinct actor. Neither task could fix its own grade —
`TASK-011` was forbidden from editing the callers it reviewed, and `TASK-012`
was forbidden from editing the security test that judged it.

`ASES-0001` was not reopened. Its `PARTIAL` result and `REV-0001`'s
`REQUEST_CHANGES` stand as the record of what that session actually produced.
Rewriting them would have destroyed the evidence that the control worked.

**No finding is `OPEN`.** Seven are `RESOLVED` and three are
`ACCEPTED_RISK`, each naming the human who accepted it, the scope of the
acceptance and the compensating controls recorded with it.

The three accepted risks are not closed problems. Separation of duty still
proves labels rather than judgement; the bootstrap boundary still means most
of this phase predates its own governance; three sessions still carry no
digests. They are accepted, with owners, which is a different thing from
fixed.

**The recommendation is not an acceptance.** Four of the gates R3 requires are
unresolved, the accepted risks have no named human owner, and `CONV-004` is
open. At R3 a human accepts convergence. **This specification is not
converged.**

On the two R3 questions: implementation-readiness approval is **not required**
at R3, unambiguous across seven sources. Specification-approval authority was
**unsettled** and is now settled by `D2`, Option A. Full position:
`docs/evidence/phase-b3-agent-integration/r3-approval-rule-resolution.md`.

**A scope deviation occurred during the `D6` remediation and is recorded, not
waived.** `docs/EVIDENCE_CONFLICTS.md` changed while `ASES-0004` was open,
from concurrent `D2` governance work outside `TASK-013`'s declared scope. The
scope checker reported it as `SDD-V046`; it is recorded in `ASES-0004`,
`VER-0004` and `REV-0005`. The task scope was not widened to absorb it. The
correct sequencing would have finished the `D2` corrections before opening the
session.
