# Release checkpoint — dual credentials and employee-record scope on the workspace restructure

Branch `integration/dual-credential-on-workspace-restructure`. Not merged, not
deployed, no production system touched, no production identity provisioned. Every
result below was produced on isolated, disposable systems and names the SHA and
build it ran against.

---

## 1. Identity

| | |
| --- | --- |
| Integrated merge (built and validated) | `ae7ce2a28677a28ac054f745e50e8c7d84f1f9a6` |
| Base | `dev/workspace-restructure` at `7cf58286ff9a799cad823e09b59214187d56f200` (pushed) |
| Employee-scope fix | `2ac9407eaa27328b4a4810435dfb39fb60f9cb34` (on `fix/employee-directory-scope`, ancestor of the merge) |
| Dual-credential line | `2169f934a1ac0247aa6c06193a9d995721a5088b` (with `03823b8`, `1d174dc`, and the monitoring integration `05a7b90` / `9df91d8`) — ancestors of the merge, merged, not re-implemented |
| After the merge | `3115629`, `90ba731` (browser acceptance specs), and this document's commit — tests and documentation only; `git diff ae7ce2a..HEAD -- apps/web/src apps/web/prisma apps/web/scripts` is empty |
| Artifact | Next.js 16.3.4 standalone, **BUILD_ID `4Xuwl2_yyLe4ElhpN7Izy`**, `server.js` sha256 `25f81cc8a890f52264302fef243af4ed06865860d2cb2725fc493aa52c91bcf6`, built in the gate from `git archive` of `ae7ce2a`, served with `node server.js` behind a verified TLS terminator |
| Previous release for rehearsal | `7cf5828`, built the same way, BUILD_ID `bykaE6ZwA_N6uCcNagPNy` |
| Not built | A container image from `infra/Dockerfile` |
| Unpushed work elsewhere, not included | `a4a5d45`, `0dd9a83`, `bdc9466` on another session's local `dev/workspace-restructure` (Workspace Summary visual sample) |

Merge conflicts and their resolution are in the merge commit message: navigation
kept the restructure's work-area model and gained the monitoring line's
`platformStaff` flag (People hidden for platform staff); the workspace banner is
read-only unless break-glass is live; `nav-permissions.spec.ts` was ported; README
counts regenerated; the runbook carries both migration lists.

---

## 2. Gate outcomes

Environment: `mcr.microsoft.com/playwright:v1.62.0-noble` (Ubuntu 24.04, Node
24.18.0), disposable pod `dualgate-0914-*` (Postgres 16 created empty, Redis with a
password, Mailpit requiring STARTTLS, ClamAV, MinIO), local CA, verification never
disabled. Runs: main gate (runner `dualint-0915-runner`), follow-up on a snapshot of
the same builds (`dualint-0915-followup`), and one browser re-run
(`dualint-0915-dualspec`).

### 2.1 Passed

