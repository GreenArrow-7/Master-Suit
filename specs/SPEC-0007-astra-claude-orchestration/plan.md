# SPEC-0007 — Conditional technical plan

Risk R4. Prepared 2026-09-14. Not approved; CL-001 remains open.

## Architecture and existing patterns

### AD-001

Reuse the public Node SDD CLI for preflight/session/scope/verification/review checks (FR-003, SEC-004). Do not duplicate its approval logic or modify its rules. The Python controller adds only workflow coordination; SPEC-0002 deliberately omitted that behavior.

### AD-002

Use the user-requested .astra/ and agent-orchestrator/ at repository root (FR-001 through FR-011). No equivalent orchestrator was found by filename discovery. Keep controller authority outside Claude's writable checkout as decided by CL-001. Pin trusted configuration and source digests at task creation; never load policy or executable commands from the implementation worktree.

### AD-003

One exclusive operation lock and atomic replacement of MASTER_BACKLOG.json form the state boundary (FR-002, FR-008, FR-009, NFR-001, OBS-001). Treat PROJECT_STATE and task-directory placement as derived views, carrying a generation number. Persist an operation intent before Git side effects and reconcile it on restart. Never claim multiple file renames are one atomic transaction. Preserve immutable attempts and idempotent review IDs. Reject a second writer; report stale lock recovery without deleting it automatically.

### AD-004

JSON-encoded YAML 1.2 config avoids a YAML parser dependency (SEC-001). Use a maintained full JSON Schema validator after licence/security/version review; requirements.txt records it. Do not write a general schema engine. Only approved fixed argv arrays execute, shell disabled, controlled cwd/environment, timeout and bounded output. Command trust includes transitive repository code, resolved executable, Git hooks/helpers and no automatic installation. CL-001 decides the execution boundary.

### AD-005

Bind immutable evidence to the current content digest including untracked files and to trusted command definitions (FR-005 through FR-007, SEC-002, SEC-003). Collect diffs without external diff/textconv, sanitize before writing, and withhold sensitive/binary/unsafe output. Require explicit review evidence per criterion; never automate semantic code approval from green commands. No automatic merge. Manual Claude adapter exports prompt and imports result only (FR-004, SEC-004, SEC-005).

## Proposed files and components

- .astra/README.md; config/astra.yaml, claude.yaml, verification.yaml, permissions.yaml, project.yaml.
- .astra/state/PROJECT_STATE.json, MASTER_BACKLOG.json, architecture.md, decisions.md.
- .astra/tasks/ready/, running/, review/, completed/, blocked/; reviews/, evidence/, logs/.
- .astra/schemas/task.schema.json, result.schema.json, review.schema.json.
- agent-orchestrator/README.md, orchestrator.py, state_manager.py, task_manager.py, claude_adapter.py, git_manager.py, evidence_collector.py, test_runner.py, policy_engine.py, review_manager.py, config_loader.py, requirements.txt, tests/.
- This specification's execution and verification records; no existing SDD code changes planned.

## Verification command discovery

Root: node tools/sdd/cli.mjs validate --all. Existing SDD test files are under tools/sdd/tests/ and must be enumerated before execution.

From apps/web: npm run lint, npm run typecheck, npm run build, npm test, npm run verify, npm run format:check, npm run test:tenant, npm run test:permission, npm run test:e2e, npm run check:rls, npm run check:raw-sql, npm run check:drift exist. These are candidates, not yet approved execution configuration. Inspect script bodies, hooks, environment loading and network/database access before approval. Runtime start/health/stop, safe install and separate integration profile remain UNCONFIGURED pending local environment verification. Do not guess that npm run verify is safe just because the script exists.

## Data, API, application and deployment impact

Local control records only. No Prisma changes, API changes, frontend/backend business logic, auth/session/tenant-control changes, queues or external integration. No deployed environment variables, worker restart, production operations or workflow changes. No application dependency changes. Claude remains human-launched; no automatic SDK/network integration.

## Error, concurrency and security behavior

Fail closed; leave recoverable intent and immutable prior evidence. Report timeouts, truncated/withheld logs, unavailable dependencies and actor limitations. Reject wrong-attempt results, stale review, scope escape, branch collision and mismatched state generation. See threat-model.md for adversarial cases and the unapproved isolation decision.

## Tests and rollback

Use Python unittest and disposable local Git repositories, synthetic secrets only. Run Windows and Linux; explicitly report unavailable platforms. Preserve existing SDD regression suites. Stop local controller, preserve audit/evidence/worktrees and revert only orchestrator files; no automatic deletion or application rollback. Crash/recovery rehearsal is required. R4 staging rollback validation remains unperformed and requires an authorized environment/owner.

## Delivery sequence

Resolve CL-001; obtain recorded R4 gates; pass preflight; implement TASK-001 through TASK-004 in order with tests and separate review; validate framework; only then perform TASK-005 discovery and pilot prompt. No application task execution. Provide the user's 17-part report with actual outcomes and remaining uncertainty.
