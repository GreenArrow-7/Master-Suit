# SPEC-0002 — Change record

Changes made after the specification entered `APPROVED_FOR_IMPLEMENTATION`.
Historical approved intent is never erased; each entry says what changed, why,
and what it affects (`docs/sdd/CHANGE_CONTROL.md`).

## CHG-001

**Date:** 2026-09-07
**Type:** scope addition
**Raised by:** convergence review of `SPEC-0002`
**Trigger:** `CONV-006` and `CONV-007`, two defects found by `ASES-0001` in the
session's own output and deliberately left unfixed because each needed a file
outside `TASK-010`'s declared scope.

### What changes

Two tasks are added, each with its own declared scope and its own execution
session. Neither reuses `TASK-010`, and `ASES-0001` is not reopened.

| Added | Purpose | Resolves |
|---|---|---|
| `TASK-011` | Review and update the security allowlist governing git subprocess callers | `CONV-006` |
| `TASK-012` | Correct scope attribution so it evaluates the session-introduced delta | `CONV-007` |

Eleven test identifiers are added to `test-plan.md`: `ST-009` for the
allowlist property check, and `UT-008` to `UT-017` for session-delta
attribution.

### What does not change

No requirement, acceptance criterion or security requirement is amended. No
existing task is edited, reopened or re-scoped. `TASK-010` stays `DONE` and
`ASES-0001` stays `PARTIAL` with its findings intact.

The two new tasks serve requirements that already exist: `TASK-011` serves
`SEC-001` and `SEC-003`; `TASK-012` serves `FR-004`, `FR-006` and `NFR-002`.
Neither adds a capability the specification did not already require. `FR-004`
already says scope enforcement evaluates what the session changed; `CONV-007`
found the implementation did not do that.

### Why a change record rather than widening the original task

`docs/sdd/AGENT_STOP_PROTOCOL.md` forbids widening a task's declared scope to
cover what the agent turned out to want to change, and `AGENTS.md` requires
work that grows beyond its scope to stop and raise a change record. `CONV-006`
in particular would have had an agent add its own new file to a security
allowlist, which is the failure mode the phase exists to prevent.

### Approval status

**UNRESOLVED.** No specification approval exists for `SPEC-0002` and none is
fabricated for this change record. See `spec.md` and `EVC-015`.

### Traceability

`CONV-006` → `TASK-011` → `ASES-0002` → `VER-0002` → `REV-0002`
`CONV-007` → `TASK-012` → `ASES-0003` → `VER-0003` → `REV-0002`

## CHG-002

**Date:** 2026-09-07
**Type:** correction of a recorded assessment
**Raised by:** the R3 approval-rule determination required before this
convergence pass.

### What changes

The approval-gate table in `spec.md` is corrected in two places.

