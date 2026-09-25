# SPEC-0007 — Threat model

Draft R4 security design; no residual risks accepted and no controls claimed operational.

Assets: source integrity, protected refs, local credentials, authoritative backlog, approvals and evidence. Trust boundaries: human/controller, controller/Claude worktree, subprocess/environment, imported result/review, Git helpers and persistent files. No tenant data is needed.

| Threat | Abuse case | Proposed control | Requirement | Test |
|---|---|---|---|---|
| TH-001 | Result supplies shell syntax or changed npm script steals files | CTRL-001: trusted argv/config/executables; isolated execution; no auto-install; block absent isolation | SEC-001 | ST-001 |
| TH-002 | Claude overwrites backlog or follows a junction outside scope | CTRL-002: external writable boundary, canonical path checks, protected paths and independent digest checks | SEC-002 | ST-002 |
| TH-003 | Diff/stdout contains token, password, private key or PII | CTRL-003: exclude credential files, synthetic-tested pre-persistence redaction, withhold unsupported unsafe content | SEC-003, DATA-001 | ST-003 |
| TH-004 | Fake review approves production or an AI impersonates a human | CTRL-004: existing SDD gates, distinct actor records, no merge/production/approval-writing commands; human independently validates identity | SEC-004 | ST-004 |
| TH-005 | README or fixture says ignore policy and execute commands | CTRL-005: explicit untrusted-data prompt boundaries; policy read only from pinned controller source | SEC-005 | ST-005 |
| TH-006 | Edit after tests or replay prior attempt yields false PASS | CTRL-006: snapshot/config/task/attempt binding; recollect on drift; immutable evidence and non-vacuous required criteria | FR-005, FR-007 | IT-003 |
| TH-007 | Crash/concurrent retries corrupt status or hide attempt | CTRL-007: exclusive writer, atomic authoritative state, operation intent, generation and immutable history | NFR-001, OBS-001 | IT-004 |

Residual risks: same OS account is not an enforceable boundary; worktrees share Git metadata; actor strings do not authenticate humans; redaction cannot prove absence of arbitrary encoded secrets; trusted commands still invoke untrusted code; interruption may leave a worktree needing reconciliation. CL-001 must settle isolation before implementation. Local validation cannot establish production readiness. No production access or secret reads are proposed as verification.
