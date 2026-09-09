# YOUHAN ONE Evidence Conflict Register

Authoritative register of material disagreements between evidence sources.
Identified during Phase A (2026-09-07); EVC-015 added during Phase B3
convergence (2026-09-07); EVC-016 during Phase B4.0 (2026-09-08); EVC-017 at B4 pilot #1 closure
(2026-09-08). IDs are stable and are never
renumbered or deleted; resolved conflicts move to the second section with
their original disagreement preserved.

Severity: C0 informational · C1 documentation inconsistency · C2 engineering
ambiguity · C3 material architecture/operations ambiguity · C4
security/data/production-critical ambiguity.

Summary: 17 identified · 10 OPEN · 3 PARTIALLY RESOLVED · 2 RESOLVED · 2
ACCEPTED DIFFERENCE · C4: 1 · release-blocking: 1 · to be determined: 4.

---

## Open Conflicts

### EVC-001 — Documented layering does not match the code

Status: OPEN · Severity: C2 · Release impact: NON-BLOCKING
Domain: Architecture / Backend · Affected component: request → data path

Evidence A — Level E4 — `apps/web/docs/00-ARCHITECTURE.md` §2 "Layering
rules": route handlers and server actions "never touch `prisma` directly";
a `src/repositories/**` layer exists; server actions live in
`src/app/**/actions.ts`.

Evidence B — Level E1 — `apps/web/src/app/api/**/route.ts`: 136 of 173
route files import `@/lib/db`; `src/repositories` does not exist; there are
0 `actions.ts` files and 0 `'use server'` directives.

Additional evidence — E1: `src/services/**` (79 files import `@/lib/db`),
`src/lib/api/handler.ts` (the kernel passes `ctx` to handlers, not a
repository). E4: the same document's §1 topology otherwise matches the code.

Conflict description: the document describes a four-layer architecture; the
implementation is route → service → Prisma (with a tenant-guard extension),
plus routes that query Prisma directly.

Material impact: Development risk + documentation accuracy. An agent
following §2 would look for a layer that does not exist, or would introduce
one unasked.

Current conclusion: the implementation is the current state; §2 describes an
intended design that was not built (or was removed). Documentation is
considered stale for §2. INFERRED whether the intent still stands.

Confidence: High (about the code) · Required verification: product/tech-lead
decision on whether the repository layer is still intended.

Resolution owner: Application Engineering
Affected documentation: `docs/architecture/BACKEND.md`,
`docs/architecture/SYSTEM_OVERVIEW.md`, `docs/standards/CODING_STANDARDS.md`

---

### EVC-002 — Queue inventory differs between document and code

Status: OPEN · Severity: C2 · Release impact: NON-BLOCKING
Domain: Architecture / Backend · Affected component: background jobs

Evidence A — Level E4 — `apps/web/docs/00-ARCHITECTURE.md` §5: nine queues
named `automation`, `distribution`, `sla`, `messaging`, `campaign`,
`import`, `export`, `webhook`, `maintenance`, with per-queue concurrency
(25/10/10/40/4/3/3/20/2) and repeatable jobs (SLA sweeper 60 s, score decay
daily 02:00 tenant-local, list rebuild 15 m, partition creation weekly,
export-link expiry hourly).

Evidence B — Level E1 — `apps/web/src/lib/queue.ts` `QUEUE_NAMES`: nine
queues named `automation`, `distribution`, `sla`, `campaign`, `webhook`,
`maintenance`, `media`, `ai`, `notifications`. Only `maintenance` declares
`concurrency: 1`; the others use the BullMQ default. Schedulers found:
`retention-daily`, a quarter-hourly maintenance job
(`src/workers/maintenance.ts`), `campaign-sweep` every 60 s
(`src/workers/campaigns.ts`).

Additional evidence — E1: `src/workers/index.ts` starts exactly the workers
for the code list; a comment in that file records that a start-up log once
named `messaging`, `import` and `export` queues that had no workers.

Material impact: Documentation accuracy + operational risk (alerts and
runbooks keyed to non-existent queue names).

Current conclusion: the code list is current; §5 is stale.
Confidence: High · Required verification: none for the code; decide whether
the missing capabilities (import/export queues) are still planned.

Resolution owner: Application Engineering
Affected documentation: `docs/architecture/BACKEND.md`,
`docs/SYSTEM_INVENTORY.md`

---

### EVC-003 — Two descriptions of the deployment mechanism

Status: OPEN · Severity: C3 · Release impact: TO BE DETERMINED
Domain: Deployment · Affected component: release path

Evidence A — Level E4 — `docs/DEPLOYMENT.md` (15 lines, last change
2026-08-05): "The current launcher is for local development. Production
deployment must use…" — a list of requirements, no mechanism.

Evidence B — Level E1/E2 — `apps/web/scripts/release.sh` (build/promote/
rollback by commit tag), `.github/workflows/deploy.yml` (manual dispatch,
verify-gated, `environment:` protected, SSH → `release.sh`),
`infra/docker-compose.{prod,azure,staging}.yml`, `docs/DEPLOY-AZURE.md`
(2026-08-21).

Additional evidence — E2: `infra/systemd/*` and
`scripts/install-backup-schedule.sh` assume the Compose deployment on a VM.

Material impact: Deployment risk. Two documents describe different worlds;
an operator reading the older one would not find the release path.

Current conclusion: the `release.sh` + Compose + Caddy path is the current
documented and automated mechanism; `docs/DEPLOYMENT.md` predates it and is
superseded. Whether production actually runs this path is separate and
`UNKNOWN — requires runtime/infrastructure verification`.

