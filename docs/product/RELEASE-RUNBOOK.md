# Deployment runbook — YOUHAN ONE / Master Suite

> **Superseded for audit and restore commands (14 September 2026):** use `OPERATOR-CHECKLIST.md`. It runs the audits in the `migrate` service with read-only, role-checked connections and uses the guarded restore script, all verified locally against the baseline.

One document, executed top to bottom by the production operator. Every command
is meant to be run as written. Nothing in here has been run against production
by the author of this document.

> **This runbook does not authorise a deployment.** It is the procedure to
> follow once the client owner has approved the release assessment
> ([`RELEASE-ASSESSMENT.md`](RELEASE-ASSESSMENT.md)). Read §0 and §9 before
> starting anything.

---

## 0. Identity of this release

|                           |                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release SHA               | `3dc115aca09a50c4e35ed965c0f57d3bee3d56f1` (candidate of 12 Sep 2026 evening, with agency-fee receipts; supersedes `bbfb8ae`)                                                                                                                                                                     |
| Branch                    | `claude/restructure-foundation`                                                                                                                                                                                                                                                                   |
| Web image                 | `master-suite/web:3dc115a` — digest `sha256:b83b4c57a38bd63bba7fe06c578101abd10e36e3a9e9dae586102d05ab2b56f8`                                                                                                                                                                                     |
| Worker image              | `master-suite/worker:3dc115a` — digest `sha256:c294ead85517498cec92e2ac1bf2f72702abbb7f175444d998ea26871c51d216`                                                                                                                                                                                  |
| Migrations added          | 8 — see §3                                                                                                                                                                                                                                                                                        |
| Previous deployed version | **Confirm before starting.** `scripts/release.sh status` on the VM reports what is running and what can be rolled back to. This runbook assumes the deployed version is at or after `main` (`f16ed67`); if it is older, stop and re-inventory — there will be more than four migrations to apply. |

> **Integration candidate addendum — `integration/monitoring-on-restructure`.**
> The restructuring release above plus the platform monitoring console. Candidate
> `9df91d8c675e12bfdf32999a16b80a834a248d6f`. It adds **six** migrations to a
> database at `main` or the incident RC (both at 65), or **two** to one already at
> the restructuring release (§3). It changes what rollback means for platform staff
> access (§9.1), and it depends on the backup and reboot fixes in §9.2–§9.4.
> Evidence for every step marked **VERIFIED** is in
> `docs/product/RELEASE-CHECKPOINT-MONITORING-INTEGRATION.md`. **VERIFIED** means
> rehearsed on isolated, disposable systems — never against production.
> **PROPOSED** means written from the code and not rehearsed.
> No image for this candidate has been built with `infra/Dockerfile`; the rehearsed
> artifact is the standalone bundle `next build` produces, served with
> `node server.js`, which is what the Dockerfile's production stage copies.

