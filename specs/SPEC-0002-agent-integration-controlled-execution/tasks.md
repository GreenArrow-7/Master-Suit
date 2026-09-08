# SPEC-0002 — Tasks

| Field | Value |
|---|---|
| Specification | `SPEC-0002` |
| Risk | `R3` |
| Date | 2026-09-07 |

Each task declares an allowed scope. From `TASK-007` onward the scope is
enforced by the tooling the earlier tasks build, which is the bootstrap
boundary recorded in `convergence.md`.

## Task list

| ID | Purpose | Requirements | Status |
|---|---|---|---|
| `TASK-001` | Agent role model, gate matrix, handoff, context and stop standards | `FR-001`, `SEC-005`, `AD-005` | `DONE` |
| `TASK-002` | Session, verification and review record contracts, schemas and templates | `FR-002`, `FR-007`, `FR-008`, `AD-002` | `DONE` |
| `TASK-003` | Agent rule identifiers appended after `SDD-V041` | `FR-009`, `AD-006` | `DONE` |
| `TASK-004` | Preflight and task-scope enforcement | `FR-001`, `FR-003`, `FR-004`, `FR-005`, `SEC-002` | `DONE` |
| `TASK-005` | Verification and review record validation, separation of duty | `FR-007`, `FR-008`, `SEC-004`, `SEC-005` | `DONE` |
| `TASK-006` | Repository drift detection and safe git invocation | `FR-006`, `SEC-003`, `AD-004` | `DONE` |
| `TASK-007` | Agent subcommands on the existing CLI | `FR-010`, `AD-001` | `DONE` |
| `TASK-008` | Synthetic agent fixtures and automated tests | `FR-001`–`FR-010`, `SEC-001`–`SEC-006` | `DONE` |
| `TASK-009` | Documentation of the new rules and minimal `AGENTS.md` / `CLAUDE.md` integration | `FR-009`, `OBS-001` | `DONE` |
| `TASK-010` | Security review and bootstrap dogfooding session | `SEC-001`–`SEC-006` | `DONE` |

---

## TASK-001

**Purpose:** Define the agent roles, the risk-to-role matrix, and the handoff,
context and stop standards.
**Requirements:** `FR-001`, `SEC-005`, decision `AD-005`.
**Dependencies:** none.
**Allowed scope:**
`docs/sdd/AGENT_ROLE_MODEL.md`,
`docs/sdd/AGENT_ROLE_GATE_MATRIX.md`,
`docs/sdd/AGENT_HANDOFF_STANDARD.md`,
`docs/sdd/AGENT_CONTEXT_STANDARD.md`,
`docs/sdd/AGENT_STOP_PROTOCOL.md`.
**Required tests:** none; documentation.
**Security implications:** states the independence limitation from `CL-001`.
**Data and migration implications:** none.
**Definition of Done:** every role has explicit may and may-not lists; the
matrix governs AI participation only and redefines no human gate.
**Status:** `DONE`

## TASK-002

**Purpose:** Define the three record types with schemas and templates.
**Requirements:** `FR-002`, `FR-007`, `FR-008`, decision `AD-002`.
**Dependencies:** `TASK-001`.
**Allowed scope:**
`docs/sdd/AGENT_SESSION_STANDARD.md`,
`docs/sdd/AGENT_EXECUTION_RECORD.md`,
`docs/sdd/schemas/agent-session.schema.json`,
`docs/sdd/schemas/verification-record.schema.json`,
`docs/sdd/schemas/review-record.schema.json`,
`specs/templates/AGENT_SESSION_TEMPLATE.json`,
`specs/templates/VERIFICATION_RECORD_TEMPLATE.json`,
`specs/templates/REVIEW_RECORD_TEMPLATE.json`.
**Required tests:** `UT-002`, `IT-006`.
**Security implications:** records carry no secrets and no command output.
**Definition of Done:** schema and implementation agree field by field.
**Status:** `DONE`

## TASK-003

**Purpose:** Allocate agent rule identifiers without disturbing B2.
**Requirements:** `FR-009`, decision `AD-006`.
**Dependencies:** `TASK-001`.
**Allowed scope:** `tools/sdd/rules/rules.mjs`.
**Required tests:** `UT-006`, `IT-008`.
**Security implications:** none; no existing severity changes.
**Definition of Done:** `SDD-V001`–`SDD-V041` byte-identical in meaning and
severity; new rules begin at `SDD-V042`.
**Status:** `DONE`