Confidence: High (repository), Unknown (production)
Required verification: confirm on the host which mechanism is in use and
which commit is deployed.

Resolution owner: DevOps
Affected documentation: `docs/operations/DEPLOYMENT.md`,
`docs/operations/ROLLBACK.md`, `docs/SYSTEM_INVENTORY.md`

---

### EVC-004 — RLS rollout document contradicts migrations and gates

Status: PARTIALLY RESOLVED · Severity: C4 · Release impact: TO BE DETERMINED
Domain: Security / Database · Affected component: tenant isolation

Evidence A — Level E4 — `docs/RLS-ROLLOUT.md` (20 lines, 2026-08-05): role
and policy templates live in `infrastructure/postgres`; they "are not
automatically applied by the local launcher because the current Sales server
still has server-rendered and authentication bootstrap queries that do not
all…" — i.e. RLS not yet in force.

Evidence B — Level E1/E2 — 26 files under `apps/web/prisma/migrations`
contain `FORCE ROW LEVEL SECURITY`; `scripts/check-rls.mjs` is a CI gate
("Tenant isolation" step in `ci.yml`); `src/lib/startup-check.ts` refuses to
serve when the connected role has `BYPASSRLS`/superuser or when tenant
tables are unforced; `src/lib/db.ts` pins `app.tenant_id` per transaction.

Additional evidence — E3: `tests/tenant/rls.spec.ts`, `isolation.spec.ts`,
`pooling.spec.ts`. E4: `apps/web/README.md` "Tenant isolation, three times
over" and `docs/KNOWN-LIMITATIONS.md` both describe RLS as enforced. A local
run of `check-rls.mjs` in this workstream reported forced RLS across the
tenant tables (TESTED locally, not in production).

Material impact: Security risk if believed in the wrong direction. An agent
reading only `RLS-ROLLOUT.md` could assume application-level filtering is the
only isolation layer and "helpfully" relax a guard.

Current conclusion: RLS is enforced in the current schema and gated in CI;
`docs/RLS-ROLLOUT.md` describes the pre-unification state and the
`infrastructure/postgres/*.sql` templates are Legacy / potentially inactive.
Production catalogue state is not verifiable from the repository.

Confidence: High (repository) · Required verification: run the RLS catalogue
check against production (read-only) and confirm the app role attributes.

Resolution owner: Security Engineering / Database Engineering
Related: `docs/security/SECURITY_MODEL.md`, `docs/architecture/DATABASE.md`

---

### EVC-005 — Backup capability: readiness checklist vs backup documentation and scripts

Status: OPEN · Severity: C3 · Release impact: **BLOCKING**
Domain: Backup/Restore · Affected component: data recovery

Evidence A — Level E4 — `docs/OPERATIONAL-READINESS.md` (2026-08-26),
"Status: NOT VERIFIED. Every item below is unexecuted": §2 shows
"Automated Postgres backup on a schedule", "Backups encrypted at rest",
"Restore to a scratch instance and verify row counts", RPO/RTO all
unticked for both Exists and Rehearsed; §1 refers to "11 migrations" and
asks for a drift CI step.

Evidence B — Level E2/E4 — `apps/web/scripts/backup.sh`, `backup-ship.sh`,
`backup-status.sh`, `restore-verify.sh`, `install-backup-schedule.sh`,
`test-backup-roundtrip.sh`, `infra/systemd/*` (six units: nightly 02:30,
daily 09:00 freshness, weekly restore-verify); `docs/BACKUP-RECOVERY.md`
(2026-08-21) records the database half verified on 2026-08-20 and the
off-host round trip on 2026-08-21. `ci.yml` has both the drift step and a
"Backup round trip" step. The repository holds 65 migrations, not 11.

Material impact: Production reliability + data-loss risk. The two documents
give opposite answers to "are we backed up?".

Current conclusion: the mechanism exists in the repository and part of it is
verified off-deployment; the readiness checklist was not updated after that
work. Neither source establishes that backups are installed and succeeding
on the production host, and the object-storage half is documented as never
exercised against a live bucket.

Confidence: High (about the repository) · Unknown (about production)
Required verification: on the host — `systemctl list-timers` for the three
units, the most recent `manifest.txt`, one `restore-verify.sh` run against
the real backup set including objects, and a written RPO/RTO.

Resolution owner: DevOps
Affected documentation: `docs/operations/BACKUP_RESTORE.md`,
`docs/operations/ROLLBACK.md`, `docs/PHASE_A_GAP_ANALYSIS.md`

---

### EVC-006 — `npm run openapi` references a script that is not in the repository

Status: OPEN · Severity: C1 · Release impact: NON-BLOCKING
Domain: API / Documentation · Affected component: API specification

Evidence A — Level E2 — `apps/web/package.json`: `"openapi": "tsx
scripts/generate-openapi.ts"`.
Evidence B — Level E1 — `apps/web/scripts/generate-openapi.ts` does not
exist (directory listing and file check).

Additional evidence — E2: no CI step invokes `npm run openapi`; no
`openapi.*` artifact is committed.

Material impact: Documentation accuracy; a published API contract cannot be
generated as advertised.

Current conclusion: the script was removed or never committed; the npm
script is dead. Confidence: High.
Required verification: decide whether to restore the generator or drop the
npm script.

Resolution owner: Application Engineering
Affected documentation: `docs/standards/API_STANDARDS.md`

---

### EVC-007 — Design-system documents describe a superseded visual system

