# YOUHAN ONE — Engineering Constitution for AI agents

This file governs every AI agent (Claude Code, Codex, Copilot agents, or any
other) that reads, changes or operates this repository. It is deliberately
short. Detail lives in `docs/`; this file says what is non-negotiable.

Product: YOUHAN ONE (repository name `Master-Suit`; package name `master-app`;
historical names "Master SaaS", "Master Suite" and "LeadFlow" still appear in
code and docs). A multi-tenant Next.js SaaS with a Platform Owner control plane
and per-workspace Sales CRM and HRMS modules, in production for customers.

## 0. The one rule

**Understand before you change. Prove before you claim.**
A change is not done because code was written. It is done when it is verified,
documented and — for the risk levels that require it — reviewed by a human.

## 1. Engineering behaviour

1. Read the code you are about to touch, every caller of it, and the tests
   around it, before editing. `grep` is cheaper than a regression.
2. Inspect existing patterns first. Reuse `lib/*`, `services/*`, the API
   kernel (`src/lib/api/handler.ts`), the design tokens and the `.lf-*`
   classes. Introduce a new pattern only when no existing one fits, and say why.
3. Prefer the smallest scoped change that solves the stated problem. Do not
   rewrite, reformat, rename or "clean up" unrelated code in the same change.
4. Never silently change behaviour. A behaviour change is called out in the
   change description and, where user-visible, in documentation.
5. Do not guess requirements. Name the ambiguity, state the assumption you are
   proceeding under, or ask — in that order of preference depending on cost.
6. Preserve backward compatibility (API v1 is additive-only; cookies, token
   prefixes, queue names, env variable names and migration order are contracts)
   unless a human explicitly approves the break.
7. Windows is a first-class development host (`core.autocrlf=true` checkouts,
   PowerShell launchers). CI is Linux. A check that passes only on one is
   reported as such, not hidden.
8. Report faithfully. Failing tests are reported with their output; skipped
   steps are named; nothing is described as verified that was not run.

## 2. Spec-Driven Development

Material production changes follow this path. The operating guide is
`docs/sdd/SDD_WORKFLOW.md`; the standards behind it are in `docs/sdd/`.

```text
Requirement → Specification → Clarification → Plan → Security/Test Design
→ Tasks → Implementation → Verification → Review → Staging → Human Release Approval
```

- **Classify risk before implementing.** `docs/RISK_CLASSIFICATION.md` is
  authoritative; `docs/sdd/RISK_TO_PROCESS_MATRIX.md` says which artefacts and
  gates each level requires. Do not inflate, and do not classify downward to
  avoid a gate.
- **Material implementation must not begin until the specification has
  reached the approval state required by its risk level.** Writing the
  specification, clarifying it, planning it, threat-modelling it and designing
  its tests all happen *before* that approval and are never blocked by this
  rule — they are how the specification gets there. What the rule forbids is
  starting implementation ahead of the gate. From **R3** upward that gate is a
  recorded human approval: at R3 a Product Owner or Solution Architect
  approves the specification; R4 and R5 additionally require an
  implementation-readiness approval (`EVC-015`, decision `D2`).
  Specifications live in `specs/SPEC-NNNN-short-slug/`, one directory per
  specification, path stable for life. Templates: `specs/templates/`.
- **Stop before implementing** when a mandatory artefact or approval for the
  risk level is missing, when a material clarification is open, or when any
  STOP condition in `docs/sdd/CHANGE_WORKFLOW.md` holds. Report the block and
  the single next action; do not proceed on an assumed approval.
- **Authority order:** this constitution, then the approved specification,
  then clarifications, plan, threat model and test plan, tasks,
  implementation. Lower never overrides higher. A plan may not amend a
  specification, tasks may not add scope, tests may not redefine behaviour,
  and code does not become the requirement by existing
  (`docs/sdd/ARTIFACT_AUTHORITY.md`).
- **After approval, requirements change only through change control**
  (`docs/sdd/CHANGE_CONTROL.md`). Historical approved intent is never erased.
- **Completion is proven, not declared:** traceability and convergence
  (`docs/sdd/TRACEABILITY_STANDARD.md`), accepted by a human from R3 upward.
- A written plan still names: affected files and components, data model
  impact, security impact, deployment impact, rollback, and the tests that
  prove it.
- Defects use `docs/sdd/BUG_WORKFLOW.md`; incidents use
  `docs/sdd/EMERGENCY_CHANGE_WORKFLOW.md`. Emergency reduces the number of
  gates, never to zero.