## TASK-004

**Purpose:** Preflight and task-scope enforcement.
**Requirements:** `FR-001`, `FR-003`, `FR-004`, `FR-005`, `SEC-002`.
**Dependencies:** `TASK-002`, `TASK-003`.
**Allowed scope:** `tools/sdd/lib/agent.mjs`.
**Required tests:** `UT-001`, `UT-003`, `IT-005`, `ST-001`, `ST-002`, `ST-003`.
**Security implications:** implements `CTRL-001` and `CTRL-002`; path
containment and symlink refusal.
**Definition of Done:** preflight exits non-zero on every invalid case; an
unsafe declared path is refused rather than resolved.
**Status:** `DONE`

## TASK-005

**Purpose:** Verification and review validation, including separation of duty.
**Requirements:** `FR-007`, `FR-008`, `SEC-004`, `SEC-005`.
**Dependencies:** `TASK-004`.
**Allowed scope:** `tools/sdd/lib/agent.mjs`.
**Required tests:** `ST-004`, `ST-005`, `ST-008`, `IT-003`, `IT-007`.
**Security implications:** implements `CTRL-003` and `CTRL-006`.
**Definition of Done:** an AI actor cannot satisfy a human gate; a session's
own actor cannot review its own work; dangling references are findings.
**Status:** `DONE`

## TASK-006

**Purpose:** Repository drift detection and safe git invocation.
**Requirements:** `FR-006`, `SEC-003`, decision `AD-004`.
**Dependencies:** `TASK-004`.
**Allowed scope:** `tools/sdd/lib/agent.mjs`.
**Required tests:** `ST-006`, `ST-007`.
**Security implications:** implements `CTRL-004` and `CTRL-005`; no command
reverts or overwrites a working-tree file.
**Definition of Done:** drift is reported as requiring review; a hostile git
reference is refused with exit 2.
**Status:** `DONE`

## TASK-007

**Purpose:** Expose the agent commands on the existing CLI.
**Requirements:** `FR-010`, decision `AD-001`.
**Dependencies:** `TASK-004`, `TASK-005`, `TASK-006`.
**Allowed scope:** `tools/sdd/cli.mjs`.
**Required tests:** `UT-004`, `UT-005`, `UT-007`.
**Security implications:** argument parsing rejects unknown options.
**Definition of Done:** five subcommands, text and JSON output, exit codes 0,
1 and 2.
**Status:** `DONE`

## TASK-008

**Purpose:** Synthetic fixtures and automated tests.
**Requirements:** verifies `FR-001` to `FR-010`, `SEC-001` to `SEC-006`,
`NFR-002`, `NFR-003` and `DATA-001`; covers every acceptance criterion
`AC-001` to `AC-008`.
**Dependencies:** `TASK-007`.
**Allowed scope:**
`tools/sdd/tests/agent.test.mjs`,
`tools/sdd/tests/fixtures/agent/`.
**Required tests:** none required of this task; it delivers the suite that
every other task is measured by.
**Security implications:** fixtures are synthetic; no real data, no credential.
**Definition of Done:** valid fixtures pass; every invalid fixture fails with
its expected rule.
**Status:** `DONE`

## TASK-009

**Purpose:** Document the new rules and integrate the agent flow minimally.
**Requirements:** `FR-009`, `OBS-001`.
**Dependencies:** `TASK-003`, `TASK-008`.
**Allowed scope:**
`docs/sdd/VALIDATION_RULES.md`,
`docs/sdd/IDENTIFIER_STANDARD.md`,
`docs/sdd/SDD_WORKFLOW.md`,
`AGENTS.md`,
`CLAUDE.md`.
**Required tests:** none; documentation.
**Definition of Done:** every new rule documented with severity and rationale;
no B1 or B2 rule redefined.
**Status:** `DONE`

## TASK-010

**Purpose:** Security review, and a controlled bootstrap session dogfooding the
tooling against this specification's own remaining work.
**Requirements:** `SEC-001` to `SEC-006`.
**Dependencies:** `TASK-008`.
**Allowed scope:**
`specs/SPEC-0002-agent-integration-controlled-execution/execution/`,
`docs/evidence/phase-b3-agent-integration/`.
**Required tests:** `REG-001`.
*(The full agent suite was also run — see `VER-0001`. Only the identifier
listed above is required by this task. Wording clarified under `CHG-003`; the
required set is unchanged, so the basis on which `ASES-0001` was measured is
unchanged.)*
**Security implications:** the review is the deliverable.
**Definition of Done:** each threat's control confirmed present; a real
session, verification and review record exist for the post-tooling work, and
the bootstrap boundary is stated rather than disguised.
**Status:** `DONE`

