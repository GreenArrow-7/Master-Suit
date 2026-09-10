# SPEC-0002 — Threat model

| Field | Value |
|---|---|
| Specification | `SPEC-0002` |
| Risk | `R3` |
| Author | Solution Architect |
| Security reviewer | Application Security — **gate UNRESOLVED** |
| Date | 2026-09-07 |

Produced voluntarily. At R3 a threat model is required only when the change is
security-sensitive; agent tooling parses attacker-controlled records and is
the mechanism that decides whether work is authorised, so it qualifies.

## Scope

The agent control plane: session, verification and review records, preflight,
scope checking and drift detection. Excluded: the B2 validator, covered by
`SPEC-0001`'s threat model, and the application, which agent tooling never
touches.

## Assets

The integrity of the authorisation decision itself, the developer or CI
machine, repository files outside declared scope, and concurrent uncommitted
human work in the tree.

## Threats

### TH-001
**Asset:** The authorisation decision.
**Threat actor:** An AI agent, or anyone able to write a file.
**Threat:** Scope self-expansion. An agent edits a task's declared
`allowedPaths` to include whatever it wants to change, then passes scope
checking.
**Impact:** The scope control becomes self-service and means nothing.
**Existing controls:** none before this work.
**Required controls:** `CTRL-001`
**Verification:** `ST-001`
**Residual risk:** **Medium, irreducible by this tool.** Scope lives in
`tasks.md`, which an agent can edit. The tool compares the diff to the
declaration; it cannot tell whether the declaration was widened for this
change. A human reading the diff sees the widening, because the task file is
in it. Detection is by review, not by tooling.
**Status:** `ACCEPTED_RISK`

### TH-002
**Asset:** Files outside the repository.
**Threat:** Path traversal or symlink escape through a declared path such as
`../../` or a symbolic link inside an allowed directory.
**Impact:** Reads or scope authorisation outside the repository.
**Required controls:** `CTRL-002`
**Verification:** `ST-002`, `ST-003`
**Residual risk:** Low.
**Status:** `MITIGATED`

### TH-003
**Asset:** The human approval model.
**Threat:** Forged actor type. A record claims `actorType: "human"` when an
AI wrote it, or an AI review is offered as satisfying a human gate.
**Impact:** The central control of the whole system is defeated by editing a
field.
**Required controls:** `CTRL-003`
**Verification:** `ST-004`, `ST-005`
**Residual risk:** **Medium, irreducible.** The tool can reject
`actorType: "ai"` and can require the reviewing actor to differ from the
executing actor. It cannot verify that a record marked `human` was written by
one. Same limitation as `SPEC-0001/TH-005`, and it needs commit authorship and
branch protection, not tooling.
**Status:** `ACCEPTED_RISK`

### TH-004
**Asset:** Concurrent uncommitted human work.
**Threat:** An agent resolves repository drift by overwriting or reverting
changes it did not make.
**Impact:** Silent destruction of a colleague's work. This repository has 36
uncommitted application files right now.
**Required controls:** `CTRL-004`
**Verification:** `ST-006`
**Residual risk:** Low. The tooling has no write path to those files.
**Status:** `MITIGATED`

### TH-005
**Asset:** The machine running the tooling.
**Threat:** Command injection through a git reference, or shell execution of
a record value.
**Required controls:** `CTRL-005`
**Verification:** `ST-007`
**Residual risk:** Low.
**Status:** `MITIGATED`

### TH-006
**Asset:** Trust in review evidence.
**Threat:** A review record cites an execution session or a test that does not
exist, so verification looks complete when nothing was verified.
**Required controls:** `CTRL-006`
**Verification:** `ST-008`
**Residual risk:** Low for existence; the tool cannot judge whether a real
test actually exercised the requirement.
**Status:** `MITIGATED`

### TH-007
**Asset:** Independence of review.
**Threat:** Correlated blind spots. The same model reviews its own work in a
new session and misses what it missed the first time.
**Impact:** Review that looks independent and is not.
**Existing controls:** distinct-actor enforcement.
**Required controls:** `CTRL-007`
**Verification:** none possible.
**Residual risk:** **Medium, irreducible and important.** A separate session
removes memory, not priors. This is documented in every place the model is
described rather than mitigated, because no control here can fix it.
**Status:** `ACCEPTED_RISK`