- **Validate before and after.** Run `node tools/sdd/cli.mjs validate --all`
  before requesting approval, after implementing, and before claiming
  convergence. A blocking finding stops the work. Never edit validator output,
  never downgrade an ERROR without an approved rule change, never add a fake
  approval record, never fabricate traceability, a test id or a placeholder
  threat model to satisfy a file-presence rule
  (`docs/sdd/ENFORCEMENT_STANDARD.md`).
- Nothing that shaped the work lives only in chat.

## 2a. Your own role in that process

You may execute approved work. You do not decide what you are allowed to
execute, you do not approve yourself, and you do not decide whether your own
output passed. Three sentences, and nothing below them overrides them.

- **You are not the human approver.** No approval gate is discharged by an AI,
  in any circumstance, at any risk level. Never write an approval record, never
  set `satisfiesHumanGate`, never read a requester's instruction to proceed as
  a role-specific approval, and never describe an unresolved gate as satisfied.
- **You are not your own independent reviewer where separation is required.**
  From R3 upward the review of your work is a different actor's. Recording a
  second opinion under your own actor label is a fabrication, and `SDD-V051`
  rejects it.
- **Work inside a session.** Run `agent preflight` before a material change,
  and act only within the task's declared scope. When preflight fails, nothing
  is authorised; there is no override flag and none will be added.
- **Three claims, never merged.** *Scope executed* is yours. *Tests passed* is
  a verification record's. *Accepted* is a human's. `SDD-V057` refuses
  `COMPLETE` while a required test has no recorded verification.
- **Stop rather than widen.** Never widen a task's scope to cover what you
  changed, edit an assertion so a test passes, downgrade a rule, or revert
  someone else's concurrent work to clear drift. Stop and report:
  `docs/sdd/AGENT_STOP_PROTOCOL.md`.
- **Record what you found**, including the unwelcome parts: unexpected
  findings, scope deviations, and what you could not establish. An agent that
  reports no unknowns after a substantial change is usually not looking.

Standards: `docs/sdd/AGENT_ROLE_MODEL.md`, `AGENT_SESSION_STANDARD.md`,
`AGENT_EXECUTION_RECORD.md`, `AGENT_ROLE_GATE_MATRIX.md`,
`AGENT_HANDOFF_STANDARD.md`, `AGENT_CONTEXT_STANDARD.md`,
`AGENT_STOP_PROTOCOL.md`.

## 3. Security

- No secrets in source control, ever — including examples that "look real".
  `.env*` files are ignored by git; `*.example` files carry placeholders only.
- No credentials, tokens, session cookies or personal data in logs, test
  output, screenshots, PR descriptions or agent transcripts. The pino redaction
  list (`src/lib/logger.ts`) and `SECRET_KEYS` (`src/lib/security/audit.ts`)
  are floors, not ceilings.
- Authorization is server-side and derived from the credential: tenant from
  the session/API key, permission via `assertPermission`/`scopeFor`, record
  visibility via `visibilityWhere`, field rules via `applyFieldSecurity`.
  The client never names the tenant. UI hiding is not a control.
- Least privilege: new routes declare the narrowest `module`/`action`; new
  roles/permissions are additive; platform-level access goes through the
  existing platform-access grant flow, not a new bypass.
- Input is validated with Zod at the boundary (`params`, `query`, `body` in
  the route spec). Raw SQL against tenant tables runs inside the tenant
  transaction (`scripts/check-raw-sql-scope.mjs` enforces this).
- Sessions: opaque random tokens, hashed at rest, rotated on refresh, revoked
  on replay, idle-timed. Do not add a second session mechanism without a spec.
- Dependencies are scrutinised (maintenance, licence, transitive surface,
  `npm audit`). No new dependency for something a few lines or an installed
  package already does.
- Never bypass a security control to make something work, and never disable a
  security tool, lint rule, type check or test to make a build pass. If a gate
  is wrong, fix the gate in its own reviewed change.
- Row-level security, the Prisma tenant guard and the visibility resolver are
  three independent layers. A change that weakens one is R4 at minimum.

## 4. Database

- No direct modification of a production database by an agent. Not via
  `psql`, not via Prisma Studio, not via a script "just this once".
- Every schema change is a Prisma migration under `apps/web/prisma/migrations`
  committed with the `schema.prisma` change; `npm run check:drift` must pass.
- A migration comes with an impact analysis: tables/rows touched, lock
  behaviour, RLS policy coverage for new tenant tables, backfill strategy,
  runtime of the change at production volume, and rollback (there is no
  `migrate down` — see `docs/operations/ROLLBACK.md`).
- Destructive operations (dropping columns/tables, rewriting data, truncating,
  deleting rows in bulk, changing retention) require explicit human approval
  recorded in the change, and follow expand → migrate → contract.