| Gate | Was recorded | Now recorded | Why |
|---|---|---|---|
| Security risk acceptance | "not required at R3 — threat model produced voluntarily" | **required, UNRESOLVED** | `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 3 is triggered whenever a threat model is required. This specification implements security controls and carries `SEC-001` to `SEC-006`, so the threat model was required, not voluntary. The earlier entry took the reading that was easier to pass |
| Architecture approval | UNRESOLVED, no basis given | **required, UNRESOLVED**, basis stated | Gate 2 applies at R3 "when a new pattern … is introduced". The agent execution record is a new pattern |

The gate-5 entry, "Implementation readiness — not required at R3", is
**confirmed correct** and is not changed. See
`docs/evidence/phase-b3-agent-integration/r3-approval-rule-resolution.md`.

### What does not change

No approval is granted, recorded or implied. Both corrected gates move from a
softer description to a stricter one, and both remain unresolved.

### Traceability

`EVC-015` → `CHG-002` → `spec.md` approval section → `convergence.md`
`CONV-004`

## CHG-003

**Date:** 2026-09-07
**Type:** minor clarification
**Raised by:** governance closure pass, resolving `CONV-008`.

### What changes

Test identifiers in `tasks.md` are enumerated rather than abbreviated. Four
declarations carried shorthand the parser could not resolve deterministically.

| Task | Was | Now |
|---|---|---|
| `TASK-012` | a range, `UT-008` to `UT-017` | ten identifiers, listed |
| `TASK-011` | `ST-009` plus "the whole B2 suite" | `ST-009`, `ST-002` |
| `TASK-010` | `REG-001` plus "the full agent suite" | `REG-001` |
| `TASK-008` | "this task delivers them" | stated as requiring none |

A rule is added to the scope-discipline section of `tasks.md` forbidding
ranges and prose in a required-test declaration.

### What does not change

**No required test set is enlarged or reduced.** The parser already read
`TASK-010` as requiring `REG-001` alone and `TASK-011` as requiring `ST-009`;
the prose contributed no identifiers and was inert. Making it non-normative
italic text removes the discrepancy between what a human reads and what the
tooling enforces, without altering what any completed session was measured
against.

`TASK-012` is the one case where the shorthand was actively misleading: it
appeared to name ten tests while the parser took two. All ten had in fact been
run and recorded in `VER-0003` before this correction.

No requirement, acceptance criterion, task scope or session record is amended.
`ASES-0003` keeps the two required tests it recorded at creation; it was not
rewritten.

### Why range notation was not implemented instead

Range support is not an approved standard anywhere in `docs/sdd/`. Adding a
parser feature to interpret shorthand is more machinery, and more ways to be
wrong, than writing ten identifiers out once.

### Approval status

**UNRESOLVED.** No specification approval exists for `SPEC-0002` and none is
fabricated for this change record.

### Traceability

`CONV-008` → `CHG-003` → `tasks.md` → re-parsed with `taskScope`, all twelve
tasks resolve to identifiers declared in `test-plan.md`

## CHG-004

**Date:** 2026-09-07
**Type:** scope addition
**Raised by:** `D6`, DevOps / Production Engineering decision on `CONV-005`
**Authorisation:** DevOps / Production Engineering, decision REQUIRE
REMEDIATION, recorded 2026-09-07. This is the infrastructure approval that
`CL-005` named and left open.

### What changes

`TASK-013` is added: extend the dedicated non-production SDD validation
workflow so it runs the B2 validator suite, the B3 agent-control suite, and
`validate --all`.

`CL-005` decided **No** on this change in the absence of authorisation. That
decision was correct when it was made and is not rewritten. `D6` supplies the
authorisation `CL-005` was waiting for, and `CHG-004` records the transition.

### Constraints carried from the authorising decision

The workflow must not deploy, must not access production or staging, must
require no production secret, must connect to no database, must run no
migration, must not change application runtime behaviour, and must not promote
`SDD-V041` from `WARNING` to `ERROR`.

### What does not change

No requirement, acceptance criterion or existing task is amended. No
application code, dependency, schema or migration is touched. `CL-005` keeps
its original decision text.

### Verification boundary

Repository-local verification may be recorded as `VERIFIED`. The
GitHub-hosted result remains `UNKNOWN — requires runtime/infrastructure
verification` until the workflow is pushed and actually executes. Nothing in
this change record asserts otherwise.

### Traceability

`CONV-005` → `D6` → `CHG-004` → `TASK-013` → `ASES-0004` → `VER-0004` →
`REV-0005`

## CHG-005

**Date:** 2026-09-08
**Type:** scope addition
**Raised by:** two control-plane defects found while recording the `D1`–`D9`
decisions, and reported rather than fixed opportunistically at the time.

### What changes

| Added | Purpose | Closes |
|---|---|---|
| `TASK-014` | Exact-match the convergence verdict instead of prefix-matching it | known limitation 11 |
| `TASK-015` | Enforce R3 specification approval mechanically | known limitation 10 |

Sixteen test identifiers are added to `test-plan.md`: `UT-018` to `UT-025`
for the parser, `UT-026` to `UT-035` for the approval rule.

### Why now

Both defects were discovered after `D1`–`D9` were recorded and were left
unfixed because no authorised task scope covered `tools/sdd/`. This change
record supplies that scope. Neither defect was introduced by the decisions;
both pre-date them.

`TASK-015` implements the policy `D2` selected. It does **not** reconsider it,
and it does not touch the register: `docs/EVIDENCE_CONFLICTS.md` is a declared
prohibited path for the task, so the implementing session cannot alter any
conflict entry. Status of `EVC-015` is the register's to state, not this
specification's.

### What does not change

No requirement or acceptance criterion is amended. No existing task is
reopened. No convergence finding is reworded to suit the new rule. Application
code, dependencies, schema and migrations are untouched.

### Anticipated consequence, stated before the work

`TASK-015` enforces that a specification approval precedes implementation.
`SPEC-0002`'s own approval is dated 2026-09-08 and its
`APPROVED_FOR_IMPLEMENTATION` transition is dated 2026-09-07. The rule is
therefore expected to fire on this specification. That is the correct result:
the gate genuinely was crossed, which is why `CONV-004` exists.

The rule is not being softened to avoid that outcome.

### Amendment, 2026-09-08

`TASK-016` is added. The convergence re-run changed this specification's own
verdict, which broke a `TASK-014` test that had pinned the value rather than
the invariant. The test is corrected under its own bounded task with the
parser declared a prohibited path, so it cannot be made to pass by editing the
code under test.

### Traceability

known limitation 11 → `CHG-005` → `TASK-014` → `ASES-0005` → `VER-0005` → `REV-0006`
known limitation 10 → `CHG-005` → `TASK-015` → `ASES-0006` → `VER-0006` → `REV-0007`
brittle test → `CHG-005` amendment → `TASK-016` → `ASES-0007` → `VER-0007`

## CHG-006

**Date:** 2026-09-08
**Type:** scope addition
**Raised by:** the `EXC-001` decision — a Solution Architect approved a scoped
historical exception to `SDD-V060` for `SPEC-0002`.
**Authorisation:** Solution Architect, recorded 2026-09-08.

### What changes

`TASK-017` is added: implement the generic exception mechanism. The register
in `docs/sdd/VALIDATION_EXCEPTIONS.md` described exceptions but nothing
enforced them, so the approved decision had no effect until a mechanism
existed.

The mechanism is generic and deterministic. It contains no
specification-specific branch, and `UT-045` asserts that no hard-coded
specification or exception identifier appears in it.

### The bootstrap constraint, stated rather than worked around

Preflight refuses to authorise a session while a blocking validation error
stands. The blocker was `SDD-V060` on this specification — the exact finding
the exception exists to cover. The control could not authorise the work that
removes the blocker.

`TASK-017` was therefore executed **outside a session**. This is the same
class of deviation as `CONV-003`, and it is recorded as `CONV-014` rather
than disguised. No session record was fabricated for it.

Once `EXC-001` took effect, preflight passed and `TASK-016` was executed
through the normal control plane, which is how the boundary can be seen.

### What does not change

No requirement or acceptance criterion is amended. `SDD-V059` and `SDD-V060`
are unchanged — neither was weakened, narrowed, or given a specification-aware
branch. No date was altered anywhere.

### Traceability

`CONV-011` → `EXC-001` → `CHG-006` → `TASK-017` → `CONV-014`

---

## CHG-007

**Date:** 2026-09-08
**Type:** defect remediation
**Raised by:** `SPEC-0003/CONV-008` — the B4 pilot found that the task-scope
parser reads prose and can produce an incorrect scope boundary.
**Authorisation:** requested by the human directing Phase B4, who instructed
that the defect be remediated before `SPEC-0003` convergence rather than
accepted to close the pilot.

### The defect

`taskScope()` in `tools/sdd/lib/agent.mjs` captures the lines between a
`**Allowed scope:**` or `**Prohibited paths:**` marker and the next bold
marker, then harvests **every backticked token** on those lines. It never
checks that a token is a path, and it cannot tell that prose in the same
region may describe a boundary that was never backticked.

Two failure modes, both observed in real artefacts:

1. **A non-path token becomes a path.** `SPEC-0003/TASK-003` declared
   "a new Playwright spec under `apps/web/tests/e2e/`, named `tablesearch-a11y`"
   and the parser returned `['apps/web/tests/e2e/', 'tablesearch-a11y']`.
   `SPEC-0001/TASK-012` is worse: its allowed scope cites `CHG-001` in prose,
   and the parser returns `CHG-001` as an **allowed path**.
2. **A prose boundary is silently dropped.** The same `TASK-003` prohibited
   "the Playwright and Vitest configuration files", which carry no backticks
   and therefore never entered the prohibited list at all.

Mode 2 is the dangerous one: a prohibited path that silently fails to parse
under-restricts the session, and the scope check then passes a change it
existed to catch. `unsafeScopeReason()` does not help — it checks traversal,
absoluteness and symlinks, not whether a token is a path at all, so
`CHG-001` passes every safety test it applies.

A third latent case: `SPEC-0001/TASK-009` declares `tools/sdd/tests/**`, a
glob, which `CL-002` forbids and the parser accepted.

### What changes

`taskScope()` gains a grammar for a scope entry, taken from `CL-002` — exact
paths and directory prefixes only, no globs, no patterns — and classifies
every backticked token in a scope declaration as a path, a known identifier,
or malformed. It also detects prose in a declaration region, because a
declaration that mixes prose with paths cannot be trusted to be complete.

`taskScope()` returns a new `problems` array. Non-path tokens are **excluded**
from `allowed` and `prohibited` rather than admitted as paths.

One rule is added:

- `SDD-V062`, **ERROR** — the task a session is about to act on has a
  malformed scope declaration. Preflight refuses; no session is created.

**Amended before implementation.** The first draft of this record proposed a
second, repository-wide `WARNING` rule so that existing prose declarations
would surface as debt during `validate --all`. That was dropped for two
reasons, both discovered while reading the code rather than assumed:

1. Emitting it would require editing `tools/sdd/lib/validate.mjs`, which
   `TASK-018` declares a **prohibited path**. Widening the task to reach it is
   precisely the move this framework exists to prevent, so the rule was
   dropped rather than the boundary moved.
2. It would have been inconsistent anyway. Every existing scope rule —
   `SDD-V045` and `SDD-V056` — is emitted from `tools/sdd/lib/agent.mjs` at
   preflight and scope-check, never from the whole-repository validator. Scope
   is checked when a session acts, not when a document is read.

Blocking at preflight puts enforcement exactly where a wrong boundary can
cause harm: the moment work begins. It also avoids retroactively failing
`SPEC-0001` and `SPEC-0002`, whose historical tasks contain the very prose
this change detects.

**The consequence is stated rather than hidden:** existing malformed
declarations in `SPEC-0001` remain invisible to `validate --all` and will
surface only when someone opens a session on those tasks. That is recorded as
a known limitation of this remediation, not as a solved problem.

### What does not change

No rule is weakened. `SDD-V056` keeps its severity and meaning. No existing
task is rewritten by this change; the declarations it flags stay flagged.
`CL-002` is not amended — this change makes the parser obey it.

### Traceability

`SPEC-0003/CONV-008` → `CHG-007` → `TASK-018` → `SDD-V062`

---

## CHG-008

**Date:** 2026-09-08
**Type:** defect remediation
**Raised by:** `SPEC-0003/CONV-009`, the residual half of `SPEC-0003/CONV-008`,
and the meta-artefact gap disclosed by `ASES-0008`.
**Authorisation:** requested by the human directing Phase B4, who instructed
that the control-plane work be finished before human convergence decisions and
that `CONV-009` not be accepted as a risk merely to close the pilot.

Three tasks, each with its own session, because the three defects are
independent and share no file beyond the module they all live in.

### The three defects

**1. Historical sessions are re-validated against the live repository.**
`sessionDelta()` reads `gitStatusPaths()` — the working tree *now* — and
`attribute()` compares each file's *current* digest against `initialDigests`.
A session record therefore captures where the session **started** and nothing
about where it **ended**, so "changed by this session" and "changed after this
session ended" are indistinguishable on any later run.

Observed three times in one pass: `ASES-0001` was blamed for the test file
`ASES-0002` created; `ASES-0003` and `ASES-0008` were both blamed for the edit
`ASES-0004` made under `CHG-001`. **Every one of those sessions passed its
scope check when it ran.**

**2. Malformed scope declarations already in the repository are invisible.**
`CHG-007` made the parser refuse them at preflight, which protects new work.
It deliberately added no repository-wide rule, because emitting one required a
prohibited path. The consequence was stated at the time and is now closed:
`SPEC-0001/TASK-012` still declares `CHG-001` — an identifier — in its allowed
scope, and `SPEC-0001/TASK-009` still declares `tools/sdd/tests/**`, a glob
that `CL-002` forbids. Neither appears in `validate --all`.

**3. No task can record the evidence of its own execution within scope.**
`allowedPaths` is derived solely from a task's declared implementation scope.
Nothing in `docs/sdd/MACHINE_CONTRACT.md` or
`docs/sdd/AGENT_SESSION_STANDARD.md` distinguishes *files the task changes* from
*evidence the task's execution necessarily produces*.

The control plane already violates this itself: `create-session` writes a session record into the specification directory, which almost no
task declares. It is not checked, so it has never been noticed.
`ASES-0008` hit the same wall visibly and its deviation was recorded rather
than hidden.

### What changes

| Task | Defect | Adds |
|---|---|---|
| `TASK-019` | 1 | Final-state evidence captured at session close; historical sessions evaluated against their own recorded end state. Rule `SDD-V063` |
| `TASK-020` | 2 | Repository-wide scope-declaration validation over every task in every specification. Rule `SDD-V064` |
| `TASK-021` | 3 | An enumerated meta-artefact allowance in the machine contract |

### The line drawn in TASK-021

The allowance covers artefacts that **record what happened**. It does not cover
artefacts that **state what should happen**.

| Allowed regardless of task scope | Never |
|---|---|
| `execution/ASES-*.json`, `VER-*.json`, `REV-*.json` | `spec.md` |
| `traceability.md` | `plan.md` |
| `change-record.md` | `clarifications.md` |
| | `test-plan.md`, `sdd.json`, `convergence.md` |

`test-plan.md` is deliberately excluded even though `ASES-0008` needed it: a
test plan states what *should* be verified, which is specification authoring,
not execution evidence. **`ASES-0008`'s deviation therefore remains a real
deviation after this change**, which is the correct outcome — the model is
fixed going forward and history is not retro-fitted to comply.

`sdd.json` is excluded because it carries approvals. `convergence.md` is
excluded because it carries a verdict.

### What does not change

No rule is weakened and no severity lowered. Active-session scope enforcement
is untouched: `TASK-019` changes only how a **terminal** session is evaluated.
No historical task record is rewritten to satisfy the new validation;
`TASK-020` detects and reports, and the records it flags are dispositioned
separately.

### Amendments during execution

Two, both recorded before the work they authorise.

**`TASK-020` required tests corrected.** It first declared `UT-046` to
`UT-049`, identifiers that already belong to `TASK-018`. `ASES-0010` was
`BLOCKED` on discovering it and the declaration was corrected to `UT-068` to
`UT-071`. Nothing enforces that a test identifier is claimed by only one task;
`SDD-V054` checks existence, not ownership. Recorded as a new unknown.

**`TASK-020` allowed scope extended** to `tools/sdd/tests/fixtures/valid/`.
Three valid fixtures declare prose scopes, which `SDD-V064` correctly flags,
and a canonical valid fixture must validate with zero findings by design. The
fixtures are synthetic test data rather than historical records, so correcting
them is not a rewrite of history. `ASES-0011` stopped at the boundary and the
scope was amended before any fixture was touched.

### Traceability

`SPEC-0003/CONV-009` → `CHG-008` → `TASK-019` → `SDD-V063`
`SPEC-0003/CONV-008` residual → `CHG-008` → `TASK-020` → `SDD-V064`
`SPEC-0003/CONV-010` → `CHG-008` → `TASK-021` → machine contract