## TASK-011

**Purpose:** Review the git subprocess callers introduced by B3 against the
required safety properties, and update the security allowlist only for callers
that demonstrably hold them.
**Requirements:** `SEC-001`, `SEC-003`. Resolves `CONV-006` under `CHG-001`.
**Dependencies:** `TASK-008`.
**Allowed scope:** `tools/sdd/tests/validator.test.mjs`.
**Prohibited paths:** `tools/sdd/lib/agent.mjs`, `tools/sdd/lib/diff.mjs`.
**Required tests:** `ST-009`, `ST-002`.
*(The whole B2 suite was also run — see `VER-0002`. Only the two identifiers
listed above are required by this task.)*
**Security implications:** this task edits a security test. Allowlisting by
file name alone is forbidden; each caller must be verified to use
`execFileSync` with a fixed argument array, an explicitly disabled shell, a
fixed executable name, validated ref input, and no environment-derived command
text. The allowlist must end stricter than it began.
**Definition of Done:** every allowlisted caller verified against the property
list and the verification recorded; `ST-002` passes; the B2 suite is fully
green; no security check was removed or narrowed.
**Status:** `DONE`

## TASK-012

**Purpose:** Correct scope attribution so it evaluates the session-introduced
delta rather than every currently dirty file.
**Requirements:** `FR-004`, `FR-006`, `NFR-002`. Resolves `CONV-007` under
`CHG-001`.
**Dependencies:** `TASK-004`.
**Allowed scope:** `tools/sdd/lib/agent.mjs`, `tools/sdd/cli.mjs`,
`tools/sdd/tests/agent.test.mjs`, `docs/sdd/schemas/agent-session.schema.json`,
`docs/sdd/AGENT_SESSION_STANDARD.md`.
**Prohibited paths:** `apps/`, `tools/sdd/tests/validator.test.mjs`.
**Required tests:** `UT-008`, `UT-009`, `UT-010`, `UT-011`, `UT-012`,
`UT-013`, `UT-014`, `UT-015`, `UT-016`, `UT-017`.
**Security implications:** attribution must fail safe. A path whose origin
cannot be established deterministically is reported for review, never silently
treated as authorised.
**Definition of Done:** a pre-existing dirty file untouched by the session is
not blamed; a file the session actually changed is judged against scope
whether or not it was already dirty; unattributable paths raise a review
warning; all ten cases pass; the real `ASES-0001` scenario no longer
attributes the pre-existing interface work to the session.
**Status:** `DONE`

## TASK-013

**Purpose:** Extend the dedicated non-production SDD validation workflow so CI
runs the B2 validator suite, the B3 agent-control suite and `validate --all`.
**Requirements:** `OBS-001`, `NFR-004`. Resolves `CONV-005` under `CHG-004`,
authorised by decision `D6`.
**Dependencies:** `TASK-008`, `TASK-012`.
**Allowed scope:** `.github/workflows/sdd-validate.yml`.
**Prohibited paths:** `apps/`, `tools/sdd/`, `prisma/`.
**Required tests:** `IT-008`.
**Security implications:** this task edits CI configuration, which is R5. The
workflow must remain read-only: no deploy, no production or staging access, no
secret, no database, no migration, and `SDD-V041` stays `WARNING`.
**Definition of Done:** the workflow runs all three checks and fails on ERROR
findings; the commands it invokes are verified locally; the GitHub-hosted
result is recorded as UNKNOWN until the workflow actually runs.
**Status:** `DONE`

## TASK-014