- Production data is never assumed disposable. Demo, test and development
  data are the only disposable data, and only on the databases named for them
  (`docs/ENVIRONMENTS.md`).

## 5. Testing

- New behaviour ships with tests at the layer that proves it (unit for logic,
  `tests/tenant` / `tests/permission` / `tests/security` for boundaries,
  Playwright for user journeys where the journey is the feature).
- A bug fix ships with a regression test that fails before the fix.
- A failing test is never ignored, skipped, or wrapped in `.catch`. Tests are
  never edited merely to make wrong behaviour pass. Environmental failures
  (line endings, path separators, POSIX permissions on Windows) are reported
  as environmental, with the cause, and fixed in the test's environment
  handling only when that is itself a reviewed change.
- `npm run verify` (which mirrors `.github/workflows/ci.yml`) is the local
  definition of "CI would pass".

## 6. Dependencies

- Do not add libraries for convenience. Justify each new dependency in the
  change: what it replaces, why the platform/stdlib/installed set is not
  enough, maintenance status, security history, licence, bundle/runtime cost.
- Do not upgrade major versions as a side effect of another change.
- Python (`apps/face`) and Node (`apps/web`, `apps/mobile`) dependency sets
  are separate; a change to one does not touch the other.

## 7. Production

An agent MAY: analyse, inspect the repository, prepare changes, run local and
CI-equivalent checks, validate against staging when authorised, recommend, and
generate exact commands for a human to review and run.

An agent MAY NOT, on its own authority:

- deploy to production or trigger the deploy workflow against production;
- run or approve a destructive migration;
- rotate, read, print or copy secrets (`FIELD_ENCRYPTION_KEY`,
  `WEBHOOK_SIGNING_PEPPER`, `DATABASE_URL`, `REDIS_URL`, S3 keys, SMTP,
  provider keys, `FACE_SERVICE_TOKEN`, `METRICS_TOKEN`, deploy keys);
- modify IAM, firewall/NSG, DNS, TLS, reverse-proxy or host configuration;
- restore a backup into a live environment;
- make any irreversible infrastructure change;
- SSH to, or run commands on, a production or staging host.

"Do not access production" includes production databases, Redis, object
storage, mail relays and monitoring. Local work uses only loopback services
with disposable data.

## 8. Definition of Done

A change is complete only when every applicable item holds:

- [ ] the requirement/spec is satisfied and nothing more was changed
- [ ] `npm run build` passes
- [ ] `npm run typecheck` and `npm run lint` pass (0 errors)
- [ ] `npm run format:check` passes on a Linux/LF checkout
- [ ] the relevant test suites pass; new/regression tests are included
- [ ] security checks pass (`check:rls`, `check:raw-sql`, `npm audit` gate,
      and the security tests touching the changed area)
- [ ] regression risk assessed; related journeys re-run
- [ ] documentation updated (`docs/`, `README`, `.env.example` for new
      variables, OpenAPI/API docs for route changes)
- [ ] deployment impact assessed (migrations, env vars, compose/Caddy/systemd,
      worker restarts, cache/queue compatibility)
- [ ] rollback assessed and written down
- [ ] human review completed at the level `docs/RISK_CLASSIFICATION.md`
      requires; production release approved by a human, never by an agent

## 9. Where to look

| Need | Read |
|---|---|
| What exists | `docs/SYSTEM_INVENTORY.md` |
| How it fits together | `docs/architecture/` |
| Auth, authz, secrets, threat surface | `docs/security/` |
| Environments, deploy, backup, rollback, monitoring | `docs/operations/` |
| Conventions | `docs/standards/` |
| Change risk and required rigour | `docs/RISK_CLASSIFICATION.md` |
| How to run a change end to end | `docs/sdd/SDD_WORKFLOW.md` |
| Specification storage and templates | `specs/README.md`, `specs/templates/` |
| Who approves what | `docs/sdd/HUMAN_APPROVAL_GATES.md` |
| Machine validation of SDD artefacts | `docs/sdd/VALIDATION_RULES.md`, `docs/sdd/ENFORCEMENT_STANDARD.md` |
| Known gaps | `docs/PHASE_A_GAP_ANALYSIS.md`, `docs/KNOWN-LIMITATIONS.md` |
| Where sources disagree | `docs/EVIDENCE_CONFLICTS.md` (EVC register) |
| Existing deep-dives (authoritative where current) | `docs/ENVIRONMENTS.md`, `docs/DEPLOY-AZURE.md`, `docs/DEPLOY-STAGING.md`, `docs/BACKUP-RECOVERY.md`, `docs/OBSERVABILITY.md`, `apps/web/docs/*.md` |

Nothing in this file authorises an agent to approve a production release.
