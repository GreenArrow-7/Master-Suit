# SPEC-0007 — Tasks

Risk R4. All implementation tasks blocked pending CL-001 and recorded human gates. No scope is authorized by this draft.

## TASK-001

**Purpose:** Implement contracts, configuration and recoverable state.

**Requirements:** FR-001, FR-002, NFR-001, DATA-001, OBS-001.

**Dependencies:** Approved specification and implementation readiness.

**Allowed scope:** `.astra/`, `agent-orchestrator/`

**Prohibited paths:** `apps/`, `.github/`, `tools/sdd/`

**Required tests:** UT-001, IT-004, ST-003.

**Status:** BLOCKED

## TASK-002

**Purpose:** Implement policy, SDD binding, isolated Git preparation and manual prompt/result adapter.

**Requirements:** FR-003, FR-004, SEC-001, SEC-002, SEC-004, SEC-005.

**Dependencies:** TASK-001 and selected execution boundary.

**Allowed scope:** `.astra/`, `agent-orchestrator/`

**Prohibited paths:** `apps/`, `.github/`, `tools/sdd/`

**Required tests:** IT-001, ST-001, ST-002, ST-004, ST-005, REG-001.

**Status:** BLOCKED

## TASK-003

**Purpose:** Implement independent evidence, verification runner and review/correction lifecycle.

**Requirements:** FR-005, FR-006, FR-007, FR-008, SEC-003.

**Dependencies:** TASK-002.

**Allowed scope:** `.astra/`, `agent-orchestrator/`

**Prohibited paths:** `apps/`, `.github/`, `tools/sdd/`

**Required tests:** IT-002, IT-003, ST-003, ST-004.

**Status:** BLOCKED

## TASK-004

**Purpose:** Finish CLI, recovery, documentation and framework validation.

**Requirements:** FR-009, FR-011, NFR-001, OBS-001.

**Dependencies:** TASK-003.

**Allowed scope:** `.astra/`, `agent-orchestrator/`

**Prohibited paths:** `apps/`, `.github/`, `tools/sdd/`

**Required tests:** IT-004, IT-005, REG-001.

**Status:** BLOCKED

## TASK-005

**Purpose:** Evidence-based application discovery, backlog/estimate and one small pilot prompt; no application implementation.

**Requirements:** FR-010, FR-011.

**Dependencies:** TASK-004 validated, independent review and applicable human acceptance.

**Allowed scope:** `.astra/`

**Prohibited paths:** `apps/`, `.github/`, `tools/sdd/`, `agent-orchestrator/`

**Required tests:** IT-005.

**Status:** BLOCKED

## Shared completion conditions

Each task must satisfy its requirements, pass its designed checks, update real traceability and session records, document deviations and preserve unrelated work. Security implications are in the threat model. No task changes application data, migrations or deployment. Full applicable AGENTS.md definition of done and human gates remain required. Expected components are enumerated in plan.md; narrowing per-task paths before approval is permitted, widening after approval requires change control.