## Controls

### CTRL-001
**Control:** Scope is declared in the task, checked against the actual diff,
and any file outside it is a finding. The task file itself appears in the diff
when scope is widened.
**Threats:** `TH-001` · **Requirements:** `FR-004` · **Task:** `TASK-004`
**Verification:** `ST-001` · **Owner:** Solution Architect

### CTRL-002
**Control:** Declared paths are rejected when absolute, containing a traversal
segment, or resolving outside the repository. Symbolic links are not followed
when resolving scope.
**Threats:** `TH-002` · **Requirements:** `SEC-002`, `FR-005` · **Task:** `TASK-004`
**Verification:** `ST-002`, `ST-003` · **Owner:** Application Security

### CTRL-003
**Control:** `actorType: "ai"` cannot satisfy a human-required gate, and a
review record is rejected when its actor equals the executing session's actor
where separation applies.
**Threats:** `TH-003` · **Requirements:** `SEC-004`, `SEC-005` · **Task:** `TASK-005`
**Verification:** `ST-004`, `ST-005` · **Owner:** Application Security

### CTRL-004
**Control:** Drift is detected against the recorded starting commit and
reported as requiring review. The tooling has no command that reverts or
overwrites a working-tree file.
**Threats:** `TH-004` · **Requirements:** `FR-006` · **Task:** `TASK-006`
**Verification:** `ST-006` · **Owner:** Solution Architect

### CTRL-005
**Control:** git is invoked with a fixed argument array through
`execFileSync`, never a shell; references are validated and may not begin with
a hyphen.
**Threats:** `TH-005` · **Requirements:** `SEC-001`, `SEC-003` · **Task:** `TASK-006`
**Verification:** `ST-007` · **Owner:** Application Security

### CTRL-006
**Control:** Verification and review records are checked for references that
resolve: the session must exist, cited tests must appear in the test plan.
**Threats:** `TH-006` · **Requirements:** `FR-007`, `FR-008` · **Task:** `TASK-005`
**Verification:** `ST-008` · **Owner:** QA / Release Engineering

### CTRL-007
**Control:** None technical. The limitation is stated in
`docs/sdd/AGENT_ROLE_MODEL.md`, `docs/sdd/AGENT_SESSION_STANDARD.md`, the
role and gate matrix, `AGENTS.md` and the evidence package.
**Threats:** `TH-007` · **Requirements:** `SEC-005`
**Verification:** documentation review · **Owner:** Application Security

## Traceability

| Threat | Control | Security requirement | Test | Status |
|---|---|---|---|---|
| `TH-001` | `CTRL-001` | `SEC-005` | `ST-001` | `ACCEPTED_RISK` |
| `TH-002` | `CTRL-002` | `SEC-002` | `ST-002`, `ST-003` | `MITIGATED` |
| `TH-003` | `CTRL-003` | `SEC-004` | `ST-004`, `ST-005` | `ACCEPTED_RISK` |
| `TH-004` | `CTRL-004` | `SEC-006` | `ST-006` | `MITIGATED` |
| `TH-005` | `CTRL-005` | `SEC-001`, `SEC-003` | `ST-007` | `MITIGATED` |
| `TH-006` | `CTRL-006` | `SEC-006` | `ST-008` | `MITIGATED` |
| `TH-007` | `CTRL-007` | `SEC-005` | none possible | `ACCEPTED_RISK` |

## Residual risk acceptance

| Risk | Accepted by (role) | Date | Condition for revisiting |
|---|---|---|---|
| `TH-001` scope self-expansion | **UNRESOLVED** — Application Security approval not granted | — | Revisit when branch protection and human diff review are confirmed |
| `TH-003` forged actor type | **UNRESOLVED** — same limitation as `SPEC-0001/TH-005` | — | Revisit when commit authorship and branch protection are confirmed (GAP-CI-01) |
| `TH-007` correlated blind spots | **UNRESOLVED** | — | Revisit when a second reviewer, human or a different model, is available |

Three residual risks are recorded and **none is accepted**, because the
Application Security gate is unresolved for this phase. They are carried
forward as open, not signed off.