**Purpose:** Correct the convergence verdict parser so it matches supported
verdicts exactly instead of by prefix.
**Requirements:** `FR-009`, `NFR-003`. Resolves the parser defect recorded in
`docs/evidence/phase-b3-agent-integration/known-limitations.md` item 11, under
`CHG-005`.
**Dependencies:** `TASK-008`.
**Allowed scope:** `tools/sdd/lib/traceability.mjs`, `tools/sdd/lib/validate.mjs`,
`tools/sdd/tests/validator.test.mjs`.
**Prohibited paths:** `apps/`, `specs/`, `docs/sdd/`.
**Required tests:** `UT-018`, `UT-019`, `UT-020`, `UT-021`, `UT-022`,
`UT-023`, `UT-024`, `UT-025`.
**Security implications:** the parser reads untrusted artefact text. It must
not echo content into findings, and an ambiguous or unsupported value must be
reported rather than coerced to a supported one.
**Definition of Done:** exact matching after whitespace normalisation; prefix
matching removed; ambiguous and unsupported values rejected; `SPEC-0002` is
machine-read as `PASS WITH ACCEPTED LIMITATIONS` and not as `PASS`.
**Status:** `DONE`

## TASK-015

**Purpose:** Enforce the `EVC-015` Option A policy mechanically: an R3
specification requires a human specification approval before implementation.
**Requirements:** `FR-009`, `SEC-004`. Resolves the enforcement gap recorded in
the `EVC-015` resolution and in
`docs/evidence/phase-b3-agent-integration/known-limitations.md` item 10, under
`CHG-005`.
**Dependencies:** `TASK-014`.
**Allowed scope:** `tools/sdd/rules/rules.mjs`, `tools/sdd/lib/validate.mjs`,
`tools/sdd/lib/approvals.mjs`, `tools/sdd/tests/validator.test.mjs`,
`tools/sdd/tests/fixtures/valid/`, `docs/sdd/VALIDATION_RULES.md`,
`docs/sdd/MACHINE_CONTRACT.md`, `docs/sdd/ENFORCEMENT_STANDARD.md`.
**Prohibited paths:** `apps/`, `docs/EVIDENCE_CONFLICTS.md`,
`docs/sdd/HUMAN_APPROVAL_GATES.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`.
**Required tests:** `UT-026`, `UT-027`, `UT-028`, `UT-029`, `UT-030`,
`UT-031`, `UT-032`, `UT-033`, `UT-034`, `UT-035`.
**Security implications:** the rule governs a human approval gate. An `ai`
actor must never satisfy it, a record for another gate or another
specification must never satisfy it, and an unsupported role must not pass.
The existing R4/R5 implementation-readiness gate must not be weakened.
**Definition of Done:** specification approval and implementation-readiness
approval are separately enforced; `EVC-015` is not reopened; every listed test
passes; the R4/R5 behaviour is unchanged.
**Status:** `DONE`

## TASK-016

**Purpose:** Correct a brittle regression test that pinned `SPEC-0002`'s
current verdict value instead of the parser invariant.
**Requirements:** `FR-009`, `NFR-003`. Amends `TASK-014` under `CHG-005`.
**Dependencies:** `TASK-014`.
**Allowed scope:** `tools/sdd/tests/validator.test.mjs`.
**Prohibited paths:** `tools/sdd/lib/`, `specs/`, `docs/`.
**Required tests:** `UT-025`.
**Security implications:** none. A test-only correction; the parser is a
prohibited path so this task cannot make the test pass by changing the code
under test.
**Definition of Done:** the test asserts exact round-tripping of whatever
verdict the document declares, rather than a fixed string; it would still fail
if prefix matching returned.
**Status:** `DONE`
**Previously:** `BLOCKED` by `CONV-011`. Preflight refused to authorise a
session while that error stood. Unblocked by `EXC-001` and then executed
through the normal control plane as `ASES-0007`; preflight was not bypassed.

## TASK-017

**Purpose:** Implement the generic validation-exception mechanism the register
in `docs/sdd/VALIDATION_EXCEPTIONS.md` describes but nothing enforced.
**Requirements:** `FR-009`, `SEC-004`. Raised under `CHG-006` to give effect to
the `EXC-001` decision.
**Dependencies:** `TASK-015`.
**Allowed scope:** `tools/sdd/lib/exceptions.mjs`, `tools/sdd/lib/validate.mjs`,
`tools/sdd/rules/rules.mjs`, `tools/sdd/tests/validator.test.mjs`,
`docs/sdd/validation-exceptions.json`, `docs/sdd/VALIDATION_EXCEPTIONS.md`,
`docs/sdd/VALIDATION_RULES.md`.
**Prohibited paths:** `apps/`, `specs/`.
**Required tests:** `UT-036`, `UT-037`, `UT-038`, `UT-039`, `UT-040`,
`UT-041`, `UT-042`, `UT-043`, `UT-044`, `UT-045`.
**Security implications:** the mechanism can downgrade an ERROR, so it must
fail closed. No specification-specific branch is permitted; a malformed,
unapproved, mis-scoped or wrong-role record must suppress nothing; an `ai`
actor must never approve one; and a covered finding must stay visible rather
than be deleted.
**Definition of Done:** every listed test passes; `SDD-V060` remains enforced
where no exception applies; an exception to one rule never covers another.
**Status:** `DONE`
**Execution note:** this task was carried out **outside an agent session**.
Preflight refuses to authorise any session while a blocking validation error
stands, and the blocker was the very finding this task exists to except. The
control could not authorise the work that unblocks the control. Recorded as
`CONV-014` and as a bootstrap deviation of the same class as `CONV-003`, not
disguised as a governed session.