| Gate | Result |
| --- | --- |
| `npm ci`, `generate-secrets` | ok |
| `prisma migrate deploy` on an empty database | 76 applied |
| Drift | none |
| `check-rls` | 187 tenant tables forced and policied, 7 exempt |
| `check-raw-sql-scope`, seed | ok |
| `tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 132 warnings |
| `format:check`, `schema-stats --check` | ok |
| Observability, Redis auth, face token gate, backup round trip | ok |
| `npx vitest run` | **172 files, 2592 passed, 0 skipped, 0 failed** (includes `tests/hr/employee-record-scope.spec.ts` 17, `tests/security/dual-credential-auth.spec.ts` 37, ported `tests/unit/nav-permissions.spec.ts`) |
| `npm run test:server` | 2 files, 6 passed |
| `next build` | ok |
| Production guards | 6 of 6 refused (mock email, mock antivirus, proxy `none`, owner role as app role, demo DB under staging, no `APP_ENV`) |
| Accepted configuration | `/api/health/live` 200 over HTTPS, `ssl_verify_result=0`; `/login` 200; dev outbox 404 |
| SMTP | reset mail over STARTTLS with verification; no relay; without the CA nothing sent (Mailpit 8 → 8) |
| Browser suite, full, on the artifact | **80 passed, 1 failed** (§2.2) |
| Dual-password browser acceptance, on the artifact | **6 / 6** (§3) |
| Employee-scope browser acceptance, on the artifact | **4 / 4** (§4) |
| Upgrade and rollback rehearsal, main gate | **52 / 52** |
| Upgrade and rollback rehearsal, extended (broader reads on `7cf5828`) | **60 / 60** (§6) |
| Previous release build (`7cf5828`) | npm ci and build ok |
| Clean-install path (bootstrap owner → MFA → plan → workspace) | 9 of 11 checks pass; the 2 failures are §5 |

### 2.2 Failed — application or test defects, open

| Check | Result | Disposition |
| --- | --- | --- |
| `tests/e2e/request-budget.spec.ts` — "each navigation is soft, duplicate-free and under budget" | Times out waiting for a sidebar link to `/people/employees` | **Pre-existing on the base.** The work-area sidebar (`df75a54`) links each area to its first tab (`/people`); the spec was last changed before that. The same spec fails identically on the `7cf5828` build (follow-up `e2e.prev-request-budget`). Not caused by this integration; not fixed here — the spec belongs to the restructure line. The budget itself is therefore unmeasured on both builds. |
| Permission catalogue on a clean install | 9 of 41 navigation permissions and `tickets:VIEW` of the monitoring allowlist have no row | **Pre-existing, blocker for any fresh install.** §5. |

### 2.3 Failed — harness faults, corrected and re-run

| Run | Fault | Correction |
| --- | --- | --- |
| Follow-up, `dual-credential-login.spec.ts` | The spec's setup inserted grants for two workspaces in one `createMany`; row-level security pins one workspace per statement and refused it, so no case ran | One insert per grant (`90ba731`); re-run on the same artifact: 6 / 6 |
| Local Windows runs (not gate results) | 6 collections evidence tests (local MinIO key), POSIX file modes, a parallel permission-fixture race, and an unseeded local database (missing `activities`/`tickets` rows) | All pass in the Linux gate, which uses its own storage and seeds before testing |

### 2.4 Skipped

None in any gate run.

### 2.5 Not executed

- A container image build (`infra/Dockerfile`) and a run of it.
- GitHub Actions CI on these SHAs: `ci.yml` runs on pushes to `main` and on pull
  requests only; no pull request was opened.
- Anything against staging or production.

---

## 3. Dual-password evidence on the final artifact (browser, real login + MFA)

`tests/e2e/dual-credential-login.spec.ts`, BUILD_ID `4Xuwl2_yyLe4ElhpN7Izy`, 6 / 6.
One synthetic email: an **OWNER** holding a READ monitoring grant on workspace W, a
live **sensitive break-glass WRITE grant on the same W**, and a WRITE-only grant on
workspace X. Passwords and the TOTP secret are random per run.

| Case | Observed |
| --- | --- |
| Wrong authenticator code after password A | stays on `/login`, no session cookie |
| Password A + MFA | console; sets the monitoring password through *Sign-in and passwords* (re-authentication with A and a code) |
| Password A: authorised workspace creation | `POST /api/v1/platform/workspaces` **201**; the workspace exists |
| Password A under break-glass (positive control) | enters W 200; transcript **200**; lead export **200** |
| B equal to A | refused |
| Password B + MFA | lands on `/monitoring`, "read-only monitoring session"; W listed, X not |
| B: console URLs `/platform`, `/platform/security`, `/platform/users` | redirected to `/no-platform-access` |
| B: admin APIs | workspace list 403, creation 403, break-glass 403, **issue grant 403, revoke grant 403**, credentials 403; no grant was written |
| B: WRITE-only workspace X | enter **404** |
| B inside W, despite OWNER + sensitive WRITE on W | leads read 200; **write 403, export 403, transcript 403** (body carries no transcript text); banner "Platform support view … Read-only" |
| Two contexts (A and B) and a second B tab | each keeps its own mode |

The API-level suite (`tests/security/dual-credential-auth.spec.ts`, 37, in the gate's
vitest) additionally covers HR refusal, sensitive READ grants, grant expiry and
revocation mid-session, audit failure, combined rate limiting, credential change,
reset and revocation with stale challenges, MFA reset, disablement, refresh, legacy
sessions and customer sign-in.

---

## 4. Employee-record scope

### 4.1 The defect and the fix (`2ac9407`)

An OWN-scope `employee:VIEW` role saw every employee on `/people/employees` (name,
work email, number, designation, role); `/people/lifecycle` and the HR API's
`lifecycle` and `expiring-documents` resources named every joiner and leaver and
listed every employee's expiring passport / Emirates ID documents **with numbers**;
the lifecycle page opened any employee's checklist from `?employee=`. One rule now
serves all of them, `employeeRecordScope` — every record with `employee:VIEW` at
ORGANIZATION scope, otherwise the viewer's own (nothing without an employee record)
— the rule the API's `employees` resource already had. Document numbers only with
`hr_documents:VIEW_SENSITIVE_FIELDS` or on the viewer's own documents. The checklist
opens for the viewer's own record, an approver or HR, as the API did.

### 4.2 Acceptance

| Surface | OWN employee | HR (ORGANIZATION, no identity-document permission) | HR with identity-document permission | TEAM manager (leave approver) | No employee permission |
| --- | --- | --- | --- | --- | --- |
| Directory page and `hr/employees` | own row only | everyone | everyone | own row only | page refused, API 403 |
| Lifecycle dashboard (page, API) | own journey, own counts | everyone | everyone (same rule; not separately exercised) | own record (same rule; directory exercised) | page refused, API 403 |
| Expiring documents | own document **with** number; another employee's id → empty | everyone's, **numbers null** | everyone's **with** numbers | own | API 403 |
| Checklist `?employee=` | own only | anyone | anyone | a report's (approver) | refused |
| Leave routed to them | — | — | — | **visible** (approval workflow preserved) | — |

Evidence: vitest `tests/hr/employee-record-scope.spec.ts` (17, API and page server
components with populated data; against the unfixed code 11 fail and the 6 positive
controls pass) and browser `tests/e2e/employee-record-scope.spec.ts` (4 / 4 on the
artifact, signing in through the form).

### 4.3 TEAM scope — intended behaviour

TEAM-scoped viewers stay at their own record on the directory, lifecycle and
expiring-document lists. That is the rule the API already enforced; the pages were
the exception, and before the fix a TEAM viewer saw the entire workspace, not their
team. Manager workflows do not depend on these lists: leave approvals use
`leaveScope` (their own requests plus those routed to them), attendance approvals
use `attendanceScope`, and checklists use the approver rule — all unchanged and
verified above. **Owner decision:** whether TEAM viewers should see *their reports*
on the directory. That needs team resolution (as the HR dashboard's
`scopedEmployeeWhere` does) and is new behaviour, not part of this fix.

Deliberate behaviour change: an HR administrator without the identity-document
permission still sees whose documents expire, but no longer the numbers.

---

## 5. Permission catalogue — why the local failures happened, and the install path

**Why:** `buildSupportActor` builds a monitoring actor from the `Permission` rows
that exist. The local integration database had been migrated but not seeded: 172
rows, no `activities:VIEW` or `tickets:VIEW`. `platform-support-access.spec.ts`
asserts the exact six-module monitoring set and failed on those two; after seeding
(410 rows) 23 / 23 passed. The Linux gate seeds before vitest, so it never saw this.

**Supported install path, verified on the artifact** (follow-up
`catalogue.install`, clean database, no seed): migrations create 114 permission
rows and no plan; `bootstrap-owner.mjs` creates the owner; first sign-in routes to
MFA enrolment; enrolment completes; the owner creates a plan (201) and a workspace
(201); 252 rows afterwards. **Missing:** `automation`, `communications`,
`documents`, `fieldsales`, `forms`, `landingpages`, `products`, `smartviews`,
`tickets` (VIEW) — 9 of the 41 permissions the navigation names, including
`tickets:VIEW` from the monitoring allowlist. `activities:VIEW` is present once a
workspace is created. Only the demo seed creates the rest, and the seed refuses
production and staging.

**Consequence:** on a fresh install those screens can be granted to nobody, and
monitoring cannot read tickets (it fails closed). Existing databases that were
seeded historically are unaffected — the runbook's §3.1b query checks a target.
The provisioning code and migrations are unchanged from `7cf5828`: **pre-existing,
not introduced here.** A reviewed catalogue migration is required before any fresh
install; it is not part of this candidate.

---

## 6. Recovery — rehearsal against `7cf5828`

Dedicated database migrated and seeded **by `7cf5828`**, with synthetic identities
(an OWNER with a pre-existing break-glass grant, SUPPORT, a customer member, an
AI_SERVICE session, reset links, an HR workspace with an employee and **no** staff
grant). Both builds as artifacts. Main gate 52 / 52; extended follow-up 60 / 60.

| Phase | Outcome |
| --- | --- |
| `7cf5828` sign-ins | owner, support, customer sign in; owner API 200 |
| Integrated migration on that data | monitoring migrations and #11 applied, no drift; owner and support sessions revoked (`CREDENTIAL_PURPOSE_MIGRATION`); customer and AI_SERVICE sessions untouched; the pre-existing grant became WRITE / sensitive; no monitoring credential, grant or coverage created; staff reset link retired, customer's kept |
| Integrated release | old staff cookies 401, customer cookie 200; A: challenge then PLATFORM_ADMIN; B set with re-authentication; B: owner API, creation, break-glass 403, WRITE-only 404, READ 200, write 403; refresh keeps MONITORING |
| **Image swap to `7cf5828`, no remediation** | the live monitoring session is the owner (**200**, sees ungranted workspaces); enters the break-glass-only workspace (**200**) and a workspace with **no grant** (**200**); receives that workspace's **HR employee records** (**200**, employee name returned); an administration session also enters the ungranted workspace (**200**); password B signs in nowhere (401) |
| Remediation, web stopped | live MONITORING sessions revoked (1); none remain |
| `7cf5828` after remediation | monitoring session 401; owner signs in with A |
| Roll-forward | session issued by `7cf5828` 401 and revoked as legacy; revoked monitoring session stays refused; B → MONITORING, A → PLATFORM_ADMIN; monitoring and administration sessions refused the ungranted workspace (404) and the break-glass-only one for monitoring (404); no HR records returned; no ambiguity events |

**Required for any rollback:** runbook §9.1.1 (freeze, backup, identify, revoke
staff sessions and grants, suspend staff, then the image) **plus** revocation of
every MONITORING session and deletion of unfinished MFA challenges while the web
tier is stopped (§9.1.4). Keep the monitoring hashes for roll-forward.
**Unsuitable as image-swap targets:** `7cf5828`, `05a7b90`, `9df91d8`, the
restructuring release, the incident RC and `main`. Roll-forward needs no session
data step; staff sign in again with MFA.

---

## 7. Dual-password blockers — current status (not assumed resolved)

| Item | Status |
| --- | --- |
| MFA replay | **Open.** A TOTP code is accepted again within its window (e.g. for re-authentication right after sign-in); bounded by the confirmation rate limit (10 per 5 minutes). No last-used time step is recorded. Decision and change required. |
| CI configuration | **Workflow fixed, not executed.** `cb0172d` (in the base) names `E2E_DATABASE_URL`/`E2E_REDIS_URL` for the server step. No CI run exists for these SHAs: CI runs on pushes to `main` and on pull requests; none was opened. |
| Deployable image | **Not built.** `build-images.yml` is manual (`workflow_dispatch` with a SHA); no image or digest exists for `ae7ce2a`. |
| Independent security review | **Outstanding.** Evidence provided; no sign-off claimed. |
| Monitoring-scope decision | **Open, unchanged.** Aggregate call metrics and human coaching notes remain visible under an ordinary monitoring grant by consequence rather than design (integration checkpoint §5.2). |
| Rollback compatibility | **Schema-compatible, access-unsafe.** Every earlier release boots on the migrated schema and escalates a live monitoring session (§6). Rollback only through §9.1.1 + §9.1.4. |
| Permission catalogue | **Blocker for fresh installs** (§5). |
| `request-budget` browser spec | **Broken on the base**, unmeasured on both builds (§2.2). |

---

## 8. Designated identity

`younusalikhans78692@gmail.com` was looked up (flags only — role, status, MFA
enabled, monitoring password set) in all 23 local databases, including the port-3100
preview database `master_suite_val`: **not present in any of them.** Production
was **not** inspected. Nothing created or promoted it, and nothing in code or
configuration names it.

**Production (reported, not verified here):** the account owner states the identity
exists in the production environment. This checkpoint has no production access and
has not confirmed it, nor its role, status or MFA state. Two consequences once this
release is deployed there:

- If its `platformRole` is OWNER, SUPPORT or SECURITY_AUDITOR, migration #11 signs
  its current sessions out; it signs in again with its existing (administration)
  password and MFA. Nothing else about the account changes, and no monitoring
  password exists until the person sets one (step 3 below).
- If its `platformRole` is `USER` (a customer account), **stop at step 1**: a
  monitoring password cannot be set on it, and promotion to platform staff is a
  separate owner decision, never automatic.

**Provisioning after acceptance** (runbook §3.2), under its own change ticket, with
no password or MFA secret in chat, tickets, email, scripts or configuration:

1. On the target, read the identity by normalised email (owner role, flags only). No
   row: stop — creating a platform identity is a separate decision (the first owner
   only via `bootstrap-owner.mjs`). A `USER` (customer) row: stop — nothing promotes
   it automatically; promotion is an owner decision in its own ticket.
2. The person signs in with their **administration** password and enrols MFA if not
   already enrolled.
3. The person sets their own **monitoring** password at *Platform → Sign-in and
   passwords*: administration password + current code, different from the
   administration password. Audit `MONITORING_CREDENTIAL_SET`, no secret recorded.
4. A **second** owner issues READ grants for the workspaces to be monitored
   (`POST /api/v1/platform/monitoring/grants`; self-grants are refused).
5. Verify: monitoring password → `/monitoring`, banner read-only; `/platform` →
   no platform access.
6. Revocation without touching the administration password: the person, or another
   owner with their own code.

---

## 9. Recommendation

- **Security review: ready.** The integrated artifact at `ae7ce2a` passed every gate
  except the pre-existing `request-budget` spec; dual-password and employee-scope
  behaviour are verified through the real sign-in and MFA on that artifact, with
  positive controls; upgrade and rollback are rehearsed against `7cf5828`.
- **Staging deployment: not yet.** Requires a built image for the exact SHA, a CI
  run (pull request), and a decision on the permission catalogue — a staging
  database created fresh would lack nine grantable permissions.
- **Production: NO-GO** until the catalogue migration exists and is verified, MFA
  replay is decided, the independent security review signs off, the monitoring-scope
  decision is made, the `request-budget` spec is repaired and its budget measured,
  and the release owner accepts that rollback means §9.1.1 + §9.1.4.

---

## 10. Development cleanup — isolated systems only

- Containers `dualgate-0914-{pod,pg,redis,mailpit,minio,clamav}`, runners
  `dualgate-0914-{runner,rehearse}`, `dualint-0915-{runner,followup,dualspec}`;
  volume `dualgate-0914-gate` (outputs `out`, `out-0914`); images `dualgate-snap:1`,
  `dualint-snap:1`.
- Databases inside that Postgres: `dualgate_val`, `dualgate_upgrade`,
  `catalogue_install`.
- Host Postgres (local tests): `empscope_20260915_test`, `dualint_20260915_test`
  (seeded), `dualint_upgrade_20260915_test`, `catalogue_20260915_test`,
  `dualcred_20260914_test`. `apps/web/.env.test` in this worktree points back at
  `master_saas_test`.
- All synthetic browser-test workspaces and accounts were removed by the suite's
  teardown; rehearsal credential state files were deleted.