Status: OPEN · Severity: C1 · Release impact: NON-BLOCKING
Domain: Frontend / Documentation · Affected component: design system

Evidence A — Level E4 — `apps/web/docs/08-DESIGN-SYSTEM.md` ("LeadFlow CRM —
Burgundy Design System", claims it inlines the real `tokens.css`/`globals.css`
"so it cannot drift") and `docs/PREMIUM-UI-DESIGN-SYSTEM.md` (2026-08-03,
midnight/cyan premium direction).

Evidence B — Level E1 — the working tree (uncommitted) replaces
`src/styles/tokens.css` and `src/app/globals.css` with a neutral canvas
(`#f7f8fa`) and indigo accent (`#4640ce`) system across ~34 files.

Material impact: Documentation accuracy only.
Current conclusion: both documents are stale relative to the working tree
and will be wrong once the redesign is committed; the "cannot drift" claim
is already false because the referenced HTML file is not in the repository.
Confidence: High · Required verification: none; update on merge.

Resolution owner: Application Engineering
Affected documentation: `docs/architecture/FRONTEND.md`

---

### EVC-008 — Idempotency and optimistic concurrency documented but not located

Status: OPEN · Severity: C2 · Release impact: NON-BLOCKING
Domain: API · Affected component: write endpoints

Evidence A — Level E4 — `apps/web/docs/03-API.md` §2: `Idempotency-Key` on
POST/PATCH "stored 24 h, replays return the original response"; `If-Match:
<version>` on PATCH, mismatch returns 409.

Evidence B — Level E1 — no idempotency store or `If-Match` handling was
located in `src/lib/api/*` or the kernel during Phase A inspection. This is
negative evidence from a targeted search, not an exhaustive audit of all 173
route files.

Material impact: Integration risk. An integrator relying on the documented
retry semantics could double-write.

Current conclusion: unproven either way; the claim is downgraded to
DOCUMENTED in `docs/standards/API_STANDARDS.md`.
Confidence: Low · Required verification: grep every route and service for
`Idempotency-Key` / `If-Match` / version columns; write a test either way.

Resolution owner: Application Engineering
Affected documentation: `docs/standards/API_STANDARDS.md`,
`docs/architecture/BACKEND.md`

---

### EVC-009 — Node version differs across manifests and runtimes

Status: ACCEPTED DIFFERENCE (pending confirmation) · Severity: C1
Release impact: NON-BLOCKING · Domain: Configuration / CI/CD

Evidence A — E2 `apps/web/package.json`: `"engines": { "node": ">=22" }`.
Evidence B — E2 `.github/workflows/ci.yml`: `node-version: '24'`.
Evidence C — E2 `infra/Dockerfile`: `FROM node:22-alpine` for every stage.
Evidence D — E1 local development host: Node v24.18.0.

Material impact: Informational; a range that includes both. Risk is limited
to a defect that only appears on one major version, which CI would not
catch for the container's version.

Current conclusion: intentional range, not an error, but CI does not test
the version that ships. Confidence: High.
Required verification: confirm the intended runtime major and align CI or
the image.

Resolution owner: DevOps
Affected documentation: `docs/SYSTEM_INVENTORY.md`, `docs/operations/DEPLOYMENT.md`

---

### EVC-010 — Route authorization matrix predates the current route surface

Status: OPEN · Severity: C2 · Release impact: NON-BLOCKING
Domain: Security / API · Affected component: route authorization inventory

Evidence A — Level E4 — `security/APPLICATION_ATTACK_SURFACE.md`
(2026-08-08) states the per-route `module`/`action` matrix was "extracted
from source, not transcribed".
Evidence B — Level E1 — the repository now has 173 route files, of which 38
do not use the kernel; routes added after 2026-08-08 are absent from that
document.

Material impact: Security review risk — a reviewer could believe the matrix
is complete.
Current conclusion: the matrix is accurate for its date and incomplete for
today. Confidence: High.
Required verification: regenerate the matrix from the route specs (this is
also the action that would close SEC-OBS-002).

Resolution owner: Security Engineering
Related security observation: SEC-OBS-002
Affected documentation: `docs/security/AUTHORIZATION.md`

---

### EVC-011 — MFA enrolment credential named differently in remediation notes

Status: OPEN · Severity: C1 · Release impact: NON-BLOCKING
Domain: Authentication / Documentation

Evidence A — E4 `docs/SECURITY-REMEDIATION.md` (2026-08-05): "HR/admin
mandatory 2FA returns only a short-lived `2fa_enrollment` credential", and
"Normal HRMS APIs reject enrollment credentials".
Evidence B — E1 `src/lib/auth/session.ts` + `prisma/schema.prisma`: the
mechanism is a `PlatformSession` with `purpose = 'MFA_ENROLMENT'` and a
10-minute TTL; `resolveCtx` rejects it outside the enrolment routes.

Material impact: Documentation accuracy; the control is present under a
different name.
Current conclusion: same control, renamed during unification; the older note
describes the archived Python HRMS era. Confidence: High.

Resolution owner: Security Engineering
Affected documentation: `docs/security/AUTHENTICATION.md`

---

### EVC-012 — Two artifact paths: host-built images vs GHCR images

Status: OPEN · Severity: C3 · Release impact: TO BE DETERMINED
Domain: Deployment / Rollback · Affected component: release artifacts

