# SPEC-0007 — ASTRA / Claude controlled engineering orchestration

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0007` |
| Status | `DRAFT` |
| Risk | `R4` |
| Owner | Solution Architect |
| Created | 2026-09-14 |
| Last updated | 2026-09-14 |
| Supersedes | none |
| Superseded by | none |

## Problem

The existing SDD CLI checks governance records but does not provide the requested task/worktree/prompt/result/evidence/retry operating loop. Chat history cannot reliably carry that loop between ASTRA and Claude Opus.

## Goal

A local, controlled, auditable engineering workflow using persistent artifacts, independent evidence and explicit human gates. This is a proposed specification, not an implemented control or an approval.

## Background and context

The user requested the 42-section ASTRA framework on 2026-09-14. `SPEC-0002` explicitly excludes an orchestrator; its approval does not authorize this new scope. Existing SDD preflight, sessions, scope checking and review records remain authoritative. This change is R4 because it adds permission controls, AI prompts, redaction and audit logging, as classified in `docs/RISK_CLASSIFICATION.md`.

## Scope

Phase 1 filesystem orchestration, the three JSON contracts, configuration, task isolation, manual Claude handoff, independent evidence, reviews, retry, recovery, documentation and validation. After validation only: evidence-based Sales/HRMS discovery, backlog and estimates, selection of one small pilot, and its prompt. Preserve all existing application behavior.

## Out of scope

Application backlog implementation; automatic Claude SDK execution; automatic merge; production or staging host access; deployment; infrastructure changes; database migrations; changing existing SDD approval rules; replacing existing verification/session schemas.

## Actors

ASTRA plans and reviews; Claude Opus implements and reports READY_FOR_REVIEW; an independent tester collects evidence; named human roles approve at the existing SDD gates. ASTRA cannot independently review code it implemented itself. A human launches Phase 1 Claude.

## User stories

As an operator, I can resume an interrupted task from disk. As a reviewer, I can distinguish implementation claims from independently executed evidence. As a human approver, I retain acceptance and release authority.

## Functional requirements

All FR requirements add orchestration behavior; they preserve the application and existing SDD contracts.

- `FR-001` — The orchestrator must reject invalid task/result/review JSON before any associated transition. Contracts must include every field requested in user sections 4–6, closed enums, identifiers, positive attempts, typed collections and timestamps. Tasks additionally bind to an existing specification, SDD task, execution session, base commit and required verification IDs.
- `FR-002` — MASTER_BACKLOG must be the authoritative task-state store, with the eight requested states, dependencies, priorities, attempts and computed counts. PROJECT_STATE must expose active task, attempt, phase, base commit, module/security/QA/deployment status, latest successful verification, blocks and readiness without independently overriding the backlog.
- `FR-003` — Prepare must require successful existing SDD preflight and an authorized task, then create an isolated worktree on agent/<TASK-ID> from the recorded commit. Branch collisions and unexpected dirt must block rather than overwrite. Main must not be checked out, reset, merged or pushed by the workflow.
- `FR-004` — The adapter must generate deterministic prompts with all sections requested in section 11, save them, provide a verified manual Claude launch workflow and validate a returned file bound to the task/attempt. It must not call an API or require an API key. A future adapter may share this file contract without implementing SDK execution now.
- `FR-005` — Independent collection must capture status, base-to-current committed/staged/unstaged diff, stat, changed files including untracked additions and deletions, commit list, command metadata and sanitized logs. Evidence must bind to task, attempt, base, observed tree digest, trusted configuration digest and collector actor. Review must reject stale, altered or incomplete evidence.
- `FR-006` — The runner must capture argv, cwd, start/end time, exit code, timeout, stdout/stderr and classification for each approved check. Classification is PASS, FAIL, NOT_EXECUTED, NOT_CONFIGURED or NOT_APPLICABLE. Missing configuration must never become a pass.
- `FR-007` — Review must record Claude-claim, code, scope, acceptance, security, regression, tests, build and runtime assessments. Acceptance uses PASS/FAIL/UNVERIFIED/NOT_APPLICABLE with evidence references and applicability reasons. Only an independent review with all required criteria and checks passed, no scope breach, no blocking unresolved item and fresh evidence may yield VERIFIED_COMPLETE. FAILED_REVIEW, BLOCKED and REQUIRES_MANUAL_VERIFICATION are the other decisions. Human SDD acceptance remains a separate unsatisfied gate until recorded by a human.
- `FR-008` — Failed review must retain task ID and immutable attempt history. Retry increments once, generates the specified corrective prompt with expected/actual/evidence/root cause/correction/preserve/retest fields, and uses attempt 2 for targeted correction and attempt 3 for reassessment. Failure of attempt 3 blocks further automatic retry pending restructure/block/escalation.
- `FR-009` — CLI must support status, discover, next, prepare, review, retry, backlog and evidence, plus practical dry-run reporting with no writes, subprocess verification, branch changes or task transitions. Recovery must report interrupted task, worktree, last evidence and recommended action without relaunching Claude.
- `FR-010` — Only after framework validation, discovery must map the requested application areas, cite observed evidence, build a real backlog, identify estimate uncertainty, and select one small real pilot. No fabricated gaps or application implementation may occur during framework construction.
- `FR-011` — Both READMEs must document the complete requested workflow, directory/state lifecycle, launch, stop, recovery, review, retry, evidence, approvals, troubleshooting and exact supported commands. The delivery report must address all 17 requested report sections, with the pilot prompt withheld until validation.

## Non-functional requirements

- `NFR-001` — State transitions must be single-writer, atomic and recoverable after interruption; competing writers must fail safely. Tests must cover Windows and Linux, including spaces and line endings. Filesystem/JSON/Git are preferred over a service or database.

## Security requirements

- `SEC-001` — Only trusted controller configuration may select commands; task/result/repository prose cannot add executable commands. No unrestricted shell execution. Changed package scripts, hooks, Git helpers and environment must not silently gain trust. Unsafe or unavailable isolation blocks execution.
- `SEC-002` — Claude must not write authoritative controller state or evidence. Paths must reject traversal, unsafe IDs, symlink/junction escape and protected control paths. Worktrees alone must never be described as a sandbox. Same-user tampering is a disclosed limitation unless an external execution boundary enforces separation.
- `SEC-003` — Evidence must exclude environment/credential files and redact supported secret formats before any persistence or console output. Unknown or unsafe content must be withheld and review marked insufficient rather than raw content persisted. Production secrets must never be read for redaction. Synthetic canaries prove tested coverage, not universal redaction.
- `SEC-004` — Production actions, protected merges, destructive operations and approval creation must have no executable Phase 1 path. Preparation must enforce existing risk-specific SDD gates. AI review must not discharge human acceptance. Claude results cannot directly set authoritative completion.
- `SEC-005` — Generated instructions must designate repository content as untrusted data that cannot override system/human instructions, security policy, approval requirements or task scope. Only explicitly trusted controller configuration supplies policy; worktree copies do not.

## Data and privacy requirements

- `DATA-001` — Store local task/result/review/evidence records without customer data or credentials. Keep all attempts and audit history; no automatic retention deletion or external upload. New project readiness starts UNKNOWN with a NOT_READY release posture, without claiming the existing production application is nonfunctional.

## Observability requirements

- `OBS-001` — Each significant event must record timestamp, task, attempt, event, old/new status, actor and result without secrets. Incomplete operations must be visible on restart, not silently retried.

## Failure behaviour

Fail closed on malformed input, missing approvals, stale evidence, unsafe paths, conflicting state, unavailable safe execution, command failure, timeout or missing required checks. Preserve prior evidence and worktrees. Do not infer success from Claude prose or a zero exit code when semantic acceptance remains unreviewed.

## Edge cases

Committed plus uncommitted changes; untracked nested directories; renamed/deleted/binary files; changed tree after collection; duplicate review; two prepare/retry processes; crash between state files; branch collision; detached HEAD; malicious IDs; Windows junctions; result for a previous attempt; fake reviewer actor; encoded secrets; dependency scripts with side effects.

## Acceptance criteria

- `AC-001` — Invalid JSON is rejected; valid READY becomes RUNNING only after preflight; prompt and base commit exist. Covers `FR-001`, `FR-003`, `FR-004`.
- `AC-002` — A disposable repository proves changed-file discovery, complete diff, approved command execution, exit code and preserved sanitized logs. Covers `FR-005`, `FR-006`.
- `AC-003` — Validated result and independent review demonstrate failed correction, incremented attempt and verified backlog update; missing/stale evidence cannot pass. Covers `FR-002`, `FR-007`, `FR-008`.
- `AC-004` — Crash injection and concurrent writers preserve authoritative state and produce recovery advice; dry-run changes nothing. Covers `FR-009`, `NFR-001`, `OBS-001`.
- `AC-005` — Security tests prove scope/control-file rejection, command trust, tested redaction, protected branch preservation, production denial and inability of AI claims to satisfy human gates. Covers `SEC-001`, `SEC-002`, `SEC-003`, `SEC-004`, `SEC-005`, `DATA-001`.
- `AC-006` — READMEs and the 17-part report accurately document implemented controls and limitations; post-validation discovery cites evidence and selects a small pilot without executing application changes. Covers `FR-010`, `FR-011`.

## Dependencies

Existing Node SDD CLI and Git; local Python for the new controller. No application dependency changes. JSON-schema library selection requires dependency due diligence before implementation, not a handwritten partial validator presented as full JSON Schema.

## Assumptions

Controlled/manual mode only. No live Claude execution has been demonstrated. No safe sandbox is presumed to exist. Human approval must resolve CL-001 before material implementation.

## Open questions

`CL-001` in clarifications.md: the enforceable execution boundary for Claude and changed test/build code. Draft planning below is conditional on that decision.

## Risks

Same-user controller tampering; local tests reaching real services; secret leakage in diff/output; approval spoofing; stale evidence; conflating engineering verification with acceptance. These are addressed in the threat model but are not validated controls. Existing SPEC-0002 approvals are not transferred. Existing unrelated dirty files must be preserved.

## Rollback and reversibility expectations

Stop controller and Claude; preserve worktrees/evidence; disable the new local CLI. Revert only this change after human review. No database, deployed environment or application rollback is needed. Rehearse interruption/restore using disposable fixtures; the R4 staging rollback evidence requirement remains an explicit later gate, not silently waived.

## Implementation constraints

No changes to apps/, infrastructure, workflows, deployed configuration or existing approvals. No automated merge or production path. User-requested directory layout is planned; reuse existing SDD CLI through its public command boundary.

## Evidence and existing-system references

- OBSERVED: HEAD a04c7e3762f0e8e959aa31294ae4139907c7066e; working tree contains pre-existing application and documentation changes.
- VERIFIED: tools/sdd/cli.mjs exposes preflight, create-session, scope-check, verify-session and review-check; tools/sdd/lib/agent.mjs implements their controls.
- DOCUMENTED: SPEC-0002/spec.md excludes an orchestrator and its sdd.json has approvals confined to its own scope.
- VERIFIED: apps/web/package.json contains lint, typecheck, test, build, verify, format:check, test:e2e, test:tenant, test:permission, check:rls, check:raw-sql and check:drift. Root package.json does not exist. Their existence is not execution approval or evidence of success.
- OBSERVED: node tools/sdd/cli.mjs validate --all exited 0, PASS, zero errors, seven warnings on 2026-09-14 before this draft.
- UNKNOWN: local isolation capability, Claude installation/authentication, runtime checks, application readiness and remaining work estimates. No secrets or live services inspected.

## Revision history

2026-09-14: ASTRA prepared draft specification and conditional design from the user's request. No implementation or approval.

## Approval

All gates unresolved. Requires Product Owner and Solution Architect specification approval, Solution Architect architecture and implementation-readiness approval, and Application Security review under the R4 matrix. No approval record has been written. This draft is not READY_FOR_APPROVAL until CL-001 is resolved.
