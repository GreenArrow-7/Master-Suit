# SPEC-0001 — Threat model

| Field | Value |
|---|---|
| Specification | `SPEC-0001` |
| Risk | `R3` |
| Author | Solution Architect |
| Security reviewer | Application Security |
| Date | 2026-09-07 |

Produced voluntarily. `docs/sdd/RISK_TO_PROCESS_MATRIX.md` requires a threat
model at R3 only when the change is security-sensitive; this one parses
attacker-controlled pull-request content and is intended to run in CI, so it
is treated as security-sensitive.

## Scope of this analysis

The validator process, its input handling, and its output. Excluded: the
application, which the validator never touches, and CI platform security,
which is out of scope while CI integration is deferred (`CL-005`).

## Assets in scope

The developer or CI machine running the validator, the repository contents it
can read, and CI log output.

## Trust boundaries crossed

One new boundary: repository artefact content, which any pull-request author
can control, becomes input to a program that runs on a maintainer's machine
and, later, in CI.

## Threats

### TH-001
**Asset:** Files outside the specs root.
**Trust boundary:** Artefact content → filesystem.
**Threat actor:** A pull-request author.
**Threat:** Path traversal. A manifest artefact path of `../../../.env` or an
absolute path causes the validator to read a file it should not.
**Attack path:** Craft a manifest whose artefact value escapes the directory;
the validator resolves and reads it; content or its existence leaks into
findings.
**Preconditions:** Ability to add a specification directory.
**Impact:** Information disclosure, potentially of a secret.
**Existing controls:** None before this work.
**Required controls:** `CTRL-001`
**Verification:** `ST-001`
**Residual risk:** Low. Reads are confined and output carries paths, not
content.
**Status:** `MITIGATED`

### TH-002
**Asset:** The machine running the validator.
**Threat:** Code execution through artefact content, if the validator ever
evaluated, imported or shelled out to a value read from a file.
**Attack path:** A manifest field or artefact line containing executable
content reaching `eval`, `new Function`, dynamic `import()`, or a shell
command built by interpolation.
**Impact:** Arbitrary code execution on a developer or CI machine.
**Existing controls:** None before this work.
**Required controls:** `CTRL-002`
**Verification:** `ST-002`
**Residual risk:** Low. The design has no execution path for artefact values.
**Status:** `MITIGATED`

### TH-003
**Asset:** Validator availability.
**Threat:** Denial of service through catastrophic regular-expression
backtracking or an enormous artefact file.
**Attack path:** A crafted line that makes a nested-quantifier pattern take
exponential time, or a multi-hundred-megabyte Markdown file.
**Impact:** CI job hangs; local runs become unusable.
**Existing controls:** None before this work.
**Required controls:** `CTRL-003`
**Verification:** `ST-003`
**Residual risk:** Low to medium. Bounded patterns remove the exponential
case; a very large file still costs linear time, which is acceptable and is
measured in the performance check.
**Status:** `MITIGATED`

### TH-004
**Asset:** Secrets accidentally committed into an SDD artefact.
**Threat:** The validator amplifies a leak by copying artefact content into
CI logs, which are more widely readable than the file.
**Impact:** Secret disclosure to a wider audience.
**Existing controls:** The repository's own scanning discipline, which has
gaps (SEC-OBS-006).
**Required controls:** `CTRL-004`
**Verification:** `ST-004`
**Residual risk:** Low.
**Status:** `MITIGATED`

### TH-005
**Asset:** The integrity of the approval model.
**Threat:** An AI agent, or anyone, records an approval that satisfies a
human-required gate without a human having decided anything.
**Attack path:** Write an approval object into `sdd.json` and let the
validator confirm compliance.
**Impact:** The central control of the SDD system is defeated by editing a
file.
**Existing controls:** B1 prose forbidding it, unenforced.
**Required controls:** `CTRL-005`
**Verification:** `ST-005`, `ST-006`
**Residual risk:** **Medium, and irreducible by this tool.** The validator can
prove a structured record exists with `actorType: "human"`. It cannot prove a
human made it. Anyone who can commit can write that record. Real assurance
comes from code review, branch protection and commit authorship, none of
which the validator provides. This limitation is stated in
`docs/sdd/ENFORCEMENT_STANDARD.md` rather than implied away.
**Status:** `ACCEPTED_RISK`

### TH-006
**Asset:** Trust in the validator's verdict.
**Threat:** Symbolic-link following causes the validator to traverse outside
the repository or into a loop.
**Impact:** Wrong results, or a hang.
**Required controls:** `CTRL-001`
**Verification:** `ST-001`
**Residual risk:** Low.
**Status:** `MITIGATED`

## Controls

### CTRL-001
**Control:** Every artefact path is resolved against the specification
directory and rejected unless the resolved path remains inside it. Directory
walking does not follow symbolic links.
**Threats addressed:** `TH-001`, `TH-006`
**Requirements supported:** `SEC-002`, `DATA-002`
**Implementation:** `TASK-002`
**Verification:** `ST-001`
**Owner:** Solution Architect

### CTRL-002
**Control:** No `eval`, `new Function`, dynamic `import()` of repository
content, `child_process`, or shell interpolation anywhere in the tool. Only
`JSON.parse` and string operations are applied to artefact content.
**Threats addressed:** `TH-002`
**Requirements supported:** `SEC-001`
**Implementation:** `TASK-002`
**Verification:** `ST-002`
**Owner:** Application Security

### CTRL-003
**Control:** Anchored, bounded regular expressions with no nested
quantifiers; line-oriented parsing so no pattern sees an unbounded string.
**Threats addressed:** `TH-003`
**Requirements supported:** `SEC-005`
**Implementation:** `TASK-003`
**Verification:** `ST-003`
**Owner:** Solution Architect

### CTRL-004
**Control:** Findings carry rule identifier, severity, specification,
artefact path and a fixed message. Artefact file content is never copied into
a finding.
**Threats addressed:** `TH-004`
**Requirements supported:** `SEC-003`
**Implementation:** `TASK-004`
**Verification:** `ST-004`
**Owner:** Application Security

### CTRL-005
**Control:** Human-required gates accept only `actorType: "human"`. A record
with `actorType: "ai"` produces an ERROR, and the absence of any qualifying
record produces an ERROR.
**Threats addressed:** `TH-005`
**Requirements supported:** `SEC-004`
**Implementation:** `TASK-005`
**Verification:** `ST-005`, `ST-006`
**Owner:** Application Security

## Traceability

| Threat | Control | Security requirement | Test | Status |
|---|---|---|---|---|
| `TH-001` | `CTRL-001` | `SEC-002` | `ST-001` | `MITIGATED` |
| `TH-002` | `CTRL-002` | `SEC-001` | `ST-002` | `MITIGATED` |
| `TH-003` | `CTRL-003` | `SEC-005` | `ST-003` | `MITIGATED` |
| `TH-004` | `CTRL-004` | `SEC-003` | `ST-004` | `MITIGATED` |
| `TH-005` | `CTRL-005` | `SEC-004` | `ST-005`, `ST-006` | `ACCEPTED_RISK` |
| `TH-006` | `CTRL-001` | `SEC-002` | `ST-001` | `MITIGATED` |

## Residual risk acceptance

| Risk | Accepted by (role) | Date | Condition for revisiting |
|---|---|---|---|
| `TH-005` — a structured approval record proves presence, not human agency | Application Security | 2026-09-07 | Revisit when branch protection and required reviewers are confirmed, which would supply the missing assurance. Tracked against GAP-CI-01 |
