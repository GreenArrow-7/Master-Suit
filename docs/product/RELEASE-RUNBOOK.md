# Deployment runbook — YOUHAN ONE / Master Suite

One document, executed top to bottom by the production operator. Every command
is meant to be run as written. Nothing in here has been run against production
by the author of this document.

> **This runbook does not authorise a deployment.** It is the procedure to
> follow once the client owner has approved the release assessment
> ([`RELEASE-ASSESSMENT.md`](RELEASE-ASSESSMENT.md)). Read §0 and §9 before
> starting anything.

---

## 0. Identity of this release

| | |
| --- | --- |
| Release SHA | `c09cb43e6058e6d9244e8ddb4e5afdad87bfd3b2` |
| Branch | `claude/restructure-foundation` |
| Web image | `master-suite/web:c09cb43` — digest `sha256:45d6a416e5b8cc14cd598b17c49edaafbdec4c496cd0146be15cb017cc0b75b5` |
| Worker image | `master-suite/worker:c09cb43` — digest `sha256:b8168ab848f2da481842a6cf094e010b5877199492562cf791372882110b5f95` |
| Migrations added | 4 — see §3 |
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
> **one** migration (§3, #7) that **signs out every platform staff member** and
> retires their unused reset links, and it changes rollback again (§9.1.4). Evidence:
> `docs/product/RELEASE-CHECKPOINT-DUAL-CREDENTIAL.md`. Provisioning the designated
> identity is a separate, authorised step after release (§3.2) — nothing in this
> release creates a monitoring password or a grant.

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

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | The **application** role. Must be `NOBYPASSRLS`. |
| `MIGRATION_DATABASE_URL` | The **owning** role. Different database user from the line above — startup refuses if the two URLs match. |
| `REDIS_URL` | Must carry a password. `npm run check:redis-auth` is the gate. |
| `APP_URL` | The public HTTPS origin. Used for origin checks and for links in email; a wrong value produces working pages and unusable invitation links. |
| `TRUSTED_PROXY_CIDRS` | The addresses of the TLS terminator. **Startup refuses without it in production** — without it every request is attributed to the proxy, per-IP rate limiting collapses into one bucket and every audit row records `unknown`. |
| `FIELD_ENCRYPTION_KEY` | 32 bytes, base64. **Losing it makes encrypted fields unreadable** — it is not regenerable. Back it up with the database, not beside it. |
| `WEBHOOK_SIGNING_PEPPER` | As above. |
| `EMAIL_PROVIDER` + `SMTP_*` | A real SMTP host. Production refuses to start with `mock`. |
| `WHATSAPP_PROVIDER`, `ANTIVIRUS_PROVIDER` | Real providers. Production refuses `mock` for either. |
| `S3_*` | Object storage for documents and attendance captures. |
| `ALLOW_DEMO_SEED` | **Must be absent.** It gates the demo seed, which creates dozens of active logins. |

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

| Line | What to do |
| --- | --- |
| `unfinished migration rows` > 0 | **Stop.** A previous migration is half-applied; `migrate deploy` will refuse. Resolve it first. |
| `orphaned leadId references` > 0 | Expected and handled — the migration **detaches** them (sets `leadId` NULL), it does not delete them. Note the number; §3 verifies it afterwards. |
| `cross-workspace references` > 0 | **Stop and investigate.** A follow-up pointing at a lead in another workspace is a tenancy fault the foreign key cannot catch, and this release does not repair it. |
| `rules that will start failing` > 0 | **Stop.** An automation rule writes `nextFollowUpAt`, which this release refuses. Rewrite the rule first, or it will fail on its next run. |
| `Lead`/`Task`/`FollowUpTask` row counts | Sets the lock windows in §3. Judge them there. |
| `saved views mentioning it` > 0 | Not blocking. Those views show an explicit notice instead of filtering; tell the affected users (§7 of the assessment). |

---

## 3. Migration

Six migrations for the integration candidate, in this order (four for the
restructuring release alone). `prisma migrate deploy` applies them automatically —
the breakdown is here so the operator knows what each one locks. Confirm the
starting point first: `SELECT count(*) FROM "_prisma_migrations" WHERE finished_at
IS NOT NULL` is **65** at `main` / the incident RC and **69** at the restructuring
release; after this release it is **71**.

| # | Migration | What it does | Lock |
| --- | --- | --- | --- |
| 1 | `20260910190000_lead_triage_queue` | New table `LeadTriageEntry`, 2 enums, 7 indexes | New table — nothing existing is locked |
| 2 | `20260911100000_triage_idempotency_and_outbox` | New tables `IdempotentRequest`, `NotificationOutbox`; 1 column on the new `LeadTriageEntry` | As above |
| 3 | `20260911150000_follow_up_lead_relation` | Detaches orphans; adds the FK **`NOT VALID`**; 2 indexes on `Task` and `FollowUpTask` | The `NOT VALID` add is brief. **The two `CREATE INDEX` statements take a `SHARE` lock on `Task` and `FollowUpTask` for the build — writes to those two tables wait, reads do not.** |
| 4 | `20260911150500_follow_up_lead_relation_validate` | `VALIDATE CONSTRAINT` | `SHARE UPDATE EXCLUSIVE` — **does not block writes** |
| 5 | `20260911160000_platform_monitoring_grants` | Enum `PlatformGrantKind`; column `PlatformAccessGrant.kind` (default `READ`); **every existing grant row set to `WRITE`** (all pre-existing rows were break-glass); index replaced; new table `PlatformCoverageGrant` with its grant to the application role | `ACCESS EXCLUSIVE` on `PlatformAccessGrant` for the column add, index swap and update — a small, rarely-written table; staff grant checks wait for it, customer traffic does not touch it |
| 6 | `20260911160500_monitoring_sensitive_scope` | Column `sensitive` on both grant tables (default `false`); existing `WRITE` rows set `sensitive = true` | As 5, on both grant tables |

**Migrations 5–6 create no authority.** No coverage row is created; every
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

### 3.1a Dual-credential migration (#7)

| # | Migration | What it does | Lock |
| --- | --- | --- | --- |
| 7 | `20260914120000_dual_credential_sessions` | Enum `PlatformCredentialPurpose`; columns `PlatformUser.passwordVersion` (default 1), `monitoringPasswordHash` (NULL), `monitoringPasswordVersion` (default 0), `monitoringPasswordSetAt`; `PlatformSession.credentialPurpose` / `credentialVersion` (NULL); `PasswordResetToken.credentialPurpose` (NULL); new table `PlatformMfaChallenge` with its grant to the application role. **Revokes every live session of an OWNER, SUPPORT or SECURITY_AUDITOR identity** (`revokedReason = 'CREDENTIAL_PURPOSE_MIGRATION'`, `AI_SERVICE` sessions excluded) and marks their unused reset links used. | `ACCESS EXCLUSIVE` on `PlatformUser`, `PlatformSession` and `PasswordResetToken` for the column adds (metadata-only with constant defaults on Postgres 16) and the two updates. Every request resolves a session, so sign-in and session checks wait for the transaction; keep it in the same quiet window as the rest. |

**It creates no authority.** No monitoring password, no grant, no coverage. A staff
session issued before it carries no credential purpose and the new release refuses
such a session rather than guessing that it was administration — the migration
revokes them up front so the refusal is not a surprise mid-shift. **Tell platform
staff before the window: they sign in again, with MFA.** Customer (`USER`) sessions
and reset links are untouched. Finished migrations afterwards: **72**.

Verify (owner role, read-only):

```sql
SELECT count(*) FROM "PlatformUser" WHERE "monitoringPasswordHash" IS NOT NULL;      -- expect 0
SELECT count(*) FROM "PlatformSession" s JOIN "PlatformUser" u ON u.id = s."platformUserId"
 WHERE s."revokedAt" IS NULL AND s."expiresAt" > now() AND s.purpose <> 'AI_SERVICE'
   AND u."platformRole" IN ('OWNER','SUPPORT','SECURITY_AUDITOR');                    -- expect 0
SELECT count(*) FROM "PlatformMfaChallenge";                                          -- expect 0
-- PlatformAccessGrant and PlatformCoverageGrant row counts unchanged from §2.
```

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
curl -fsS https://<APP_URL>/api/health/live   # process is up
curl -fsS https://<APP_URL>/api/health/ready  # database and Redis reachable
```

Then these, by hand, as a **real client account** — not the demo account:

| # | Smoke test | Pass condition |
| --- | --- | --- |
| 1 | Sign in as an agent | Reaches the workspace |
| 2 | Sign out, then open a workspace URL | Redirected to login, not a 500 |
| 3 | Sign in as an agent and open a page their role forbids | "You do not have permission", not an error page |
| 4 | Create a lead | Appears in the list |
| 5 | Assign it to an agent | Owner shows on the row |
| 6 | Create a follow-up on it | The **Follow-up** column shows that date within one page refresh |
| 7 | Reschedule it | The column moves to the new date |
| 8 | Complete it | The column reads **No action assigned to you** |
| 9 | Open `/leads?filter=overdue` as an agent | Only leads with **their own** overdue work |
| 10 | The same as a manager | `Overdue · team` and `Overdue · mine` are separate chips and return different sets |
| 11 | Open the leads list on a phone | The follow-up state is visible; no horizontal scrolling |
| 12 | An employee opens self-service | Their own record, not somebody else's |
| 13 | An employee submits a leave request | Appears in the manager's queue |
| 14 | The manager approves it | State changes and the employee sees it |
| 15 | Clock in / clock out | Attendance records, capture stored |
| 16 | Worker processing | Create an unassignable lead; within 5 minutes it appears in the triage queue |
| 17 | Notification recovery | Stop the worker mid-sweep, start it again; the pending notice is delivered exactly once in-app |

Stop and consider rollback if **any of 1–8, 12–14 or 16** fails. Those are the
workflows the client uses daily.

---

## 8. Stop conditions

Stop immediately, and do not proceed to the next step, if:

- The preflight reports unfinished migrations, cross-workspace references, or an
  automation rule that writes `nextFollowUpAt`.
- `FollowUpTask` row count **falls** across the migration.
- `/api/health/ready` does not return success within 2 minutes of start.
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

> **Integration candidate: application rollback is NOT a normal operation.**
> Every release this candidate can roll back to — `main` (`f16ed67`), the incident
> RC (`f585e48`) and the restructuring release (`d5eef50`) — has the same platform
> staff code, and it cannot hold the monitoring boundary:
>
> - its enter route admits **any OWNER to any workspace, with no grant**;
> - a staff session inside a workspace gets **every `VIEW` permission, HR and
>   payroll included**, with no grant checked on the request;
> - it ignores grant `kind`, so **any live grant an OWNER holds is full write
>   control** — including a monitoring READ grant issued by a second owner.
>
> Each of these was **demonstrated** against the previous release in the isolated
> rehearsal. Revoking grants does not fix the first two. The only boundary that
> release still enforces for staff is **account status**, checked at sign-in and
> on every session.
>
> **Preferred: roll forward.** Fix the defect on the candidate line and release
> again. **Only if roll-forward is impossible** (for example, the release cannot
> serve customers at all), use the emergency procedure in §9.1.1, which rolls the
> application back with **all platform staff workspace access suspended**. Customer
> accounts are unaffected; platform administration is unavailable until §9.1.2.

#### 9.1.1 Emergency rollback with staff access suspended — VERIFIED (isolated)

**Authorisation, before anything is touched:** a change ticket naming the reason
roll-forward is not possible; approval by the client owner **and** the designated
security reviewer; two operators, one executing and one reading back each step
into the ticket. Record the ticket id — it goes into every audit row (`<CHG>`
below). **`<CHG>` must be unique to this rollback.** §9.1.2 restores accounts by
selecting on it; a reused id restores accounts suspended by an earlier change too
(the rehearsal reproduced exactly that before the id was made unique).

1. **Freeze.** Announce it. Stop the **web** tier and the **workers** of the
   candidate. With the web tier stopped nothing can issue a grant, open a session
   or enter a workspace. *(Rehearsed: the grant route is unreachable.)*
2. **Back up** (§9.2) and verify it restores. Do not skip.
3. **Identify** every live item the old release would honour, with the owner role,
   read-only, and paste the output into the ticket. This includes anything issued
   during the deployment window — there is no time filter:

   ```sql
   SELECT g.id, u."platformRole", g.kind, g.sensitive, g."tenantId", g."grantedAt"
     FROM "PlatformAccessGrant" g JOIN "PlatformUser" u ON u.id = g."platformUserId"
    WHERE g."revokedAt" IS NULL AND g."expiresAt" > now();
   SELECT id, "platformUserId", sensitive, "grantedAt", "grantedById"
     FROM "PlatformCoverageGrant" WHERE "revokedAt" IS NULL AND "expiresAt" > now();
   SELECT s.id, u."platformRole", s."activeTenantId"
     FROM "PlatformSession" s JOIN "PlatformUser" u ON u.id = s."platformUserId"
    WHERE s."revokedAt" IS NULL AND s."expiresAt" > now()
      AND u."platformRole" IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR');
   SELECT id, email, "platformRole" FROM "PlatformUser"
    WHERE "platformRole" IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR')
      AND status = 'ACTIVE' AND "deletedAt" IS NULL;
   ```

4. **Remediate in one transaction, scoped to exactly the ids from step 3** — revoke
   those grants, coverage and sessions; set those identities to `SUSPENDED`; write
   one `ROLLBACK_STAFF_ACCESS_SUSPENDED` audit row per identity
   (`metadata: {"change": "<CHG>", "priorStatus": "ACTIVE", "role": …}`) and one
   `ROLLBACK_ACCESS_REMEDIATION` summary row listing every id. Each `UPDATE` keeps
   its state predicate (`"revokedAt" IS NULL`, `status = 'ACTIVE'`), and the
   affected-row counts must equal the step-3 counts — if not, `ROLLBACK` and
   return to step 3. The rehearsed statements are in
   `docs/product/RELEASE-CHECKPOINT-MONITORING-INTEGRATION.md` §6.
   **`USER` and `AI_SERVICE` identities are not touched** (service credentials
   behave on the old release as they did before this candidate).
5. **Roll back the application:** `scripts/release.sh rollback production`.
6. **Verify on the rolled-back release** (rehearsed): every staff identity is
   refused at sign-in; the pre-rollback staff sessions are refused (no workspace
   read, no HR, no write); a real customer account signs in and reads its leads
   and HR normally.

#### 9.1.2 Returning staff access — VERIFIED (isolated)

After the candidate line is released again (roll forward): restore **only** the
identities the change suspended — the `objectId`s of its
`ROLLBACK_STAFF_ACCESS_SUSPENDED` rows — back to `ACTIVE`, in one transaction,
writing a `ROLLBACK_STAFF_ACCESS_RESTORED` row. Grants stay revoked: each one is
re-issued deliberately by a second person. *(Rehearsed: staff sign in again and see
no workspace until re-granted.)*

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

**So no schema change prevents restarting the older application.** For the
restructuring release alone, application rollback needs no database recovery.
**For the integration candidate the schema is equally compatible** — migrations
5–6 add columns with defaults and a table the old application never queries, and
the previous release booted, served sign-in and read data against the migrated
schema in the rehearsal — **but §9.1's staff-access procedure is mandatory**.
Compatibility of the four restructuring tables with `main` or the incident RC was
not re-rehearsed for this candidate.

#### 9.1.4 Dual-credential release — rollback targets and session safety — VERIFIED (isolated)

**No earlier release is a safe rollback target by image swap alone.** Every release
before this candidate — `05a7b90` / `9df91d8`, the restructuring release, the incident RC
and `main` — ignores `PlatformSession.credentialPurpose`. It resolves a session by
role, so **a live monitoring session of an OWNER becomes a full owner session** on
the old release: console, workspace creation, grants and (for those releases)
everything §9.1 lists. Demonstrated against `05a7b90` on isolated systems, with the
remediation and roll-forward below — checkpoint §5. The monitoring *password*
itself is harmless there: the old sign-in reads only `passwordHash`, so password B
signs in nowhere.

| Target | Schema | Verdict |
| --- | --- | --- |
| `05a7b90` / `9df91d8` (integration candidate) | compatible — #7 adds nullable/defaulted columns and a table the old code never reads | **Unsafe by image swap.** Allowed only through §9.1.1, whose step 3–4 revoke every staff session (monitoring sessions included) and suspend staff. |
| restructuring release, incident RC, `main` | as §9.1.3 | Unsafe — §9.1 already applies; this release adds the monitoring-session case to it. |
| No down-migration is provided or needed | — | Do not drop the new columns: roll-forward relies on them. |

**If rollback is authorised (inside §9.1.1, after step 1 has stopped the web tier)**,
additionally, in the same transaction as step 4, and paste the counts into the ticket:

```sql
UPDATE "PlatformSession" SET "revokedAt" = now(), "revokedReason" = 'ROLLBACK_MONITORING_SESSION'
 WHERE "credentialPurpose" = 'MONITORING' AND "revokedAt" IS NULL;
DELETE FROM "PlatformMfaChallenge" WHERE "consumedAt" IS NULL;
-- expect afterwards:
SELECT count(*) FROM "PlatformSession"
 WHERE "credentialPurpose" = 'MONITORING' AND "revokedAt" IS NULL AND "expiresAt" > now();   -- 0
```

Keep the monitoring password hashes and versions: they grant nothing on the old
release and let roll-forward restore monitoring without re-provisioning.

**Roll-forward to this release** needs no data step for sessions: every session the
old release issued carries no credential purpose and is refused (and revoked as
`LEGACY_SESSION_WITHOUT_CREDENTIAL_PURPOSE`) — staff sign in again with MFA. Two
things to check first, owner role:

- A password changed or reset **by the old release** did not advance
  `passwordVersion`. The old release revoked that identity's sessions itself, so no
  stale session survives; nothing to do.
- If the old release set an administration password equal to that person's
  monitoring password, sign-in refuses both and records `LOGIN_CREDENTIAL_AMBIGUOUS`.
  Clear the monitoring password for that identity under the ticket
  (`monitoringPasswordHash = NULL, monitoringPasswordSetAt = NULL,
  monitoringPasswordVersion = monitoringPasswordVersion + 1`), and the person sets a
  new one (§3.2).

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