> **Dual-credential addendum — `feat/dual-credential-monitoring-login`.**
> The integration candidate plus one platform identity with two passwords: the
> administration password opens what the role allows, the monitoring password opens
> read-only monitoring only. Candidate
> `03823b8d487cb916b831d3cc9053b477e7f58c96`, on top of `05a7b90`. It adds
> **one** migration (§3.1a, #11) that **signs out every platform staff member** and
> retires their unused reset links, and it changes rollback again (§9.1.4). Evidence:
> `docs/product/RELEASE-CHECKPOINT-DUAL-CREDENTIAL.md`. Provisioning the designated
> identity is a separate, authorised step after release (§3.2) — nothing in this
> release creates a monitoring password or a grant.

> **Integrated candidate — `integration/dual-credential-on-workspace-restructure`.**
> The workspace restructure (`dev/workspace-restructure`, `7cf5828`) plus the
> employee-record scope fix (`2ac9407`) plus everything above, merged at
> `ae7ce2a28677a28ac054f745e50e8c7d84f1f9a6`. The validated artifact was built from
> that commit; later commits on the branch change tests and documentation only.
> **76 migrations** on a fresh database; a database at the restructure candidate
> (73) receives the monitoring migrations and #11. Evidence:
> `docs/product/RELEASE-CHECKPOINT-DUAL-CREDENTIAL-INTEGRATION.md`. That candidate
> was assessed **NO-GO** and must not be deployed.
>
> **Release closeout — the same branch, later commits.** Adds two migrations —
> #12 MFA replay guard (§3.1c) and #13 permission catalogue definitions (§3.1b) —
> withholds conversation content from ordinary monitoring grants (§3.1d), and
> replaces the rollback assessment (§9.1). **78 migrations** on a fresh database.
> The exact commit, image digests, CI run and gate results are in the closeout
> review package attached to the review pull request; the SHA to deploy is the one
> recorded there and nowhere else. It is not approved until the security review
> named there has signed off.

Both images carry the commit as `BUILD_COMMIT` and surface it as
`masterapp_build_info` on the metrics endpoint. Confirm after deploying:

```bash
docker exec <web-container> sh -lc 'echo $BUILD_COMMIT'
```

It must print the SHA above — verified in this environment, where the running
container reported exactly that value. `unknown` means the image was built without
`--build-arg GIT_SHA` and its provenance cannot be established — do not deploy it.

---

## 1. Environment prerequisites

No secret values appear here. Each row is a name and what it must be true of.

| Variable                                  | Requirement                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                            | The **application** role. Must be `NOBYPASSRLS`.                                                                                                                                                                               |
| `MIGRATION_DATABASE_URL`                  | The **owning** role. Different database user from the line above — startup refuses if the two URLs match.                                                                                                                      |
| `REDIS_URL`                               | Must carry a password. `npm run check:redis-auth` is the gate.                                                                                                                                                                 |
| `APP_URL`                                 | The public HTTPS origin. Used for origin checks and for links in email; a wrong value produces working pages and unusable invitation links.                                                                                    |
| `TRUSTED_PROXY_CIDRS`                     | The addresses of the TLS terminator. **Startup refuses without it in production** — without it every request is attributed to the proxy, per-IP rate limiting collapses into one bucket and every audit row records `unknown`. |
| `FIELD_ENCRYPTION_KEY`                    | 32 bytes, base64. **Losing it makes encrypted fields unreadable** — it is not regenerable. Back it up with the database, not beside it.                                                                                        |
| `WEBHOOK_SIGNING_PEPPER`                  | As above.                                                                                                                                                                                                                      |
| `EMAIL_PROVIDER` + `SMTP_*`               | A real SMTP host. Production refuses to start with `mock`.                                                                                                                                                                     |
| `WHATSAPP_PROVIDER`, `ANTIVIRUS_PROVIDER` | Real providers. Production refuses `mock` for either.                                                                                                                                                                          |
| `S3_*`                                    | Object storage for documents and attendance captures.                                                                                                                                                                          |
| `ALLOW_DEMO_SEED`                         | **Must be absent.** It gates the demo seed, which creates dozens of active logins.                                                                                                                                             |

### 1.1 Database and application role separation

Two roles, and they are not interchangeable:

- **`master_saas_app`** (or your equivalent) — `NOBYPASSRLS`. What the web and
  worker containers connect as. Row-level security is FORCED on 184 tenant
  tables and this role is subject to it.
- **`leadflow`** (owner) — owns the tables, therefore bypasses RLS whether or
  not any attribute says so. Used **only** by `prisma migrate deploy` and the
  preflight script.

The application must never hold the owner role. A table owner bypasses RLS, so
one misconfigured connection string turns every tenant boundary into a
suggestion. `scripts/preflight.mjs` checks this at boot.

---

## 2. Preflight — read-only, before anything changes

Run from a host that can reach the production database, as the **owner** role.
It writes nothing.

```bash
MIGRATION_DATABASE_URL=<owner url> node scripts/rc-preflight.mjs
```

Capture the whole output into the change ticket. It reports counts only — no
lead, employee or customer data — so it is safe to paste.

**Read these lines before continuing:**

| Line                                    | What to do                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unfinished migration rows` > 0         | **Stop.** A previous migration is half-applied; `migrate deploy` will refuse. Resolve it first.                                                                     |
| `orphaned leadId references` > 0        | Expected and handled — the migration **detaches** them (sets `leadId` NULL), it does not delete them. Note the number; §3 verifies it afterwards.                   |
| `cross-workspace references` > 0        | **Stop and investigate.** A follow-up pointing at a lead in another workspace is a tenancy fault the foreign key cannot catch, and this release does not repair it. |
| `rules that will start failing` > 0     | **Stop.** An automation rule writes `nextFollowUpAt`, which this release refuses. Rewrite the rule first, or it will fail on its next run.                          |
| `Lead`/`Task`/`FollowUpTask` row counts | Sets the lock windows in §3. Judge them there.                                                                                                                      |
| `saved views mentioning it` > 0         | Not blocking. Those views show an explicit notice instead of filtering; tell the affected users (§7 of the assessment).                                             |

### 2.1 Booking/unit audit — also read-only, also before anything changes

```bash
MIGRATION_DATABASE_URL=<owner url> node scripts/rc-booking-audit.mjs
```

Two of the migrations below add constraints that existing data can block, and
this is the only way to find out before `migrate deploy` does. It exits non-zero
if either is blocked.

| Line                                                                | What to do                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Units carrying more than one live confirmed booking` — any rows    | **Stop.** That is a double-sale already in the data, and `CREATE UNIQUE INDEX` will fail on it. Each pair is a business decision — which sale stands — and it is the client's, not the operator's. The script prints booking references so they can be found. |
| `Live confirmed bookings naming no unit` — any rows                 | **Stop.** Migration 6 will fail. Each row must be given its unit or moved back to `DRAFT`, by the client.                                                                                                                                                     |
| `confirmed sales whose unit still reads available/held/blocked` > 0 | **Not blocking, and expected.** Historical drift from before confirmation touched inventory. Note the number; from this release forward it can only be created by hand.                                                                                       |

Capture the output into the ticket. It prints booking references and ids — no
client name, phone number or email — so it is safe to paste.

---

## 3. Migration

10 migrations for the integrated candidate (`dev/workspace-restructure` with the monitoring console and dual-credential sign-in), in this order. `prisma migrate deploy` applies them automatically — the breakdown is here so the operator knows what each one locks. The dual-credential migration (#11, `20260914120000_dual_credential_sessions`) is listed separately in §3.1a.

Migrations 5–6 sort before the booking and finance migrations by name. A database already at the restructuring candidate has 7–10 applied and not 5–6; `prisma migrate deploy` applies the missing ones by name. Checked on a disposable database migrated to the restructuring candidate (73 migrations, no monitoring migrations): `migrate deploy` applied 5, 6 and #11 in that order, with no drift afterwards; the upgrade and rollback rehearsal with live sessions is recorded in `docs/product/RELEASE-CHECKPOINT-DUAL-CREDENTIAL-INTEGRATION.md`.

| # | Migration | What it does | Lock |
| --- | --- | --- | --- |
| 1 | `20260910190000_lead_triage_queue` | New table `LeadTriageEntry`, 2 enums, 7 indexes | New table — nothing existing is locked |
| 2 | `20260911100000_triage_idempotency_and_outbox` | New tables `IdempotentRequest`, `NotificationOutbox`; 1 column on the new `LeadTriageEntry` | As above |
| 3 | `20260911150000_follow_up_lead_relation` | Detaches orphans; adds the FK **`NOT VALID`**; 2 indexes on `Task` and `FollowUpTask` | The `NOT VALID` add is brief. **The two `CREATE INDEX` statements take a `SHARE` lock on `Task` and `FollowUpTask` for the build — writes to those two tables wait, reads do not.** |
| 4 | `20260911150500_follow_up_lead_relation_validate` | `VALIDATE CONSTRAINT` | `SHARE UPDATE EXCLUSIVE` — **does not block writes** |
| 5 | `20260911160000_platform_monitoring_grants` | Enum `PlatformGrantKind`; column `PlatformAccessGrant.kind` (default `READ`); **every existing grant row set to `WRITE`** (all pre-existing rows were break-glass); index replaced; new table `PlatformCoverageGrant` with its grant to the application role | `ACCESS EXCLUSIVE` on `PlatformAccessGrant` for the column add, index swap and update — a small, rarely-written table; staff grant checks wait for it, customer traffic does not touch it |
| 6 | `20260911160500_monitoring_sensitive_scope` | Column `sensitive` on both grant tables (default `false`); existing `WRITE` rows set `sensitive = true` | As 5, on both grant tables |
| 7 | `20260912020000_booking_unit_exclusivity` | `Booking_confirmed_requires_unit` (CHECK, `NOT VALID`) and `Booking_one_confirmed_per_unit` (partial unique index) | The `NOT VALID` add is brief. **`CREATE UNIQUE INDEX` takes a `SHARE` lock on `Booking` for the build — writes to `Booking` wait, reads do not.** The index covers only live confirmed rows, so the build is proportional to confirmed sales, not to every booking ever written. |
| 8 | `20260912020500_booking_unit_exclusivity_validate` | `VALIDATE CONSTRAINT` on the CHECK | `SHARE UPDATE EXCLUSIVE` — **does not block writes** |
| 9 | `20260912100000_agency_fee_receipts` | Two new tables (`AgencyFeeReceipt`, `CollectionRecoveryCase`) under forced RLS, two enums, three `Permission` rows, and `RolePermission` grants for existing `finance_admin` / `company_admin` roles | New tables — nothing existing is locked. The `INSERT … SELECT` into `RolePermission` takes ordinary row locks only. **Cannot fail on data**: it creates, it does not validate |
| 10 | `20260912200000_fee_amendments_recovery_workflow` | `AgencyFeeAmendment` (forced RLS), recovery-case workflow columns and enum values, three nullable `HrPayslip` placement columns, `agencyfee` permissions and grants | New table and nullable columns only. **Cannot fail on data.** `ALTER TYPE … ADD VALUE` runs here and the values are first used by application code, never in the same transaction |

**Migrations 5–6 (`platform_monitoring_grants`, `monitoring_sensitive_scope`) create no authority.** No coverage row is created; every
pre-existing grant keeps the meaning it had (break-glass, which already conferred
everything); new rows default to the weaker `READ` / non-sensitive. VERIFIED on a
database staged at the restructuring schema with a live pre-upgrade grant (§3.1).

**Deployment window for 5–6.** If the old web tier is still serving after migration
5, a break-glass it opens gets the column default: `READ`, non-sensitive. That is
the safe direction — less authority than intended — but the owner will have to
reopen it under the new release. Identify any such row afterwards with the §3.1
query (`kind = 'READ'` held by an `OWNER`, `grantedAt` after the migration).

The foreign key is split across migrations 3 and 4 deliberately. A plain
`ADD CONSTRAINT ... FOREIGN KEY` scans every row while holding
`SHARE ROW EXCLUSIVE` on **both** `FollowUpTask` and `Lead`, which blocks writes
to `Lead` — the busiest table in the product — for the length of the scan.
`NOT VALID` skips the scan; migration 4 does the scan without blocking writes.
They are two files because Prisma wraps each file in one transaction and locks
are held until it commits.

Migrations 5 and 6 are split for the same reason as 3 and 4, and migration 6 is
the one §2.1 exists to protect: it **fails** if any live confirmed booking has
no unit. That is deliberate — such a row is a sale nobody can point at a flat,
and deciding what it should become is not a migration's call.

**The remaining lock to judge is the two indexes.** They are not `CONCURRENTLY`,
because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction and Prisma
provides one. Against the `Task` / `FollowUpTask` counts from §2, decide whether
to run during a quiet window. Rehearsed on a seeded dataset: migration 3 took
**39–171 ms**, migration 4 **9–40 ms**.

```bash
# 1. Back up first — see §9. Do not skip this.
# 2. Stop the workers (not the web tier yet); they write continuously.
docker compose -p master-suite -f infra/docker-compose.prod.yml stop worker

# 3. Apply.
MIGRATION_DATABASE_URL=<owner url> npx prisma migrate deploy
```

### 3.1 Verify the migration did what it said

```bash
MIGRATION_DATABASE_URL=<owner url> node scripts/rc-preflight.mjs
```

- `constraint already present` → `yes`
- `orphaned leadId references` → `0`
- `already detached (leadId IS NULL)` → should have risen by exactly the orphan
  count from §2. **No `FollowUpTask` row is deleted by this migration** — the
  total row count is unchanged. If it fell, stop and restore.

Grant meaning after 5–6 (owner role, read-only):

```sql
SELECT g.kind, g.sensitive, u."platformRole", count(*)
  FROM "PlatformAccessGrant" g JOIN "PlatformUser" u ON u.id = g."platformUserId"
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
-- expect: every row that existed before the migration is WRITE / true, held by OWNER.
SELECT count(*) FROM "PlatformCoverageGrant";   -- expect 0
```

The row count of `PlatformAccessGrant` must be unchanged across the migration.

### 3.1a Dual-credential migration (#11)

| # | Migration | What it does | Lock |
| --- | --- | --- | --- |
| 11 | `20260914120000_dual_credential_sessions` | Enum `PlatformCredentialPurpose`; columns `PlatformUser.passwordVersion` (default 1), `monitoringPasswordHash` (NULL), `monitoringPasswordVersion` (default 0), `monitoringPasswordSetAt`; `PlatformSession.credentialPurpose` / `credentialVersion` (NULL); `PasswordResetToken.credentialPurpose` (NULL); new table `PlatformMfaChallenge` with its grant to the application role. **Revokes every live session of an OWNER, SUPPORT or SECURITY_AUDITOR identity** (`revokedReason = 'CREDENTIAL_PURPOSE_MIGRATION'`, `AI_SERVICE` sessions excluded) and marks their unused reset links used. | `ACCESS EXCLUSIVE` on `PlatformUser`, `PlatformSession` and `PasswordResetToken` for the column adds (metadata-only with constant defaults on Postgres 16) and the two updates. Every request resolves a session, so sign-in and session checks wait for the transaction; keep it in the same quiet window as the rest. |

**It creates no authority.** No monitoring password, no grant, no coverage. A staff
session issued before it carries no credential purpose and the new release refuses
such a session rather than guessing that it was administration — the migration
revokes them up front so the refusal is not a surprise mid-shift. **Tell platform
staff before the window: they sign in again, with MFA.** Customer (`USER`) sessions
and reset links are untouched. Finished migrations afterwards: **72** on the
monitoring line alone, **76** on the integrated candidate.

Verify (owner role, read-only):

```sql
SELECT count(*) FROM "PlatformUser" WHERE "monitoringPasswordHash" IS NOT NULL;      -- expect 0
SELECT count(*) FROM "PlatformSession" s JOIN "PlatformUser" u ON u.id = s."platformUserId"
 WHERE s."revokedAt" IS NULL AND s."expiresAt" > now() AND s.purpose <> 'AI_SERVICE'
   AND u."platformRole" IN ('OWNER','SUPPORT','SECURITY_AUDITOR');                    -- expect 0
SELECT count(*) FROM "PlatformMfaChallenge";                                          -- expect 0
-- PlatformAccessGrant and PlatformCoverageGrant row counts unchanged from §2.
```

### 3.1b Permission catalogue (#13) — definitions only, no grants

| # | Migration | What it does | Lock |
| --- | --- | --- | --- |
| 13 | `20260915140000_permission_catalogue_definitions` | Inserts the 478 `Permission` definitions in `src/lib/security/permissionCatalogue.ts` with `ON CONFLICT ("module","action") DO NOTHING`. **Inserts no `RolePermission` row, updates and deletes nothing**; existing rows and their ids are untouched. | Row locks on `Permission` only — a small table nothing writes during traffic. **Cannot fail on data.** |

A `Permission` row is a *definition* a role can be granted; authority exists only
in `RolePermission`. So after #13 every existing role is exactly as it was: new
definitions appear in the role editor as *None* until an administrator grants them.
**Do not run `scripts/backfill-admin-permissions.mjs` or
`scripts/seed-role-defaults.ts` afterwards** — both grant every catalogue row and
would widen existing roles. A workspace created after #13 gives its
`company_admin` every catalogue permission, as provisioning always has.

Verify, read-only, before and after (from `apps/web`, owner role URL in
`MIGRATION_DATABASE_URL`):

```bash
npm run check:permissions      # exit 0: "all 478 definitions present"; exit 1 lists what is missing
```

```sql
-- Grants unchanged: run before and after, the two results must be identical.
-- The owner role reads every tenant's rows (RolePermission is under RLS).
SELECT count(*), md5(string_agg(id || ':' || "tenantId" || ':' || "roleId" || ':' || "permissionId" || ':' || granted::text
                                || ':' || scope::text || ':' || coalesce(conditions::text, ''), ',' ORDER BY id))
  FROM "RolePermission";
```

CI runs the same check immediately after `prisma migrate deploy` and before the
demo seed, so a seeded database cannot hide a missing definition.
`tests/unit/permission-catalogue.spec.ts` keeps the migration equal to the list and
proves the list covers the navigation, the monitoring allowlist and every literal
permission check in `src`.

**Adding a module later:** add it to the catalogue list and write a migration that
inserts only the new definitions; the unit test fails until both agree.

#### Why (history, kept for the record)

A role can only be granted a permission whose `Permission` row exists. On a clean
database taken through the supported path — `prisma migrate deploy`,
`bootstrap-owner.mjs`, sign-in with MFA enrolment, a plan and a workspace created
through the platform API, **no demo seed** — nine permissions the navigation gates
on have no row: `automation`, `communications`, `documents`, `fieldsales`, `forms`,
`landingpages`, `products`, `smartviews` and `tickets` (VIEW). Their screens can be
granted to nobody, and the monitoring allowlist's `tickets:VIEW` is inert
(monitoring fails closed there). Migrations create 114 rows; workspace creation adds
the floor in `api/v1/platform/workspaces` (252 after one workspace). Only
`prisma/seed` creates the rest, and the seed refuses to run under `APP_ENV` production or staging
and without `ALLOW_DEMO_SEED=yes` — it is demo data, not an install step.

This is not introduced by the dual-credential work: the provisioning code and the
migrations are unchanged from `7cf5828`. The test suites pass because CI seeds.

Migration #13 above is that reviewed catalogue migration. Do not insert
`Permission` rows by hand.

### 3.1c MFA replay guard (#12)

| # | Migration | What it does | Lock |
| --- | --- | --- | --- |
| 12 | `20260915130000_mfa_replay_guard` | Nullable column `PlatformUser.mfaLastUsedStep` | `ACCESS EXCLUSIVE` on `PlatformUser` for a metadata-only column add — milliseconds. **Cannot fail on data.** |

An authenticator code is now accepted once: the step it belongs to is recorded in
the same conditional `UPDATE` that accepts it, so two requests racing with one code
cannot both succeed, and neither can a later request with that code or an older
one. This applies to sign-in (workspace and platform), service sign-in, enrolment
confirmation, recovery-code regeneration, disabling two-factor, credential
re-authentication and monitoring-password removal. Recovery codes are consumed by
one statement that removes the code only if present. Nothing to migrate: the
column starts empty and the first accepted code fills it.

What people notice: a code that was just used — including by a sign-in a moment
ago — is refused with "already used"; they wait for the next code (≤ 30 s). A
refused replay on sign-in is audited as `MFA_CODE_REPLAYED`.

### 3.1d Monitoring scope — conversation content needs a sensitive grant

An ordinary (non-sensitive) READ monitoring grant gives `VIEW` on leads, calls,
activities, tasks, visits and tickets. `calls:VIEW` no longer carries conversation
content with it. Without a grant issued with `sensitive: true`, monitoring gets:

| Surface | Ordinary monitoring grant | Sensitive grant |
| --- | --- | --- |
| Call list and call record (who, when, duration, status, outcome) | yes | yes |
| Call notes (`notes`, API and screens) | withheld (`null`) | yes |
| Transcript, recording, AI analysis, AI audit (unchanged) | 403 | yes |
| Coaching notes (`/calls/[id]/coaching`, call page) | 403 / not rendered | yes |
| Objection matches (quoted transcript snippets) | not rendered | yes |
| Coaching metrics — per-call sentiment, talk ratio, audit and practice scores (`/coaching`, Coaching and Call audits screens) | 403 / notice, no data | yes |
| Practice sessions and scores (`/practice`, `/practice/[id]`) | 403 | yes |
| Dashboard (average audit score) and event pages (AI meeting summaries) | refused to monitoring entirely | refused to monitoring |

**Aggregate call metrics are withheld pending an owner decision** — the review
package lists it. Customer users and machine credentials are unaffected.

**Before an install or upgrade:** nothing to do for #12 and #13 beyond
`prisma migrate deploy`; verify with `npm run check:permissions` and the digest
query in §3.1b.

### 3.2 Provisioning the designated monitoring identity — separate authorised step

**Not part of the deployment.** Do it only after the release is verified, under its
own change ticket. No password is ever sent in chat, a ticket, email or a script.

1. **Find the identity; never create a second one.** Owner role, read-only:
   `SELECT id, "platformRole", status, "mfaEnabled", "monitoringPasswordHash" IS NOT NULL AS has_monitoring FROM "PlatformUser" WHERE "normalizedEmail" = lower('<designated email>');`
   - No row → stop. Creating a platform identity is its own decision
     (`scripts/bootstrap-owner.mjs` for the first owner only).
   - `platformRole = 'USER'` (a customer account) → **stop**. Nothing promotes it
     automatically; `bootstrap-owner.mjs` refuses without `--promote-existing`, and
     that is an owner decision recorded in its own ticket.
   - `mfaEnabled = false` → the person signs in with their administration password
     and enrols first. A monitoring password cannot be set without MFA.
2. **The person sets it themselves**: signed in with the **administration** password
   and MFA → *Platform → Sign-in and passwords* → *Set monitoring password*. The form
   asks again for the administration password and a current code; the new password
   must differ from the administration password. Audit row
   `MONITORING_CREDENTIAL_SET`, no secret in it.
3. **Authorise workspaces separately**: a **second** owner issues READ grants through
   `POST /api/v1/platform/monitoring/grants` (there is no grant-management screen yet;
   an owner cannot grant themselves). The password alone opens no workspace.
4. **Verify**: sign in with the monitoring password → lands on `/monitoring`, banner
   reads *read-only monitoring session*; `/platform` shows *no platform access*.
5. **Revoke without touching the administration password**: the person (*Remove
   monitoring password*) or another owner (*Users → the person → Remove monitoring
   password*, with that owner's code). Either ends every monitoring session at once.

---

## 4. Start web, then workers

Order matters: the web tier is safe to run before the workers, and the workers
are not safe to run against an unmigrated schema.

```bash
# Web first.
docker compose -p master-suite -f infra/docker-compose.prod.yml up -d web
# Wait for health, then workers.
docker compose -p master-suite -f infra/docker-compose.prod.yml up -d worker
```

The worker container runs `src/workers/index.ts` and registers the queues:
distribution, sla, automation, maintenance, notifications, ai, campaigns, media,
webhook, liveStream. The maintenance queue arms four schedules — retention
(03:00), reminders (every 15 min), lead triage (every 5 min) and the
**follow-up drift canary (03:20, report-only)**.

### 4.1 Web and worker restart — what survives it

**VERIFIED** (isolated): with web and worker both stopped, a notice committed to
`NotificationOutbox` stays `PENDING`; after starting web, then the worker, it is
delivered exactly once, traced by its `eventKey`. A notice claimed by a worker
that died is reclaimed after its 60-second lease and delivered once. A replayed
decision (same `eventKey`) never produces a second notice. `/api/health/live`
answers 200 after the restart.

After any restart in production (**PROPOSED** — the same checks, read-only):

```sql
-- nothing stuck: pending notices older than ten minutes (expect 0 once the worker is up)
SELECT count(*) FROM "NotificationOutbox" WHERE status = 'PENDING' AND "createdAt" < now() - interval '10 minutes';
-- nothing given up on during the outage
SELECT count(*) FROM "NotificationOutbox" WHERE status = 'ABANDONED' AND "updatedAt" > now() - interval '1 hour';
```

One outbox row per event is enforced by the unique `(tenantId, eventKey)`, so it
needs no check. A duplicate *in-app notice* cannot be detected by query in
production — `Notification` does not carry the event key — which is why the
exactly-once property is established by the rehearsal, not by a production query.

---

## 5. Backfill — after the deployment is healthy, not during it

The screens derive the follow-up date per request, so they are correct the
moment the web tier is up. The backfill only corrects the stored column, which
reconciliation and the canary compare against.

```bash
# Dry run first. Writes nothing; prints how many leads disagree.
node -e "require('./scripts/…')"   # or, from the application host:
#   repairDrift(tenantId, { apply: false })
```

Do one workspace, smallest first, then the rest in batches. It is resumable and
re-running it is a no-op: the repair re-derives under the lead's row lock rather
than writing a value it measured earlier, so it cannot reinstate a stale number
over a concurrent write.

**There is nothing to roll back.** The repair recomputes a derived column from
rows it does not modify.

---

## 6. TLS, proxy, provider and storage checks

### 6.0 If `NODE_EXTRA_CA_CERTS` is set, prove the file is there

```bash
docker compose -p master-suite -f infra/docker-compose.prod.yml exec web   sh -c 'echo "$NODE_EXTRA_CA_CERTS"; ls -l "$NODE_EXTRA_CA_CERTS"'
```

**Do this before the smoke tests, not after.** If the variable names a file the
container does not have, the application starts normally, answers
`/api/health`, serves every page — and cannot send a single email. Every
invitation and password reset fails with `unable to verify the first
certificate`, which reaches the user as a plain 500 with nothing about
certificates in it. Nothing warns at boot, and no page-loading smoke test finds
it.

This is not hypothetical: it is how the browser suite failed 5 specs during
release verification, with the application otherwise healthy (checkpoint §1.5).

The same applies to the worker, which sends mail of its own:

```bash
docker compose -p master-suite -f infra/docker-compose.prod.yml exec worker   sh -c 'ls -l "$NODE_EXTRA_CA_CERTS"'
```

```bash
# TLS terminates in front, and the chain is complete (not just "responds").
curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://<APP_URL>/login
#   expect: 200 0        (ssl_verify_result 0 = verified)

# The application sees the real client address through the proxy.
#   An audit row with ip = the proxy's address means TRUSTED_PROXY_CIDRS is wrong.

# Object storage is reachable and writable by the application role.
#   Upload a document through the UI and confirm it downloads again.

# Mail actually leaves: send one invitation to an address you control.
```

Providers must be real, not `mock` — production refuses to boot otherwise, so a
running container has already proved this. What it has **not** proved is that the
credentials are correct: a wrong SMTP password fails at send time, not at boot.
**Send one real invitation before declaring the deployment good.**

---

## 7. Health checks and smoke tests

Health, first:

```bash
curl -fsS https://<APP_URL>/api/health/live   # process is up (touches nothing)
curl -fsS https://<APP_URL>/api/health       # database and Redis reachable
```

Then these, by hand, as a **real client account** — not the demo account:

| #   | Smoke test                                             | Pass condition                                                                                 |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1   | Sign in as an agent                                    | Reaches the workspace                                                                          |
| 2   | Sign out, then open a workspace URL                    | Redirected to login, not a 500                                                                 |
| 3   | Sign in as an agent and open a page their role forbids | "You do not have permission", not an error page                                                |
| 4   | Create a lead                                          | Appears in the list                                                                            |
| 5   | Assign it to an agent                                  | Owner shows on the row                                                                         |
| 6   | Create a follow-up on it                               | The **Follow-up** column shows that date within one page refresh                               |
| 7   | Reschedule it                                          | The column moves to the new date                                                               |
| 8   | Complete it                                            | The column reads **No action assigned to you**                                                 |
| 9   | Open `/leads?filter=overdue` as an agent               | Only leads with **their own** overdue work                                                     |
| 10  | The same as a manager                                  | `Overdue · team` and `Overdue · mine` are separate chips and return different sets             |
| 11  | Open the leads list on a phone                         | The follow-up state is visible; no horizontal scrolling                                        |
| 12  | An employee opens self-service                         | Their own record, not somebody else's                                                          |
| 13  | An employee submits a leave request                    | Appears in the manager's queue                                                                 |
| 14  | The manager approves it                                | State changes and the employee sees it                                                         |
| 15  | Clock in / clock out                                   | Attendance records, capture stored                                                             |
| 16  | Worker processing                                      | Create an unassignable lead; within 5 minutes it appears in the triage queue                   |
| 17  | Notification recovery                                  | Stop the worker mid-sweep, start it again; the pending notice is delivered exactly once in-app |

Stop and consider rollback if **any of 1–8, 12–14 or 16** fails. Those are the
workflows the client uses daily.

---

## 8. Stop conditions

Stop immediately, and do not proceed to the next step, if:

- The preflight reports unfinished migrations, cross-workspace references, or an
  automation rule that writes `nextFollowUpAt`.
- `FollowUpTask` row count **falls** across the migration.
- `/api/health` does not return success within 2 minutes of start.
- `BUILD_COMMIT` in the running container is not the release SHA, or is `unknown`.
- Sign-in fails for a real client account.
- Any audit row records `ip` as the proxy address (the proxy CIDRs are wrong;
  rate limiting and attribution are both broken).
- The drift canary reports a non-zero count on its first run **and** you have not
  yet run the backfill — that is expected; after the backfill it is a defect.

---

## 9. Rollback and recovery

**These are two different operations. Do not confuse them.**

### 9.1 Application rollback

> **Closeout candidate: no earlier release is a safe rollback target.**
>
> Every earlier release lacks access boundaries this candidate enforces, and two
> of them protect **customers**, not only platform staff:
>
> | Boundary the candidate enforces | Earlier releases | Closed by suspending staff (§9.1.1)? |
> | --- | --- | --- |
> | An OWNER enters only workspaces it holds a grant for; staff sessions get only granted `VIEW` | admit **any OWNER to any workspace, with no grant**, HR and payroll included; a grant's `kind` is ignored | **Yes** — the old release still checks account status at sign-in and on every request |
> | A monitoring session is read-only (`credentialPurpose`) | a live monitoring session of an OWNER **is the owner** | **Yes** — every staff session is revoked |
> | Conversation content needs a sensitive grant (§3.1d) | coaching notes, scores and call notes on `calls:VIEW` | **Yes** — no staff session can exist |
> | An authenticator code is accepted once (§3.1c) | the same code is accepted again within its ±30 s window, including by concurrent requests | **No** — this is every customer with two-factor |
> | `employee:VIEW` below organisation scope sees only the viewer's record (`2ac9407`) | an OWN-scope employee reads the whole directory and the expiring-documents list with document numbers | **No** — customer roles |
>
> The first three were demonstrated against `7cf5828` in the isolated rehearsal;
> the last two are established by the commits (neither `2ac9407` nor the replay
> guard is an ancestor of any earlier release) and by the regression tests that fail
> without them. **So an image swap to an earlier release is unsafe, and even
> §9.1.1 does not preserve the required access boundaries — it narrows the exposure
> to the two customer-side regressions.**

**Recovery, in order of preference:**

1. **Roll forward.** Fix on the candidate line, build the image for the exact
   commit (`build-images.yml`), gate it, deploy it by digest. Migrations #12 and #13
   are additive and need no reversal; there is no down-migration and none is needed.
2. **A compatible recovery target** — an earlier image of _this_ line that passed
   the gate and was accepted. **None exists yet**: this candidate is the first. Once
   it is accepted and deployed, its digest is the recovery target for the next
   release, and a rollback to it is an ordinary image swap (same boundaries, same
   schema). Record it in the release ticket.
3. **Bounded maintenance (boundary-preserving, customer outage)** — §9.1.0, when the
   candidate cannot serve and roll-forward will take time.
4. **Emergency rollback to an earlier release with staff access suspended** —
   §9.1.1, **only** with a written, time-boxed acceptance of the two customer-side
   regressions above by the client owner **and** the security reviewer. It is not
   "safe"; it is an accepted risk.

#### 9.1.0 Bounded maintenance — nothing serves, every boundary holds

Use when the candidate must stop serving and no accepted recovery target exists.

- **Web instances:** stop every web instance of the candidate; start none of any
  other version. The proxy returns its static maintenance response. No application
  code serves, so **no session is issued**, no sign-in or code is accepted, no grant
  can be issued and no workspace entered.
- **Workers:** stop every worker. Jobs stay queued in Redis and scheduled jobs
  (retention, reminders, triage, drift canary) run at their next schedule after
  restart; nothing is lost.
- **Grants and sessions:** untouched. Grant and session expiry are evaluated per
  request, so anything that expires during the window is simply expired when service
  resumes.
- **Audit:** open a change ticket before stopping; the stop and start are recorded
  in the ticket and in the deployment log. Nothing is suppressed.
- **End:** start the fixed candidate (roll forward) — web first, then workers (§4) —
  and run §7.

_Not rehearsed as a separate run: it is the "all instances stopped" state that
§9.1.1 step 1 and the rehearsal's maintenance phase already start from._

#### 9.1.1 Emergency rollback with staff access suspended — VERIFIED (isolated)

**Authorisation, before anything is touched:** a change ticket naming why roll
forward and §9.1.0 are not acceptable; **written acceptance of the customer-side
regressions** in the table above, with an end time; approval by the client owner
**and** the designated security reviewer; two operators, one executing and one
reading back each step into the ticket. **`<CHG>` must be unique** — the procedure
refuses an id already in the audit trail, because §9.1.2 restores by it.

1. **Freeze.** Announce it. Stop **every web instance and every worker** of the
   candidate. Never run old and new web instances side by side. With the web tier
   stopped nothing can issue a grant, open a session or enter a workspace.
2. **Back up** (§9.2) and verify it restores. Do not skip.
3. **Identify**, read-only, owner role, and paste the output into the ticket. No
   time filter: anything issued during the deployment window is included.

   ```sql
   SELECT g.id, u."platformRole", g.kind, g.sensitive, g."tenantId", g."grantedAt"
     FROM "PlatformAccessGrant" g JOIN "PlatformUser" u ON u.id = g."platformUserId"
    WHERE g."revokedAt" IS NULL AND g."expiresAt" > now();
   SELECT id, "platformUserId", sensitive, "grantedAt", "grantedById"
     FROM "PlatformCoverageGrant" WHERE "revokedAt" IS NULL AND "expiresAt" > now();
   SELECT s.id, u."platformRole", s."credentialPurpose", s."activeTenantId"
     FROM "PlatformSession" s JOIN "PlatformUser" u ON u.id = s."platformUserId"
    WHERE s."revokedAt" IS NULL AND s."expiresAt" > now()
      AND u."platformRole" IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR');
   SELECT id, email, "platformRole" FROM "PlatformUser"
    WHERE "platformRole" IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR')
      AND status = 'ACTIVE' AND "deletedAt" IS NULL;
   ```

4. **Suspend, with the reviewed procedure** — one transaction, from `apps/web`:

   ```bash
   psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 \
     -v change='<CHG>' -v operator='<executing operator>' \
     -v expect='<grants>,<coverage>,<sessions>,<identities>' \
     -f scripts/rollback/suspend-staff-access.sql
   ```

   It refuses and changes nothing if the counts differ from step 3, the change id
   was used before, or no operator is named. It revokes every live grant and
   coverage grant and every live staff session (administration and monitoring),
   suspends the staff identities, deletes unfinished MFA challenges, and writes one
   `ROLLBACK_ACCESS_GRANT_REVOKED` row per grant **in that workspace's audit trail**,
   one `ROLLBACK_STAFF_ACCESS_SUSPENDED` row per identity and one
   `ROLLBACK_ACCESS_REMEDIATION` summary listing every id — each carrying the change
   id and the operator. The three post-condition lines must read `0`; paste the
   counts line into the ticket. **`USER` and `AI_SERVICE` identities and their
   sessions are not touched.** Monitoring password hashes are kept: they sign in
   nowhere on the old release and let roll-forward restore monitoring without
   re-provisioning.

5. **Roll back the application:** `scripts/release.sh rollback production` — web
   first, then its worker.
6. **Verify on the rolled-back release** (rehearsed): the pre-rollback monitoring and
   administration sessions are refused at the console, at workspace entry and on HR;
   every staff identity is refused at sign-in; a customer signs in and reads their
   workspaces; no staff session is created during the window.

**What runs during the window (rehearsed):**

- _Web:_ the old release issues **customer** sessions only. They carry no credential
  purpose and remain valid after roll-forward (customer sessions never did).
- _Worker:_ the old worker attaches every queue and arms its schedules. It issues no
  session or grant and changes no identity. Its retention job deletes
  `PlatformSession` rows revoked more than 30 days ago and `PlatformAuditEvent` rows
  older than `PLATFORM_AUDIT_RETENTION_DAYS` — **never the rollback rows written
  minutes earlier**; the rehearsal runs it inside the window and re-counts them.
  The worker entry point and retention job are identical in `7cf5828` and the
  candidate, and the migrated schema only adds a nullable column and rows.
- _Grants:_ none can be issued (no staff can sign in).

#### 9.1.2 Returning staff access — VERIFIED (isolated)

After the candidate line serves again (roll forward, §7 passed):

```bash
psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 \
  -v change='<CHG>' -v operator='<executing operator>' \
  -f scripts/rollback/restore-staff-access.sql
```

It reactivates **only** the identities that change suspended, refuses a second
restore of the same change, and writes `ROLLBACK_STAFF_ACCESS_RESTORED` with the
operator and the ids. **Grants and coverage stay revoked:** each one is re-issued
deliberately by a second owner through the application, which audits it like any
grant. _(Rehearsed: legacy and pre-rollback staff sessions stay refused; staff sign
in again with MFA; password B still yields monitoring and A administration; no
workspace until re-granted; a re-issued READ grant admits monitoring; neither session
enters a workspace with no grant or reads HR.)_


#### 9.1.3 Schema compatibility of the old application — restructuring release

`scripts/release.sh rollback production` restarts the previous image tag. For the
restructuring release this was checked, not assumed:

- The three new tables (`LeadTriageEntry`, `IdempotentRequest`,
  `NotificationOutbox`) are additions. The old application does not know they
  exist and does not query them.
- The new column is on a new table.
- The new indexes are transparent.
- The new foreign key changes one behaviour: deleting a `Lead` now also deletes
  its follow-ups, where before it left them orphaned. The old application does
  not depend on the orphans.
- `Lead.nextFollowUpAt` — the old application **reads** it and never writes it.
  After rollback the column stops being maintained and slowly goes stale again,
  which is the behaviour that version already had.

**With one exception, no schema change prevents restarting the older
application.** The exception arrived with the booking migrations (5 and 6):

- `Booking_confirmed_requires_unit` refuses a `CONFIRMED` row with no unit. The
  previous application never wrote `unitInventoryId` at confirmation and never
  required it, so after a rollback **`PATCH /api/v1/bookings` with
  `action: 'CONFIRM'` on a draft that names no unit fails with a 500** — the
  old code does not know the constraint exists. Confirming a draft that _does_
  name a unit still works. Nothing else in the old version writes rows these
  constraints see.
- `Booking_one_confirmed_per_unit` can also refuse the old code: two
  confirmations of one unit, which the old version allowed, now end with the
  second as a 500 rather than a double-sale. That is the constraint doing its
  job, but the old code will report it as an error rather than a refusal.

So an application rollback across migration 6 is safe for everything except
booking confirmation, where it degrades to "refused with a 500" for the two
cases above. If that is not acceptable for the rollback window, the choice is
to keep the new version's booking route or to drop the CHECK
(`ALTER TABLE "Booking" DROP CONSTRAINT "Booking_confirmed_requires_unit"`) —
which is a decision to permit unitless confirmed sales again, and is the
client's, not the operator's.

Application rollback still needs no database recovery, and is the first thing
to try.

**For the integrated candidate the schema is otherwise equally compatible** — the monitoring migrations (5–6) and the dual-credential migration (#11) add columns with defaults and a table the old application never queries — **but that makes the schema compatible, not the release safe: see §9.1 and §9.1.4**.

#### 9.1.4 Rollback targets for the closeout candidate

| Target | Schema | Verdict |
| --- | --- | --- |
| An accepted, deployed image of this candidate line | identical | **Compatible recovery target** — ordinary image swap by digest. None exists until this release is accepted. |
| `7cf5828` (`dev/workspace-restructure`) | compatible — booted and served on the migrated database, its worker ran | **Unsafe.** Demonstrated: a live monitoring session is the owner, enters a break-glass-only and a no-grant workspace and reads its HR; a fresh OWNER session enters a no-grant workspace and reads HR even after monitoring sessions are revoked. §9.1.1 closes those; the customer-side MFA replay and employee-directory regressions remain. |
| `main` before `507cdac`, the incident RC, the restructuring release, `05a7b90` / `9df91d8` | as §9.1.3 | **Unsafe**, for the same reasons; §9.1.1 applies with the same residual customer-side risk. |
| `507cdac` (current `main`: the integration candidate merged, assessed NO-GO) | compatible | **Not a target.** It was never accepted for release, accepts replayed authenticator codes and serves conversation content to monitoring. |
| Down-migration | — | None provided or needed. Do not drop the columns or rows of #11–#13: roll-forward relies on them. |

**Roll-forward from an earlier release** needs no data step for sessions: every staff
session the old release issued carries no credential purpose and is refused (and
revoked as `LEGACY_SESSION_WITHOUT_CREDENTIAL_PURPOSE`). Before restoring access
(§9.1.2), owner role:

- A password changed or reset **by the old release** did not advance
  `passwordVersion`. The old release revoked that identity's sessions itself; nothing
  to do.
- If the old release set an administration password equal to that person's
  monitoring password, sign-in refuses both and records `LOGIN_CREDENTIAL_AMBIGUOUS`.
  Clear the monitoring password for that identity under the ticket
  (`monitoringPasswordHash = NULL, monitoringPasswordSetAt = NULL,
  monitoringPasswordVersion = monitoringPasswordVersion + 1`), and the person sets a
  new one (§3.2).
- `mfaLastUsedStep` was not maintained by the old release; the first code accepted
  after roll-forward fills it. Nothing to do.


### 9.2 Database backup and recovery

Needed for data loss, and as step 2 of §9.1.1. Run from `apps/web/infra` on the
host, with the backup environment the schedule uses.

**Take and prove a backup — VERIFIED (isolated, Linux):**

```bash
cd apps/web/infra
BACKUP_PASSPHRASE=… BACKUP_REMOTE=… BACKUP_REQUIRE_ENCRYPTION=1 BACKUP_REQUIRE_REMOTE=1 \
  ../scripts/backup.sh /var/backups/master-suite        # takes it, encrypts, ships it off-host
BACKUP_PASSPHRASE=… BACKUP_REMOTE=… \
  ../scripts/restore-verify.sh --prefer-remote /var/backups/master-suite/latest
```

`restore-verify.sh` must print `RESTORE VERIFIED`: dump restored without errors,
ledger at head (**71/71** for this candidate), every counted table reconciled
(Tenant, PlatformUser, Lead, Recording, AuditLog) and the object count matching.
Three defects that made this unreliable are fixed in the candidate and must be on
the host before relying on it: the manifest regex that matched nothing
(`24b0a77`), the row-count loop that stopped after the first table (`660bee1`),
and `backup.sh` pulling `minio/mc`, which Docker Hub no longer serves — a host
without the image cached could not take a backup (`85ec940`, now
`quay.io/minio/mc`). If the host has an older copy of `scripts/`, update it first.

*Known, not fixed:* `--from-remote <stamp>` (the host-gone form) verifies correctly
but prints a "No such file or directory" error writing its `.verified-at` marker,
so `backup-status.sh` will not count that verification. The scheduled unit passes
a path, not a stamp, and is unaffected.

**Restore for real — VERIFIED (isolated, Linux), into a new database, never over the live one:**

```bash
dc exec -T postgres psql -U leadflow -d postgres -c 'CREATE DATABASE leadflow_restored;'
gpg -d --batch --passphrase "$BACKUP_PASSPHRASE" database.dump.gpg \
  | dc exec -T postgres pg_restore -U leadflow -d leadflow_restored --no-owner --no-privileges
```

Then, against `leadflow_restored`, as the owner role:

```sql
-- 1. ledger complete (expect 0, and 71 applied)
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
-- 2. tenant isolation survived (expect 0)
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity;
-- 3. REQUIRED: the application role has NO privileges after a --no-privileges restore
--    (rehearsed: 0 tables). They were granted by migrations, which do not re-run. Reapply:
GRANT USAGE ON SCHEMA public TO master_saas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO master_saas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO master_saas_app;
```

Rehearsed after step 3: the application role, pinned to one tenant, sees exactly
that tenant's rows and none of another's. Then restore the objects
(`mc mirror --overwrite ./objects target/leadflow-documents`), point a **staging**
deployment at the restored database, sign in, read a lead and download one
document (**PROPOSED** — not rehearsed), and only then repoint production.

Restoring a backup taken **before** the migration returns the schema to its
previous shape, so the **new** application will not run against it. After such a
restore you must also roll the application back — and for the integration
candidate that means §9.1.1, with its staff-access suspension. Order: database,
then application.

`FIELD_ENCRYPTION_KEY` is **not** in the database. A restore without the
matching key leaves every encrypted field unreadable. Confirm the key is
recoverable before you need it.

### 9.3 Host reboot durability — PROPOSED (not rehearsed)

Docker's `restart: unless-stopped` restarts containers and never recreates them.
`prometheus` and `alertmanager` render their configuration into `tmpfs` mounts
that did not survive a kernel-change reboot on 2026-09-07 (incident record). The
candidate carries `scripts/recreate-runtime-services.sh` and
`infra/systemd/master-suite-recreate-runtime.service`, which recreate exactly
those two services at boot using the image tag read from the running web/worker
container, and refuse to run if that tag cannot be determined.

Install once (as root on the host):

```bash
install -m 0644 apps/web/infra/systemd/master-suite-recreate-runtime.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable master-suite-recreate-runtime.service
```

Validate after the next planned reboot:

```bash
systemctl status master-suite-recreate-runtime.service      # Result=success
docker inspect -f '{{.State.Health.Status}} restarts={{.RestartCount}}' infra-prometheus-1 infra-alertmanager-1
curl -fsS https://<APP_URL>/api/health/ready                 # web and worker back, database reachable
```

What was verified: the script's fail-closed branch — with no deployed web/worker
container it refuses to run rather than resolving images to `:dev`. What was
**not**: a real reboot, systemd ordering, or recreation of the two services; that
needs the production-shaped host.

---

## 10. Responsibilities

| Step | Owner |
| --- | --- |
| Approve the release scope | Client owner |
| §2 preflight, and the decision on its stop conditions | Production operator |
| §9.2 backup taken and **verified restorable** before §3 | Production operator |
| §3 migration | Production operator |
| §4 start order | Production operator |
| §5 backfill, per workspace | Production operator |
| §6–7 checks and smoke tests | Production operator, with one client agent and one client manager for 9–15 |
| Declaring the deployment good, or calling §9 | Client owner, on the operator's report |
| Approving §9.1.1 emergency rollback (integration candidate) | Client owner **and** designated security reviewer, in the change ticket |
| Executing §9.1.1 steps 1–6 and §9.1.2 | Two production operators — one executes, one reads back into the ticket |
| Re-issuing monitoring grants after §9.1.2 | A platform owner, for another person (self-issued grants are refused) |
| §9.3 reboot unit install and post-reboot validation | Production operator |
| First-day monitoring (§7 of the handover) | Named support contact |

The author of this release has **no production access and has run none of the
above against production.** Every figure quoted in this runbook was measured in
an isolated environment and is labelled as such.