---

## Scope discipline

`TASK-001` to `TASK-006` ran before the scope checker existed. That is the
bootstrap boundary: their scope declarations are honest statements of what was
touched, not machine-enforced. `TASK-007` onward is covered by `ASES-0001` and
was scope-checked. `convergence.md` records this rather than implying the
whole phase was governed.

`TASK-011` and `TASK-012` were added by `CHG-001` after `ASES-0001` found two
defects it was not authorised to fix. Each has its own session, `ASES-0002`
and `ASES-0003`. `TASK-010` was not reopened and `ASES-0001` was not edited:
its `PARTIAL` result and its findings are the historical record of what that
session actually produced.

Note the prohibited paths. `TASK-011` may edit the security test but not the
callers it is reviewing, so it cannot make a caller pass by changing the
caller. `TASK-012` may edit the callers but not the security test, so it
cannot make its own work pass by relaxing a security check. Neither task can
do both halves.

## Test identifiers are enumerated, never abbreviated

Every `Required tests` line lists identifiers explicitly. Ranges such as
"UT-008 to UT-017" and prose such as "the whole suite" are **not** used,
because the parser reads a range as its two endpoints and reads prose as
nothing at all. A task that appears to require ten tests while the tooling
enforces two is under-coverage that looks like coverage.

That was `CONV-008`. Corrected under `CHG-003`.

Where a task also ran tests beyond its required set, that is recorded as an
italic note naming the verification record, so the extra work is visible
without becoming a requirement the tooling silently fails to enforce.

---

## TASK-018

**Purpose:** Make the task-scope parser distinguish a structured scope
declaration from prose, so a malformed declaration is reported rather than
silently producing a wrong boundary.

**Requirements:** `FR-004`, decision `CL-002`.

**Allowed scope:** `tools/sdd/lib/agent.mjs`, `tools/sdd/rules/rules.mjs`,
`tools/sdd/tests/agent.test.mjs`, `docs/sdd/VALIDATION_RULES.md`.

**Prohibited paths:** `tools/sdd/lib/validate.mjs`, `tools/sdd/lib/diff.mjs`,
`tools/sdd/lib/approvals.mjs`, `tools/sdd/lib/exceptions.mjs`,
`tools/sdd/cli.mjs`, `specs/SPEC-0001-sdd-verification-enforcement/`,
`specs/SPEC-0003-tablesearch-accessibility/`, `apps/`.

**Required tests:** `UT-046`, `UT-047`, `UT-048`, `UT-049`, `UT-050`,
`UT-051`, `UT-052`, `UT-053`, `UT-054`, `UT-055`.

**Security implications:** strengthens `CTRL-001`. A prohibited path that
silently fails to parse under-restricts a session; this change makes that
condition visible and, at preflight, blocking. No control is weakened and no
severity is lowered.

**Definition of Done:** a scope entry is validated against the `CL-002`
grammar; non-path tokens are excluded rather than admitted; prose in a
declaration is detected; `SDD-V062` blocks preflight for the task being acted
on, consistent with `SDD-V045` and `SDD-V056`; the original
`SPEC-0003/TASK-003` case is reproduced synthetically and fails before the
fix; `SPEC-0001` and `SPEC-0002` still validate.

**Completion evidence:** ten unit tests, the B2 and B3 suites, and
`validate --all`.

**Status:** `TODO`

---

## TASK-019

**Purpose:** Capture a session's end state when it closes, and evaluate a
terminal session against that recorded state rather than the live repository,
so a historical session's result is stable.