Evidence A — E1 `apps/web/scripts/release.sh`: builds
`master-suite/web:<commit>` and `master-suite/worker:<commit>` **on the
host**, keeps them in the local daemon, and rolls back by starting a
previously built tag; it fails a rollback when the image is no longer on the
host ("rebuild that commit").
Evidence B — E2 `.github/workflows/build-images.yml`: builds the same
targets for an exact SHA and pushes to `ghcr.io/<repo>/{web,worker}:<sha>`.

Additional evidence — E2: `deploy.yml` calls `release.sh` and never pulls
from GHCR; `docs/DEPLOY-AZURE.md` notes that separate hosts "would need a
registry — push after the staging build, pull before the production start".

Material impact: Rollback capability. If the host is lost or its image store
pruned, rollback depends on GHCR images that the deploy path does not use.
Current conclusion: the host-built path is the active release mechanism; the
GHCR workflow is a prepared, currently unused capability (INFERRED — the
workflow is manual and nothing consumes its output).
Confidence: Medium · Required verification: confirm whether GHCR images are
being built for releases, and decide whether the deploy path should pull.

Resolution owner: DevOps
Affected documentation: `docs/operations/DEPLOYMENT.md`,
`docs/operations/ROLLBACK.md`

---

### EVC-013 — Two ADR directories

Status: ACCEPTED DIFFERENCE · Severity: C0 · Release impact: NON-BLOCKING
Domain: Documentation

Evidence A — `docs/adr/0001-archive-python-hrms.md`.
Evidence B — `docs/ADRs/0001-preserve-service-boundaries.md`,
`docs/ADRs/0002-security-first-integration.md`.

Both contain an ADR numbered 0001 in different directories. Informational;
no behaviour depends on it. Current conclusion: pick one directory in a
later documentation change.
Resolution owner: Application Engineering

---

### EVC-014 — Unit suite fails locally on Windows, CI status unconfirmed

Status: PARTIALLY RESOLVED · Severity: C2 · Release impact: NON-BLOCKING
Domain: Testing · Affected component: `npm test`

