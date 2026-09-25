# SPEC-0007 — Test design

All cases PLANNED, NOT_EXECUTED. These IDs identify designed cases, not existing tests. Use Python unittest with isolated temporary Git repositories and synthetic data. No application service, credential file or network required for framework tests. Repeat on Windows and Linux; do not infer Linux results from Windows.

| ID | Requirements | Setup/input and expected outcome |
|---|---|---|
| UT-001 | FR-001 | Valid contracts pass; missing/extra fields, wrong enums/types, malformed IDs, timestamps, empty required criteria, nonpositive attempt and task/result mismatch fail before writes. |
| IT-001 | FR-003, FR-004 | Disposable approved fixture prepares READY to RUNNING, records base and deterministic prompt; rejected preflight, dirty base/collision and missing session leave state unchanged. No live human approval fabricated: synthetic fixtures remain test-only. |
| IT-002 | FR-005, FR-006 | Fixture includes commit, staged/unstaged changes, untracked file, rename and deletion. Capture all; execute fixed harmless success/failure/timeout commands; check exit/timing and sanitized stdout/stderr. Missing check stays NOT_CONFIGURED. |
| IT-003 | FR-002, FR-007, FR-008 | Import result, record independent failure, create attempts 2 and 3 with prior failures and preserve/retest data; third failure blocks fourth. Supported review updates backlog; missing/altered/stale evidence, unresolved blockers and same actor cannot pass. Duplicate review/retry cannot double-increment. |
| IT-004 | FR-009, NFR-001, OBS-001 | Kill between intent/Git/state/view/audit writes; restart reports recoverable task, no execution. Two writers cannot both transition. Dry-run leaves byte-identical tree/state and no test process. |
| ST-001 | SEC-001 | Inject shell syntax and unapproved command in task/result; alter trusted config/package scripts; include hostile Git helper. Refuse execution/trust drift. Test safe boundary and minimal environment; absent isolation blocks. |
| ST-002 | SEC-002 | Traversal IDs, absolute paths, symlinks/junctions, out-of-scope file, controller-state write attempt and protected ref mutation fail or are blocked by the selected boundary; detect attempted tampering and refuse review. |
| ST-003 | SEC-003, DATA-001 | Synthetic passwords/tokens/private-key markers in stdout, stderr, diff, filenames and error paths never reach logs/console/evidence. Credential files excluded without reads. Unsafe binary/oversized output withheld, not passed. Verify all persisted outputs, not only one redactor function. |
| ST-004 | SEC-004 | Claude VERIFIED_COMPLETE result rejected; missing R4 approvals block; AI actor cannot satisfy human gate; production/merge/destructive operations have no route; protected ref stays identical. |
| ST-005 | SEC-005 | Hostile README/comments/result instructions cannot alter trusted command selection or prompt policy. Prompt labels repository data untrusted and preserves required role/scope instructions. |
| REG-001 | FR-003, SEC-004 | Existing SDD validator/agent tests pass unchanged; no writes to apps/, infrastructure or workflow paths. Record existing unrelated failures without repair. |
| IT-005 | FR-010, FR-011 | Before framework pass, discover/pilot gating blocks later stages. After framework pass, human-inspected discovery cites files for all requested areas, flags unknowns, separates estimates from evidence and generates only one small real pilot prompt. Audit both READMEs against CLI behavior and all 17 report items. |

Coverage: happy/negative/malformed and first-run paths above; concurrency and retries IT-003/IT-004; external execution failure IT-002; authorization ST-001/ST-002/ST-004; tenant isolation not applicable because no tenant data/routes are touched. Real Claude handoff requires a separately recorded human-launched pilot after framework validation. A synthetic implementer fixture is not proof that Claude ran.

Repository checks after implementation: SDD validate --all, framework unittest, existing SDD tests; full applicable build/typecheck/lint/format/security/verify gates only in the approved disposable environment, with Linux/LF formatting evidence. Runtime and staging rollback remain NOT_CONFIGURED until authorized environment setup; no skipped gate is a pass.

Execution record: baseline SDD validation on 2026-09-14 exited 0, zero errors, seven warnings. No framework tests, build, runtime or pilot ran.
