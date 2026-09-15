# Release checkpoint — monitoring console on the restructuring release

Branch `integration/monitoring-on-restructure`. Not merged, not deployed, no
production system touched. Every result below was produced on isolated,
disposable systems and is labelled with the SHA it ran against.

**This checkpoint covers the monitoring integration only. It does not establish
that the CRM/HRMS restructuring is complete** — the restructuring's own open items
(its release checkpoint and blocker register) are unchanged by this work.

---

## 1. Candidate identity

| | |
| --- | --- |
| Tested SHA | **`9df91d8c675e12bfdf32999a16b80a834a248d6f`** (clean tree) |
| Artifact | Next.js 16.3.4 standalone bundle, `BUILD_ID` **`k8OFR-ZAJwiupw3T05RZO`**, built in the gate from `git archive` of the SHA and served with `node server.js` |
| Not an identifier | `server.js` sha256 `25f81cc8…c91bcf6` is identical across builds (Next's launcher template) |
| Previous release used for rollback | `d5eef50694b39562ce40fe2068a0c09d993be4df`, `BUILD_ID EXmfBunCKbI-xB6hAzjLy`, built with its own `npm ci` |
| Not built | A container image from `infra/Dockerfile`. No image digest exists for this SHA |
| Documentation commit | The runbook and this file are committed after the tested SHA and change nothing under `apps/web` |

Commits on top of the earlier integration checkpoint (`90cfe95`), oldest first:

| SHA | Change |
| --- | --- |
| `24b0a77` | backup: restore-verify regex and marker-age fixes (incident EVC-005 port) |
| `71c80f4` | infra: reboot-durability recreate step for the two tmpfs services (incident port) |
| `1ea5af1` | test: P2-5 rate-limit test pins the clock (§2) |
| `f821352` | security: AI analyses and call audits behind the sensitive grant |
| `fcf0dc7` | audit: `mode` (monitoring / break-glass) on every staff read |
| `ec19ba9` | test: serialise the two specs sharing `PlatformSetting.uploadMaxMb` (restructure port) |
| `85ec940`, `15d6e65` | backup: `mc` from `quay.io` — Docker Hub no longer serves `minio/mc` |
| `6a82d82` | security: customer document downloads behind the sensitive grant |
| `660bee1` | backup: restore-verify reconciled only the first counted table |
| `ff2da50` | docs: README schema counts |
| `620bd07` | security: an owner may not issue a monitoring grant to themselves |
| `9df91d8` | fix: a live break-glass grant admits its owner (regression from `620bd07`, §5.4) |

Application code changed since `90cfe95`: 14 files, +93 −26.

**No earlier result is carried to this SHA.** Results from `6a82d82`, `620bd07` and
the Windows host are superseded; `9df91d8` changed application code, so every gate
below was re-run on it.

---

## 2. Gate results on `9df91d8`

Environment: `mcr.microsoft.com/playwright:v1.62.0-noble` (Ubuntu 24.04, Node
24.18.0, Python 3.12.3, Linux 6.18 x86_64), `--shm-size=2g`, sharing one network
namespace with disposable containers: Postgres 16 (database `intgate_val`, created
empty — 0 tables before migration), Redis 7 with a password, Mailpit with
STARTTLS required, ClamAV, MinIO. A local CA signs the TLS terminator and the SMTP
leaf; the application trusts it through `NODE_EXTRA_CA_CERTS`, the browser through
its NSS store (only `intgate-local-ca`). Verification is never disabled.

### 2.1 Passed

| Gate | Command / check | Result |
| --- | --- | --- |
| Install | `npm ci` | ok |
| Environment | `node scripts/generate-secrets.mjs .env` (as CI) | ok |
| Migrations | `npx prisma migrate deploy` | 71 applied to an empty database |
| Drift | `prisma migrate diff … --exit-code` | no drift |
| Tenant isolation | `node scripts/check-rls.mjs` | ok |
| Raw SQL scope | `node scripts/check-raw-sql-scope.mjs` | ok |
| Seed | `ALLOW_DEMO_SEED=yes npm run db:seed` | ok |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Lint | `npm run lint` | 0 errors, 131 warnings |
| Format | `npm run format:check` | clean |
| Schema stats | `node scripts/schema-stats.mjs --check` | ok (README updated in `ff2da50`) |
| Observability | `npm run check:observability` | ok |
| Redis auth | `npm run check:redis-auth` | ok |
| Face token gate | `python3 ../face/test_tokens.py` | ok |
| Backup round trip | `scripts/test-backup-roundtrip.sh` | ok |
| Unit / security / tenant suites | `npx vitest run` | **165 files, 2213 passed, 0 skipped, 0 failed** |
| POSIX file-mode assertions | inside the above, `tests/unit/observability.spec.ts` | **20 of 20 executed and passed** (Windows reports 18 + 2 skipped) |
| Server integration | `npm run test:server` with `E2E_DATABASE_URL` / `E2E_REDIS_URL` named | 2 files, 6 passed |
| Release build | `npx next build` | ok |
| Browser suite | `npx playwright test` against the standalone artifact over verified HTTPS, `E2E_PROFILE=local-capture` | **47 passed** (7.0 min), isolation guard verified |
| Production guards | six refusals, §4 | all six refused with the expected message |
| SMTP | `node scripts/rc-mail-check.mjs` | reset mail delivered over STARTTLS with certificate verification; link points at the deployment; no relay |
| Monitoring journey | §5, 88 checks | **88 / 88** |
| Audit trail | §5.5 | 17 / 18 as scripted; the one failure was a wrong check, re-derived in §5.5 |
| Notification recovery | §7 | 9 / 9 |
| Web/worker restart | §7 | health 200 after restart |
| Migration rehearsal | §6.1 | pass |
| Rollback rehearsal | §6.2, one clean cycle | **35 / 35** |
| Backup restoration | §8, Linux | pass |

### 2.2 Failed — application defects, open

| Check | Result | Status |
| --- | --- | --- |
| Creating a record under break-glass (`POST /api/v1/leads` as the owner) | **HTTP 500**, `Lead_ownerId_fkey` | Pre-existing in `main`, the incident RC and the restructuring release: owner and `createdById` default to the actor id, and a platform actor id is not a `User`. Editing works (`PATCH` 200). Not fixed here. §9 blocker 3 |

### 2.3 Failed — harness faults, corrected and re-run (not application results)

Listed so the run record is complete. None is counted as a pass.

| Run step | Cause | Correction |
| --- | --- | --- |
| Previous-release build, full run | its `next build` needs an env file; the new phase omitted the copy | copied; built in the resume pass |
| Journey fixtures, full run | guessed Prisma model name `scorecard` (it is `AuditScorecard`) | fixed; journey re-run |
| Rollback steps, full run | depended on the two items above | stopped deliberately; re-run |
| "Break-glass write not refused" (first resume) | passed on HTTP 500 | replaced by an authorisation discriminator (§5.4) |
| Rollback escalation 3 (first cycle) | `leadersfort` has no Sales entitlement | uses its entitled HR module |
| Roll-forward sign-ins (first cycle) | per-IP sign-in limit (everything arrives from 127.0.0.1) | the harness waits out `Retry-After`; it never clears the limit |
| Audit count and restore (second cycle) | a fixed change id reused across cycles | change id unique per cycle; the runbook now requires it |
| Post-remediation checks (second cycle) | step budget shorter than a rate-limit window | budget raised; clean third cycle |
| Owner sessions, earlier runs | fixture never enrolled the owner's authenticator, giving an enrolment-only session | fixture enrols the owner; any non-full session now aborts the journey at once (§5.1) |
| Raw RSC checks, earlier runs | Next 16 answers bare `RSC: 1` with a 307 to `?_rsc` | the harness follows that one hop only |
| Chromium, run 5 | segfault with Docker's 64 MB `/dev/shm` | `--shm-size=2g`; 47/47 since |

### 2.4 Skipped

None in any suite on Linux.

### 2.5 Not executed

| Item | Why |
| --- | --- |
| `infra/Dockerfile` image build and a run of that image | not built in this environment; the rehearsed artifact is the bundle its production stage copies |
| CI's `Integration (server)` step exactly as written | it names no `E2E_*` variables, so the suite's isolation guard refuses it on every CI run (§9 blocker 5). The gate ran the suite with them named |
| A real host reboot, systemd ordering, recreation of prometheus/alertmanager | needs the production-shaped host; only the script's fail-closed branch was run |
| After a restore: staging pointed at it, sign-in, document download | not rehearsed; the database checks were |
| The previous release's worker during rollback | web only |
| Schema compatibility of the four restructuring tables with `main` / the incident RC | rehearsed only against the restructuring release |
| Anything against production, including `rc-preflight.mjs` | out of scope by instruction |

---

## 3. The rate-limit failure — root cause and fix

`tests/security/p2-regressions.spec.ts` › P2-5 expected 429 and intermittently got
**401**.

**Cause, measured.** The webhook limiter is a fixed 60-second window on
`Date.now()`. The test spends the 600-request budget with 600 sequential Redis
round trips: **2.5 s idle, 22.2 s mid-suite** (timed in a full run). Starting at a
random offset, a 22-second loop crosses a window boundary about a third of the
time; the route's own `consume()` then lands in a fresh window, passes, and falls
through to the connection lookup, which answers 401. That matches 2 failures in 4
full runs and 2 passes in 2 isolated runs.

**Demonstrated before the fix, deterministically.** With `Date` pinned 1 s before a
boundary for the loop and 1 ms after it for the request, the route answered 401
every time; pinned inside one window, 429 every time.

**Ruled out.** Bucket contention (random key per run), fixture authentication (the
route is unauthenticated until the lookup), Redis namespace (nothing else touches
`rl:webhook:*`).

**Fix (`1ea5af1`).** Only `Date` is faked, inside one window; ioredis and its timers
stay real. No assertion weakened, no limit raised.

**A second interference surfaced in the same full-suite conditions:** P2-4 saw
"10 MB" instead of "25 MB" because `platform-admin-crud.spec.ts` writes the global
`PlatformSetting.uploadMaxMb`. Ported the restructuring line's fix (`ec19ba9`): both
files hold one Postgres advisory lock, and the reader asks `getUploadMaxMb()`.

**After:** 2213 passed, 0 failed in the full Linux run on `9df91d8`.

---

## 4. Production-serving configuration

**How the artifact once ran with `EMAIL_PROVIDER=mock`.** The earlier local runs
used `start-local-prod.mjs`, which sets `NODE_ENV=development` for the server
process on purpose (its header explains why); the mock-provider refusal only
applies under `NODE_ENV=production`. Separately, a standalone bundle built beside
a `.env` carries it, and `@next/env` fills unset variables from it at boot —
`.dockerignore` keeps `.env*` out of the image, so the gate deletes it from the
bundle to match.

**Effective configuration of the rehearsed artifact** (sanitised, from the env file
the server was started with):

```
NODE_ENV=production  APP_ENV=staging  PROCESS_ROLE=web  PORT=3320  HOSTNAME=127.0.0.1
APP_URL=https://127.0.0.1:3443  TRUSTED_PROXY_CIDRS=127.0.0.1/32
EMAIL_PROVIDER=smtp  SMTP_HOST=localhost  SMTP_PORT=1025
ANTIVIRUS_PROVIDER=clamav  CLAMAV_HOST=127.0.0.1  WHATSAPP_PROVIDER=meta
DATABASE_URL=postgresql://master_saas_app:***@…/intgate_val        (NOBYPASSRLS)
MIGRATION_DATABASE_URL=postgresql://leadflow:***@…/intgate_val
NODE_EXTRA_CA_CERTS=…/infra/tls-local/ca.pem
```

Command: `cd .next/standalone && node --env-file=<file> server.js`. The guard is
`instrumentation.ts` → `lib/startup-check.ts`, which runs at server start.

**The guards execute — each one refused a deliberately invalid configuration:**

| Change from the accepted configuration | Exit | Message |
| --- | --- | --- |
| `EMAIL_PROVIDER=mock` | 1 | Refusing to start in production with mock providers configured |
| `ANTIVIRUS_PROVIDER=mock` | 1 | as above |
| `TRUSTED_PROXY_CIDRS=none` | 1 | Refusing to start: TRUSTED_PROXY_CIDRS is "none" in production |
| `DATABASE_URL` = the owner role | 1 | DATABASE_URL and MIGRATION_DATABASE_URL are the same connection |
| database named `…_demo` under `APP_ENV=staging` | 1 | APP_ENV is "staging" but DATABASE_URL points at "intgate_val_demo" |
| `APP_ENV` absent | 1 | this is a production build but APP_ENV is not set |

**Accepted configuration:** `/api/health/live` 200 over HTTPS with
`ssl_verify_result=0`; `/login` 200; the development outbox route 404 in production.

**Local-capture is explicit:** the browser suite ran with
`E2E_PROFILE=local-capture`, `E2E_APP_ENV_FILE` naming the artifact's env file, and
its isolation guard confirmed database, Redis and loopback SMTP before running.

**Certificates are verified, not waived:** a real password-reset mail reached
Mailpit over STARTTLS (Mailpit refuses plaintext). Negative control: the same
artifact started without the CA sent nothing (`mailpit total 15 → 15`, error
"unable to verify the first certificate"). The browser trusted only the imported
CA; `E2E_ALLOW_UNTRUSTED_TLS` was not set.

---

## 5. Monitoring security evidence

### 5.1 Sessions

The journey signs in three identities (support, owner, customer administrator) and
**aborts immediately** unless each answer is a full, MFA-satisfied session — the
success body carries `user`, and no `mfaEnrolmentRequired`, `mfaRequired` or
`serviceIdentity`. Password alone: challenge and no cookie. Wrong code: 401 and no
cookie.

### 5.2 Route-level authorisation / audit matrix

Audit writer for every staff read: `recordPlatformAccess`, awaited before the body
is returned; a failed audit write fails the request
(`monitoring-audit-integrity.spec.ts`). Sensitive content is declared on the
route spec and checked after the permission and before the handler, so a refusal
precedes any lookup.

| Surface | Authorisation | Ordinary monitoring grant | + sensitive grant | Positive control |
| --- | --- | --- | --- | --- |
| Leads, follow-ups, calls, activities, tasks, site visits, tickets — kernel `GET` | allowlist × `VIEW` | 200, planted lead in JSON and raw RSC | 200 | — |
| Any other module or action (138 kernel route files) | allowlist | 403 | 403 | `platform-support-access.spec.ts` incl. a module invented after the allowlist |
| Lead create / edit | `leads:CREATE/EDIT` | 403 | 403 | — |
| Non-kernel: lead export, generic export, document upload | `resolveGuardedCtx` | 403 | 403 | — |
| Non-kernel: HR documents, payslips, payroll WPS, HR report export | `resolveGuardedCtx`, HRMS | 403 (module not allowlisted) | 403 | `platform-support-access.spec.ts` (payroll) |
| HR API `/hr/employees`, `/hr/payroll-runs` | kernel | 403, no employee number | **403** — sensitive does not reopen HR | customer admin 200 with employee numbers |
| HR pages (employees, payroll) — HTML and raw RSC | page gate + layout | 200 shell, **none of the 41 employee numbers of either tenant** | same | customer admin RSC carries them |
| Transcript API | `calls:VIEW` + sensitive | 403 | 200, marker | customer admin 200, marker |
| AI analysis API | `calls:VIEW` + sensitive | 403 | 200, marker | customer admin 200, marker |
| AI call audits API | `calls:VIEW` + sensitive | 403 | 200, marker | customer admin 200, marker |
| Recording media stream (bytes) | `calls:VIEW` + sensitive + consent | 403 | 200, marker in bytes | customer admin 200 |
| Customer document download (bytes) | `leads:VIEW` + sensitive | 403 | 200, marker in bytes | customer admin 200 |
| Call detail page — HTML and raw RSC | page gate; analysis and audits loaded only with sensitive | metadata, no conversation content | analysis rendered | customer admin RSC carries analysis |
| Call-audits list page (raw RSC) | `calls:VIEW` | score %, status, reviewed — no audit text | same | — |
| Coaching page (raw RSC) | `calls:VIEW` | no conversation content | same | — |
| Event page with meeting summaries | `events:VIEW` | refused (not allowlisted) | refused | code reading |
| Live-call page with prior-call summaries | `calls:EDIT` | refused | refused | code reading |
| Platform console pages — HTML and raw RSC | platform role | refused, no workspace slug or staff address | refused | owner RSC names the ungranted workspace |
| Monitoring workspace list — HTML and raw RSC | session + MFA | only the granted workspace | same | — |

**Aggregate call metrics are included, and that was not a deliberate design
decision.** Under an ordinary grant `GET /api/v1/coaching` returns per-call
`sentiment`, `talkRatio` and audit `score`, and human coaching notes on a call are
readable. They are consequences of `calls:VIEW`, not choices anyone made. They
carry no transcript or summary text, but sentiment is a judgement derived from the
conversation. **Needs a product decision** (§9 blocker 2).

### 5.3 Grant authority and self-grant refusal — through the real route

| Attempt | Result |
| --- | --- |
| Owner → self: workspace READ / workspace sensitive / coverage / sensitive coverage | 403 × 4 |
| Support → self; support → another identity | 403, 403 |
| Customer administrator → workspace grant; → coverage | 403, 403 |
| Modify an existing grant (`PUT`, `PATCH`) | 405, 405 — no modify path exists |
| Owner issues coverage to the auditor, revokes it, re-issues it to self | 201, 200, **403** |
| Owner holding break-glass issues a sensitive monitoring grant to self | **403** |
| In the tables and audit trail afterwards | no coverage row for the owner; every `MONITORING_ACCESS_GRANTED` naming the owner was issued by a second owner; **self-issued monitoring grants ever: 0** |

### 5.4 Elevation is explicit and distinguishable

Break-glass (`WRITE`) is the one self-issued elevation: owner-only, reason-bound,
time-boxed. Every staff read records `mode`: all 39 support reads `monitoring`;
the owner's reads under break-glass `break-glass`.

Write authority is tested without side effects, because the kernel authorises
before it validates: read-only support `POST /api/v1/leads {}` → **403**; owner
under break-glass, same request → **422**. A real repair edit succeeds (`PATCH`
200). Creation fails with 500 (§2.2). Handing break-glass back refuses the owner on
the next request.

`620bd07` (self-grant refusal) had removed a sole owner's only way into a workspace,
so break-glass opened but entering answered 404. A route-level test reproduced it;
`9df91d8` lets a live break-glass grant admit its holder.

### 5.5 Audit trail

No lead name, transcript, analysis, audit text, coaching note, document or
recording bytes, employee number, password or TOTP secret in 61 audit payloads.
Support read metadata is exactly `action, method, mode, path, roleKey, status`.
Refusals are recorded (14). Page views are recorded. Sensitive reads were recorded
while the grant was live. Grant, revocation, coverage and break-glass events carry
the owner as actor. No staff read was written against the ungranted workspace.

The scripted check "no READ grant row for the owner" failed with 1: that row was
issued to the owner by a **second** owner during the rollback rehearsal, which is
legitimate, and the grant table records no issuer. Re-derived from the audit trail
(the failing check is kept in the record as failed).

### 5.6 BUG-008 on the final artifact

Refused pages were fetched as HTML and as the raw RSC flight payload (following
only Next's `?_rsc` hop), and every body was scanned for all employee numbers of
both tenants, the workspace slug, staff addresses and conversation markers. None
appeared; each scan has a positive control showing the same response shape carries
the data to an identity entitled to it. **This is evidence for the designated
security reviewer; it is not independent AppSec sign-off.**

---

## 6. Migrations and rollback

### 6.1 Migration and grant-data compatibility

Fresh disposable database; the 69 migrations of the restructuring release applied;
a live pre-upgrade grant planted; the two monitoring migrations applied. Pre-upgrade
grant became `WRITE, sensitive` (it was break-glass). New rows default to `READ`,
non-sensitive. Row count unchanged (1 → 1). Coverage rows: 0. Down path (drop the
table, two columns and the enum) retained every grant row.

### 6.2 Rollback rehearsal — one clean cycle, 35 / 35

Every release the candidate could roll back to has the same staff code (§runbook
9.1). Against `d5eef50`:

| Stage | Result |
| --- | --- |
| Candidate, during the deployment window | a second owner grants the owner READ; the owner grants the auditor coverage; support enters a workspace. On the candidate that support session is refused HR (403) |
| Freeze | web stopped: grant route unreachable (terminator 502, upstream refused) |
| **Old release, unremediated** | **the candidate-era support session reads HR (40 employee numbers)**; control: that session is refused write (403); **the owner's READ grant is write authority (422) and a real edit succeeds (200)**; **the owner enters a workspace nobody granted and reads its HR**; coverage is ignored (auditor refused at the owner-only route) |
| Identify | 2 live grants (both issued in the window), 1 coverage, 7 staff sessions (2 inside a workspace), 10 active staff identities |
| Remediate, one transaction | 2/2 grants, 1/1 coverage, 7/7 sessions revoked; 10/10 identities suspended; 11 audit rows for this change; no customer or service identity touched |
| **Old release, remediated** | candidate-era sessions: HR 401, workspace read 401, write 401; owner, second owner, support, auditor cannot sign in; customer administrator signs in, reads leads and HR |
| Roll forward | exactly the 10 suspended identities restored; owner signs in; support signs in and sees no workspace until re-granted (enter 404) |

### 6.3 Remediation and restore statements, as rehearsed

Run as the owner role, web and workers stopped. `$grants`, `$coverage`, `$sessions`
and `$identities` are the id lists from the identification queries (runbook
§9.1.1 step 3); `<CHG>` is the unique change id.

```sql
BEGIN;
UPDATE "PlatformAccessGrant"   SET "revokedAt" = now()
 WHERE id = ANY($grants) AND "revokedAt" IS NULL RETURNING id;
UPDATE "PlatformCoverageGrant" SET "revokedAt" = now(), "revokedReason" = '<CHG>: rollback to a release without grant enforcement'
 WHERE id = ANY($coverage) AND "revokedAt" IS NULL RETURNING id;
UPDATE "PlatformSession"       SET "revokedAt" = now(), "revokedReason" = '<CHG>: rollback'
 WHERE id = ANY($sessions) AND "revokedAt" IS NULL RETURNING id;
UPDATE "PlatformUser"          SET status = 'SUSPENDED'
 WHERE id = ANY($identities) AND status = 'ACTIVE' RETURNING id, "platformRole";
-- one per suspended identity:
INSERT INTO "PlatformAuditEvent" (id, "actorUserId", event, "objectType", "objectId", metadata, "occurredAt")
VALUES ('rb_' || md5(random()::text), NULL, 'ROLLBACK_STAFF_ACCESS_SUSPENDED', 'platform_user', <id>,
        '{"change":"<CHG>","priorStatus":"ACTIVE","role":"<role>"}', now());
-- one summary row listing every revoked and suspended id:
INSERT INTO "PlatformAuditEvent" (id, "actorUserId", event, "objectType", metadata, "occurredAt")
VALUES ('rb_' || md5(random()::text), NULL, 'ROLLBACK_ACCESS_REMEDIATION', 'platform',
        '{"change":"<CHG>","revokedGrants":[…],"revokedCoverage":[…],"revokedSessions":[…],"suspendedIdentities":[…]}', now());
-- every RETURNING count must equal its identification count; otherwise ROLLBACK and re-identify
COMMIT;
```

Restore after roll-forward:

```sql
BEGIN;
UPDATE "PlatformUser" SET status = 'ACTIVE'
 WHERE status = 'SUSPENDED'
   AND id IN (SELECT "objectId" FROM "PlatformAuditEvent"
               WHERE event = 'ROLLBACK_STAFF_ACCESS_SUSPENDED' AND metadata->>'change' = '<CHG>')
RETURNING id;
INSERT INTO "PlatformAuditEvent" (id, "actorUserId", event, "objectType", metadata, "occurredAt")
VALUES ('rb_' || md5(random()::text), NULL, 'ROLLBACK_STAFF_ACCESS_RESTORED', 'platform', '{"change":"<CHG>","restored":[…]}', now());
COMMIT;
```

**Conclusion: the previous releases are unsuitable for normal rollback.** Revoking
grants does not close the first and third escalations. The rehearsed safe
alternative is roll-forward, or — only when that is impossible — rollback with all
staff workspace access suspended (runbook §9.1.1–9.1.2), which removes platform
administration until roll-forward.

---

## 7. Notification recovery

Fresh recipients per run; each event key written into the notice title.

| Case | Result |
| --- | --- |
| E1 enqueued twice (one logical event) | one outbox row |
| E2 left claimed by a crashed worker, lease expired | reclaimed (attempts 2) |
| Two legitimate events E1, E2 | 2 notifications — E1 × 1, E2 × 1 |
| Replayed E1 | delivered once |
| A further lease period later | still 2 |
| E3 enqueued with web and worker stopped | delivered once after restart |
| Health | 502 while stopped (terminator up, upstream refused), 200 after restart |

---

## 8. Backup and restoration

On Linux, `backup.sh` took an encrypted backup (dump and objects), shipped it to an
off-host file remote and verified the copy. With the fixed `restore-verify.sh`, from
the off-host copy (host-gone form) and from the local copy: dump restored without
errors, ledger 71/71, Tenant, PlatformUser, Lead, Recording and AuditLog
reconciled, object count matched. Restored for real into a new database: 0
`pg_restore` errors, 0 unfinished migrations, 184 tables with RLS forced, 0 not
forced — and **0 table privileges for the application role**. After the three grant
statements (runbook §9.2), the application role pinned to one tenant saw its 40
employee profiles and none of the other tenant's.

Defects found and fixed: `minio/mc` no longer pullable (`85ec940`); only the first
counted table reconciled (`660bee1`). Found, not fixed: the host-gone form prints a
marker-write error, so `backup-status.sh` does not count it (the scheduled unit is
unaffected).

---

## 9. Remaining blockers

1. **Rollback.** Normal application rollback cannot hold the staff boundary. The
   release owner must accept roll-forward-first and approve the emergency procedure
   (runbook §9.1.1) — including platform administration being unavailable during
   it — before release.
2. **Monitoring scope decision.** Aggregate call metrics (sentiment, talk ratio,
   audit score) and human coaching notes are visible under an ordinary grant by
   consequence, not design (§5.2).
3. **Break-glass cannot create records** (500, pre-existing in all releases). Edits
   work. Decide whether break-glass must create before release.
4. **Independent security review** of BUG-008 and the monitoring boundary is still
   outstanding. Evidence is provided; sign-off is not claimed.
5. **CI's server integration step fails as written** (no `E2E_*` variables). Not
   changed here.
6. **No container image** has been built or run for this SHA; its identity must be
   established by building `infra/Dockerfile` from this commit.
7. **Unrehearsed operations:** a real reboot with the recreate unit; staging
   pointed at a restored database; schema compatibility of the restructuring
   tables with `main` / the incident RC; which release production actually runs.

---

## 10. Recommendation

For the tested scope — the monitoring console integrated on the restructuring
release, as the standalone artifact at `9df91d8` — **GO to staging and to the
designated security reviewer. NO-GO for production** until blockers 1, 2, 4 and 6
are resolved, and 3 and 7 are decided.

---

## 11. Development cleanup — isolated rehearsal systems only

None of these is production. Remove when the reviewer no longer needs them:

- Containers `intgate-09121648-{pod,pg,redis,mailpit,minio,clamav,minio-helper}` and
  the runner containers `…-final`, `…-resume`, `…-resume2`, `…-resume3`, plus images
  `intgate-snap:*`, `intgate-final-snap:*`.
- Databases inside that Postgres: `intgate_val`.
- Host Postgres databases from the earlier checkpoint:
  `rehearsal_integration_20260911T104742Z`, `integration_test_20260911T104936Z`,
  `integration_app_20260911T113719Z`, `integration_09111219_e2e`.
- Local TLS material in `apps/web/infra/tls-local/` (gitignored).

Production recovery is in the runbook (§9), not here.