Evidence A — E1/E3 — a local full run on Windows (2026-09-07) reports 12
failures in 3 files: `tests/unit/capture-vault.spec.ts` (path separator
`\` vs `/`), `tests/unit/env-example-parses.spec.ts` (CRLF worktree: the
line regex `(.*)$` does not match a trailing `\r`, so no variable is
parsed), `tests/unit/observability.spec.ts` (POSIX file mode 0600 and a
CRLF byte-comparison).
Evidence B — E2 — the files are LF in the git index
(`git ls-files --eol` → `i/lf w/crlf`) and CI runs on ubuntu-latest, where
the same code reads LF and supports POSIX modes.

Additional evidence: the local checkout has `core.autocrlf=true`; the same
12 failures were observed before any change made in this workstream, so they
are not a regression from it. CI's own recent result could not be read
(`gh` is not authenticated in this environment).

Material impact: Testing risk — a Windows contributor cannot distinguish an
environmental failure from a real one.
Current conclusion: environmental, not a product defect. Not proven green in
CI from inside this session.
Confidence: High (cause) · Medium (CI status)
Required verification: read the latest `verify` run on `main`; consider
`.gitattributes` and platform guards in those three specs.

Resolution owner: QA / Application Engineering
Affected documentation: `docs/standards/CODING_STANDARDS.md`,
`docs/PHASE_A_GAP_ANALYSIS.md`

---

### EVC-016 — Whether export formatting of already-authorised PII is an R4 trigger

Status: OPEN · Severity: C2 · Release impact: NON-BLOCKING for release,
**BLOCKING for the classification of any change that reformats PII the caller
may already read**
Domain: Engineering process · Affected component: R4 risk trigger,
"PII/biometric handling"

Evidence A — Level E4 — `docs/RISK_CLASSIFICATION.md`, the R4 row:
"anything in `src/lib/auth/*` or `src/lib/security/*`, permissions/roles/scopes,
visibility or field rules, RLS policies, session or MFA behaviour, audit
logging, **PII/biometric handling**, AI prompt or redaction changes, retention
periods, new outbound data flows."

Read literally, "PII handling" has no qualifier. A change that alters how
employee names are encoded into a CSV export is handling PII, and is therefore
R4.

Evidence B — Level E4 — `docs/sdd/RISK_TO_PROCESS_MATRIX.md`, "Escalation
triggers": "Retention, audit or **biometric** handling changes."

The escalation list names **biometric** handling and **omits PII**. Read
against Evidence A, either PII handling is an R4 trigger that cannot be reached
by escalation, or the two lists disagree about what PII handling means.

Additional evidence — E4 — `docs/security/SECURITY_MODEL.md`, "Sensitive data
categories", classifies "PII (names, phones, e-mails, addresses …)" and
"biometric templates and images" as **separate** categories at level E1. The
two are distinguished there and merged in the R4 row.

**The distinction that no document draws.** Three materially different kinds of
change are covered by the same four words:

| | Kind of change | Example |
|---|---|---|
| **A** | Access control or authorization over PII | changing who may export employee records |
| **B** | New collection or new disclosure of PII | adding a field to an export, or a new outbound flow |
| **C** | Transformation or export *formatting* of PII the caller is already authorised to read | changing how a cell is escaped in an export the user can already download |

`docs/RISK_CLASSIFICATION.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`,
`docs/security/SECURITY_MODEL.md`, `AGENTS.md` and `CLAUDE.md` were each
searched for language separating these. **None distinguishes them.** A
repository-wide search for "already authorised", "formatting", "re-encoding"
and "encoding of" in the governing set returns nothing.

Conflict description: whether category **C** is an R4 trigger is not
determinable from the authoritative artefacts. Evidence A read literally says
yes; Evidence B and the separate-category treatment in the security model
suggest the intent was narrower.

Material impact: this decides the required gate set for a live candidate.
`PC-01` in `docs/evidence/phase-b4-pilot-readiness/` — consolidating four
drifted client-side CSV encoders across three HR pages — is category **C**
exactly. At R3 it needs a specification approval and one human reviewer; at R4
it additionally needs a threat model, security tests proving the boundary,
mandatory Application Security review, and human approval before implementation
begins. It also decides whether `PC-01` is eligible as the first controlled
pilot at all, since this phase excludes R4 candidates from that role.

Current conclusion: UNKNOWN — requires a human classification decision. The
ambiguity was **not** resolved toward the lower class. `PC-01` is treated as
ineligible for first-pilot selection until a human decides.

Confidence: High (that the artefacts do not settle it) · None (about the
intended reading)

Required human decision: the owner of `docs/RISK_CLASSIFICATION.md` decides
whether category **C** — transformation or export formatting of PII the caller
may already access — is an R4 trigger, and the R4 row is then qualified so the
question does not recur. Deciding it also settles `PC-01`.

Resolution owner: Solution Architect, with Application Security consulted
Affected documentation: `docs/RISK_CLASSIFICATION.md`,
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`, `docs/security/SECURITY_MODEL.md`

---

### EVC-019 — May one qualified human fill both R4 reviewer slots?

Status: **OPEN** · Severity: C2 · Release impact: **BLOCKING for any R4 change
reaching merge**
Domain: Engineering process · Affected component: human code review at R4

Raised 2026-09-09 by the release owner while authorizing the `BUG-008`
remediation, which is `R4` and therefore lands on this rule immediately.

**The bounded question, and it is the only question here:**

> For an `R4` change requiring "2 reviewers, one security-literate", must those
> two reviewer slots be occupied by **two distinct human persons**?

Evidence A — Level E4 — `docs/RISK_CLASSIFICATION.md`, row "Human code review",
`R4` cell: **"2 reviewers (one security-literate)"**.

Evidence B — Level E4 — `docs/sdd/RISK_TO_PROCESS_MATRIX.md`, same row, `R4`
cell: **"2 reviewers, one security-literate"**. `R5` reads "2 reviewers plus the
operator who will run it", which distinguishes a *third* participant by function
and so implies the first two are also participants rather than roles — but it
says so only by implication.

Evidence C — Level E4 — neither document defines "reviewer" as a person, a
role, or a distinct account. Nothing anywhere states that one individual holding
both competencies may or may not satisfy both slots.

**Why it cannot be inferred.** Read as *roles*, one suitably qualified engineer
signs twice and the rule is satisfied. Read as *people*, it is a
four-eyes control and one signature can never satisfy it. The two readings give
opposite answers on the same change, and the difference is the entire value of
the control — so picking one silently would be deciding the governance question
rather than applying it.

Material impact: `BUG-008` is `R4`, implemented, and cannot reach merge until
this is answered. Any future `R4` change meets the same wall.

Confidence: High that the ambiguity exists; the register takes no position on
which reading is correct.

**Required decision — the SDD standard owner / governance owner, and only
them.** Exactly one of:

- **YES** — distinct humans are required.
- **NO** — the same qualified human may satisfy both reviewer slots.

Record the decision, the deciding human's role, and the date, in the same shape
`EVC-015`, `EVC-017` and `EVC-018` use.

**Not permitted, and stated because the temptation is obvious:** an AI review
may not occupy either slot, whichever way this is decided. No agent may answer
this entry, and none has.

## Resolved Conflicts

Resolved entries keep their original disagreement intact and gain a
`RESOLUTION` block recording who decided, what was selected and which
documents were corrected.

---

### EVC-015 — Who may approve an R3 specification before implementation

Status: RESOLVED · Severity: C2 · Release impact: NON-BLOCKING for release,
**was BLOCKING for the convergence of any R3 specification lacking a recorded
specification approval**
Domain: Engineering process · Affected component: R3 specification-approval
authority

**Scope of this conflict.** It concerned *who may approve an R3
specification*, and nothing else. It did **not** concern whether R3 requires a
separate implementation-readiness approval; that question was never in
dispute and is recorded below under "Not in conflict".

Evidence A — Level E4 — `docs/sdd/HUMAN_APPROVAL_GATES.md`, gate 1
"Specification approval": "R0/R1: author. R2: author. **R3: Product Owner or
Solution Architect.** R4/R5: Product Owner **and** Solution Architect."

Evidence B — Level E4 — `docs/sdd/HUMAN_APPROVAL_GATES.md`, gate 5
"Implementation readiness", as it read before this resolution: "Required at R4
and R5. The specification may not enter `APPROVED_FOR_IMPLEMENTATION` without
it. **At R0–R3 the author proceeds once the artefacts the risk matrix requires
exist.**"

Both statements were normative, both sat in the same document, and at R3 they
selected different approvers: a named non-author role under A, the author
under B. At R0–R2 they agreed, because gate 1 names the author there. The
disagreement existed at R3 only.

**Full audit of the governing set, as it stood when the conflict was open.**

| Document | Authority | What it said about R3 specification approval | Supported |
|---|---|---|---|
| `docs/RISK_CLASSIFICATION.md` | **authoritative** risk model | Silent. Its rigour table has no specification-approval row; its only approval row is "Production approval" | neither |
| `docs/sdd/RISK_TO_PROCESS_MATRIX.md` | operationalises the above | "Required gates" table, "Spec approval" row at R3: "Product Owner or Solution Architect" | **A** |
| `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 1 | names the roles | "R3: Product Owner or Solution Architect" | **A** |
| `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 5 | names the roles | "At R0–R3 the author proceeds once the artefacts the risk matrix requires exist" | **B** |
| `docs/sdd/SPEC_LIFECYCLE.md` | lifecycle | Entry to `APPROVED_FOR_IMPLEMENTATION` requires "human approval is recorded where the risk level requires it" — conditional, and deferred the question | neither |
| `docs/sdd/SDD_WORKFLOW.md` | operating guide | "the approval state required by its risk level"; its risk table named human approval at R4 and R5 and not at R3 | neither |
| `docs/sdd/CHANGE_WORKFLOW.md` | operating guide | "The gates for the risk level"; names human approval at R4 and R5 only — deferred on who approves at R3 | neither |
| `AGENTS.md` | constitution | "Material implementation must not begin until the specification has reached the approval state required by its risk level" — deferred | neither |
| `CLAUDE.md` | operating rules | Restated `AGENTS.md`; "At R4 and R5, stop after step 8 and ask" | neither |

Six of the nine deferred or were silent. The disagreement was between two
statements in one document, with the risk matrix siding with one of them.

**Deliberately not resolved by counting.** A two-to-one tally is not an
authority argument, and the document that would have settled it —
`docs/RISK_CLASSIFICATION.md`, the authoritative risk model — does not address
specification approval at all. Nothing in this register selected an
interpretation; a human did.

**Not in conflict: R3 implementation-readiness approval.** Seven sources agree
that R3 requires none, with no dissent found:
`docs/RISK_CLASSIFICATION.md` ("an AI agent … may execute R0–R3 locally. R4
requires a human to accept the plan before implementation");
`docs/sdd/RISK_TO_PROCESS_MATRIX.md` (the gate 5 row is "—" at R3, "Agent may
execute" is "yes"); `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 5 ("Required at R4
and R5"); `docs/sdd/SPEC_LIFECYCLE.md`; `docs/sdd/SDD_WORKFLOW.md` (its risk
table places "human approval before implementation" at R4);
`docs/sdd/CHANGE_WORKFLOW.md` ("At R4 and R5 that approval is human and is
recorded before any code is written"); and the implementation
`tools/sdd/lib/lifecycle.mjs` (`requiresImplementationApproval` returns true
for R4 and R5 only).

Material impact: an R3 specification could enter
`APPROVED_FOR_IMPLEMENTATION` under two different readings — with a Product
Owner or Solution Architect approval recorded, or with none. Every future R3
change was affected, not only `SPEC-0002`.

What each interpretation meant for a future agent:

- **Under A**, an agent preparing an R3 specification stops at
  `READY_FOR_APPROVAL` and waits for a Product Owner or Solution Architect.
  `SPEC-0002` crossed that gate and `CONV-004` is a real deviation.
- **Under B**, an agent proceeds once the required artefacts exist.
  `SPEC-0002` crossed nothing and `CONV-004` largely dissolves.

Confidence: High (that the two statements disagreed) · None (about which was
intended) — resolved by decision, not by inference.

**What Phase B3 did while the conflict was open, stated as fact rather than as
a finding.** B3 operated under interpretation A, treating the gate as crossed
and recording `CONV-004` as open. That was the conservative course for a phase
that could not obtain an approval either way. It was not a resolution of this
conflict and created no precedent.

Resolution owner: Solution Architect
Affected documentation: `docs/sdd/HUMAN_APPROVAL_GATES.md` (gates 1 and 5),
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`, `docs/sdd/SPEC_LIFECYCLE.md`,
`docs/sdd/SDD_WORKFLOW.md`, `AGENTS.md`, `CLAUDE.md`

**RESOLUTION**

Resolved on: 2026-09-08
Deciding functional role: Solution Architect
Decision reference: `D2`, Phase B3 human governance decisions

**Selected interpretation: Option A.**

An R3 specification must be approved by a Product Owner or Solution Architect
before implementation begins. The author or AI agent may prepare every
specification-development artefact before that approval — drafting,
clarification, planning, threat modelling where applicable, test design, task
decomposition and traceability. R3 requires **no** separate
implementation-readiness approval after the specification approval, and an AI
agent may not approve its own R3 specification.

```text
SPECIFICATION DEVELOPMENT
        ↓
READY_FOR_APPROVAL
        ↓
PRODUCT OWNER OR SOLUTION ARCHITECT APPROVAL
        ↓
IMPLEMENTATION MAY BEGIN
```

Reason recorded: the deciding role stated this as the authoritative policy for
future R3 work. The register records the decision, not a justification the
decider did not supply.

**Normative corrections applied**, the smallest set sufficient to remove the
contradiction:

| Document | Correction |
|---|---|
| `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 5 | "At R0–R3 the author proceeds" narrowed to R0–R2; R3's position stated explicitly. This was the contradicting statement |
| `docs/sdd/RISK_TO_PROCESS_MATRIX.md` | Gate 5 row relabelled "Separate implementation-readiness approval"; a note explains that a dash at R3 means no *second* approval, not that implementation may begin without gate 1 |
| `docs/sdd/SPEC_LIFECYCLE.md` | "For R4 and R5 an AI agent may not enter this state on its own judgement" extended to R3, naming which approval applies at each level |
| `docs/sdd/SDD_WORKFLOW.md` | The R3 row of the risk table now names specification approval before implementation |
| `CLAUDE.md` | "At R4 and R5, stop after step 8 and ask" extended to R3 |
| `AGENTS.md` | The approval-state rule now states that from R3 upward the gate is a recorded human approval |

No unrelated governance was modified. No tooling change was required:
`requiresImplementationApproval` in `tools/sdd/lib/lifecycle.mjs` returns true
for R4 and R5 only, which remains correct — R3 needs gate 1, not gate 5.

**Resolution evidence:** `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 5 carries a
dated resolution note; `node tools/sdd/cli.mjs validate --all` is clean; the
B2 validator suite is 56 of 56. No normative document now states that the
author may proceed at R3.

**Verification that the contradiction is gone.** A search for the former
clause returns only historical quotations — this entry, and the Phase B3
evidence recording what the conflict was. Those are the record and are
deliberately preserved.

**Follow-on work identified, not closed by this resolution.** Under Option A,
an R3 specification entering `APPROVED_FOR_IMPLEMENTATION` without a recorded
gate 1 approval is now a policy violation, and **no validator rule detects
it**. `SDD-V020` reports a missing implementation approval at R4 and R5 only.
A rule extending that check to R3 specification approval would close the gap.
That is new tooling work, outside the scope of `SPEC-0002`, and is recorded
here and in the Phase B3 known limitations rather than implemented
opportunistically.

**Effect on `SPEC-0002`.** Under the selected interpretation the gate was
required and was crossed. `D1` supplies the approval, and `CONV-004` is
resolved on that basis rather than dissolved by the policy choice.

---



---

### EVC-017 — Who exercises the author's convergence-acceptance authority when the author is an AI

Status: RESOLVED · Severity: C2 · Release impact: NON-BLOCKING for release,
**BLOCKING for final convergence acceptance of any AI-authored R0-R2
specification**
Domain: Engineering process · Affected component: gate 6, convergence
acceptance

Evidence A — Level E4 — `docs/sdd/HUMAN_APPROVAL_GATES.md`, gate 6:
"R0–R2: author. R3: reviewer. ... An agent produces the convergence report and
a recommended verdict; **a human accepts it at R3 and above**."

Read literally, at R0–R2 the author accepts, and the qualifier "a human accepts
it at R3 and above" implies that below R3 the acceptor need not be a human.

Evidence B — Level E4 — `docs/sdd/RISK_TO_PROCESS_MATRIX.md`, row
"Convergence verdict accepted by": **author** at R0, R1 and R2.

Evidence C — Level E4 — `AGENTS.md`: "**You are not the human approver.** No
approval gate is discharged by an AI, **in any circumstance, at any risk
level**. Never write an approval record, never set `satisfiesHumanGate` ..."

Conflict description: when the author of an R0–R2 specification is an AI agent,
Evidence A and B name that agent as the acceptor and Evidence C forbids it from
accepting. The gate therefore has **no eligible actor**, and no document in the
authoritative set names a substitute.

**A search of `docs/sdd/HUMAN_APPROVAL_GATES.md`,
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`, `docs/sdd/SPEC_LIFECYCLE.md`,
`docs/sdd/SDD_WORKFLOW.md`, `AGENTS.md` and `CLAUDE.md` for an AI-authorship
substitute rule returns nothing.**

Material impact: `SPEC-0003` has reached zero open findings with a verdict of
PASS WITH ACCEPTED LIMITATIONS, a recorded human code review, and a green
verification stack. Only convergence acceptance remains, and it cannot be
executed because the role that would sign it is undefined. B4 pilot #1 cannot
formally close.

**This is the sibling of `EVC-015`**, which asked who approves an R3
specification and was resolved by Solution Architect decision `D2`. The same
gap exists one gate later and one risk level lower. The gate 1 instance was
already worked around once on this pilot — a human Product Owner approved
`SPEC-0003` because its AI author could not — but that was an ad hoc decision
and set no rule.

Current conclusion: UNKNOWN — requires a human governance clarification. The
ambiguity was **not** resolved by an agent choosing a plausible role. Product
Owner, Solution Architect, QA / Release Engineering and "any competent human"
were each considered; none is stated by the authoritative set.

Confidence: High, that the artefacts do not settle it · None, about the
intended role

Required human decision: **for an AI-authored R0–R2 specification, which human
functional role exercises the author's convergence-acceptance authority?** The
answer should be written into gate 6 so the question does not recur.

Resolution owner: Solution Architect, as owner of the governance documents
Affected documentation: `docs/sdd/HUMAN_APPROVAL_GATES.md`,
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`

**RESOLUTION**

Resolved on: 2026-09-08
Deciding functional role: Solution Architect, as owner of the governance
documents
Decision reference: `EVC-017` policy clarification, B4 pilot #1 closure

**Selected policy.**

| Author | R0–R2 convergence accepted by |
|---|---|
| human | the author — **unchanged** |
| AI agent | a **Qualified Human Reviewer** |

R3 is unchanged and continues to follow the existing reviewer rule.

The substitution exists **only** because an AI author is prohibited from
self-approving. It does not alter the normal R0–R2 rule for human-authored
work.

**Obligations of the Qualified Human Reviewer.** Be a real human; review the
final convergence evidence; understand the final verdict; understand every
`ACCEPTED_RISK` finding; explicitly ACCEPT or REJECT. **An AI review does not
satisfy this role.**

**Separation preserved.** The convergence decision remains distinct from
specification approval, architecture approval, code review, security risk
acceptance, and release, staging or production approval. One human may perform
both the code review and the convergence acceptance where the risk matrix
permits, but the two decisions are recorded separately — as they were on
`SPEC-0003`, where `REV-0002` records the code review and the manifest records
the convergence acceptance independently.

**Documents corrected.**

| Document | Correction |
|---|---|
| `docs/sdd/HUMAN_APPROVAL_GATES.md` | Gate 6 gains the AI-author substitution, the role's obligations and the separation rule |
| `docs/sdd/RISK_TO_PROCESS_MATRIX.md` | The R0–R2 "accepted by" cells point to a note stating the substitution |

No other document was changed and the approval model was not redesigned. The
contradiction is removed by naming the missing actor, not by relaxing any rule:
`AGENTS.md` is untouched and an AI still discharges no gate at any risk level.

**First application.** `SPEC-0003`, accepted the same day by a Qualified Human
Reviewer at `PASS WITH ACCEPTED LIMITATIONS`.

### EVC-018 — Gate 5 implementation readiness names no functional role

Status: **RESOLVED** · Severity: C2 · Release impact: was NON-BLOCKING for
release, **BLOCKING for entry to IMPLEMENTING on any R4 or R5 specification**
Domain: Engineering process · Affected component: gate 5, implementation
readiness

*Filing note: this entry was appended under "Resolved Conflicts" while it was
still `OPEN` — a mistake on 2026-09-08. It is resolved now, so the placement is
correct going forward; the error is recorded rather than quietly corrected.*

Evidence A — Level E4 — `docs/sdd/HUMAN_APPROVAL_GATES.md`, gate 5:
"a *separate* permission to start writing code, additional to gate 1. Required
at R4 and R5." It states that the gate exists, that it is additional, and that
it is human. **It names no role.** Every other gate in that document names
one — gate 1 Product Owner and Solution Architect, gate 2 Solution Architect,
gate 3 Application Security, gate 4 Solution Architect with DevOps and Human
Release Authority, gate 6 Application Security with QA / Release Engineering,
gate 7 the release authority.

Evidence B — Level E4 — `docs/sdd/RISK_TO_PROCESS_MATRIX.md`, row "Separate
implementation-readiness approval": the R4 and R5 cells read **"required,
human"**. No role.

Evidence C — Level E4 — `docs/sdd/SPEC_LIFECYCLE.md`, `APPROVED_FOR_IMPLEMENTATION`:
"The approval record **must name a human role**: at R3 the gate 1
specification approval by a Product Owner or Solution Architect; at R4 and R5
that plus the gate 5 implementation-readiness approval."

**This is the sharp edge.** The lifecycle requires the record to name a role
that no document supplies. An agent cannot write a conforming record without
choosing one, and choosing one is exactly what it must not do.

Evidence D — Level E4 — `docs/sdd/SDD_WORKFLOW.md` R4 row: "human approval
before implementation". `AGENTS.md`: "R4 and R5 additionally require an
implementation-readiness approval (`EVC-015`, decision `D2`)". Neither names a
role.

Material impact: Process — no R4 or R5 specification can legally enter
`IMPLEMENTING`, because the record the lifecycle demands cannot be written
without inventing an actor. First encountered on `SPEC-0005` (RC-4
capture-vault), which is complete at `READY_FOR_APPROVAL` and blocked here.

Current conclusion: a gap in the standard, not a contradiction between two
sources. `EVC-015` resolved *whether* gate 5 applies at R3; it did not say who
holds it at R4 and R5.

Confidence: High.

Required verification: none — this is a policy question, not an evidence
question.

**The one question that closes it:**

> For R4 implementation readiness at gate 5, which human functional role
> exercises the approval?

Candidates visible in the roles table, offered as context and not as a
recommendation: the gate-1 holders acting jointly (Product Owner and Solution
Architect); Solution Architect alone; or DevOps / Production Engineering. The
decision belongs to whoever owns the standard, and this register does not make
it.

**Interim, so work is not silently blocked:** the gate-1 approvers may
designate the gate-5 holder for a specific specification at the moment they
approve it, recorded in that specification's approval entry. That unblocks
`SPEC-0005` without amending the standard, and it is not a substitute for
answering the question.

## Resolution — 2026-09-08

**Gate 5, implementation readiness, is exercised by the SOLUTION ARCHITECT** at
R4 and R5. Supplied as a policy decision by the governance owner.

**Purpose.** The Solution Architect confirms that the approved specification is
technically ready to enter implementation, once the other pre-implementation
gates applicable to the risk level are satisfied. Readiness covers the
implementation plan, architecture, task decomposition, dependencies,
migration and data impact, security prerequisites, rollback approach,
verification strategy, and operational implications.

**What it does not replace:** Product Owner approval; architecture approval
where separately required; Application Security approval; code review;
convergence acceptance; staging approval; production approval. Gate 5 is
additional to all of them, never a substitute.

**An AI agent may not exercise gate 5.** That was already true of every gate
and is restated here because this gate previously had no named holder, which is
exactly the condition under which an agent might have been tempted to infer
one.

**Applied to:** `docs/sdd/HUMAN_APPROVAL_GATES.md`, gate 5 — the role is now
named there. No other gate is altered, no rule is relaxed, and the R4/R5
requirement itself is unchanged.

**First application.** `SPEC-0005` (RC-4 capture-vault), whose gate 5 now has
an identified holder. **That identifies who must decide; it is not a decision,
and `SPEC-0005` remains `READY_FOR_APPROVAL` with zero approvals recorded.**