**Requirements:** `FR-004`, `FR-006`, decision `CL-003`.

**Allowed scope:** `tools/sdd/lib/agent.mjs`, `tools/sdd/cli.mjs`,
`tools/sdd/rules/rules.mjs`, `tools/sdd/tests/agent.test.mjs`,
`docs/sdd/AGENT_SESSION_STANDARD.md`, `docs/sdd/VALIDATION_RULES.md`.

**Prohibited paths:** `tools/sdd/lib/validate.mjs`,
`tools/sdd/lib/traceability.mjs`, `tools/sdd/lib/approvals.mjs`,
`tools/sdd/lib/exceptions.mjs`, `apps/`,
`specs/SPEC-0001-sdd-verification-enforcement/`,
`specs/SPEC-0003-tablesearch-accessibility/`.

**Required tests:** `UT-056`, `UT-057`, `UT-058`, `UT-059`, `UT-060`,
`UT-061`, `UT-062`, `UT-063`.

**Security implications:** strengthens `CTRL-002`. A session that cannot be
re-validated stably lets a genuine violation hide inside re-run noise. Active
session enforcement is unchanged; nothing is made more permissive while a
session is open.

**Definition of Done:** a session records final-state evidence at close; a
terminal session with that evidence is evaluated against it; a terminal session
without it reports a documented limited state under `SDD-V063` and never
invents attribution; an in-flight session behaves exactly as before.

**Completion evidence:** eight unit tests, the B3 suite, and the re-run scope
checks for the sessions that previously produced false failures.

**Status:** `TODO`

---

## TASK-020

**Purpose:** Detect malformed scope declarations across every specification,
not only at preflight for the task being acted on.

**Requirements:** `FR-001`, `FR-004`.

**Allowed scope:** `tools/sdd/lib/validate.mjs`, `tools/sdd/rules/rules.mjs`,
`tools/sdd/tests/validator.test.mjs`, `docs/sdd/VALIDATION_RULES.md`,
`tools/sdd/tests/fixtures/valid/`,
`specs/SPEC-0002-agent-integration-controlled-execution/test-plan.md`.

**Scope amendment:** extended twice under `CHG-008` on 2026-09-08, each time
before the files were touched. `ASES-0011` stopped at the fixture boundary and
`ASES-0012` stopped before the test plan, rather than either crossing it.

**Prohibited paths:** `tools/sdd/lib/agent.mjs`, `tools/sdd/cli.mjs`,
`tools/sdd/lib/exceptions.mjs`, `apps/`, `specs/`.

**Required tests:** `UT-068`, `UT-069`, `UT-070`, `UT-071`.

**Security implications:** none directly; it makes an existing class of
governance defect visible rather than changing any control.

**Definition of Done:** every task in every specification is checked for
non-path identifiers, globs, malformed directory prefixes, prose mixed into a
declaration, absolute paths and traversal segments; findings name the
specification and task; no historical task record is rewritten by this change.

**Completion evidence:** four validator tests and `validate --all` reporting
the known historical declarations.

**Status:** `TODO`

---

## TASK-021

**Purpose:** Distinguish a task's implementation scope from the execution
evidence its own run necessarily produces, so recording that evidence is not a
scope deviation.

**Requirements:** `FR-004`, decision `CL-002`.

**Allowed scope:** `tools/sdd/lib/agent.mjs`, `tools/sdd/tests/agent.test.mjs`,
`docs/sdd/MACHINE_CONTRACT.md`, `docs/sdd/AGENT_SESSION_STANDARD.md`.

**Prohibited paths:** `tools/sdd/lib/validate.mjs`, `tools/sdd/cli.mjs`,
`tools/sdd/rules/rules.mjs`, `apps/`, `specs/`.

**Required tests:** `UT-064`, `UT-065`, `UT-066`, `UT-067`.

**Security implications:** this is a deliberate widening and is therefore
enumerated exhaustively rather than described. It must not reach `spec.md`,
`plan.md`, `clarifications.md`, `test-plan.md`, `sdd.json` or `convergence.md`,
and it must not reach another specification's directory.

**Definition of Done:** the allowance is a closed enumeration in the machine
contract; it applies only within the session's own specification; artefacts
that state intent rather than record execution are excluded and a test proves
each exclusion.

**Completion evidence:** four unit tests and the B3 suite.

**Status:** `TODO`
