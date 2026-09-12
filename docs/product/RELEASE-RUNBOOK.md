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

|                           |                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release SHA               | `bbfb8ae70bd60017ccfc26f8e5197b1c970a9d74` (candidate of 12 Sep 2026; supersedes `c09cb43`, which predates the booking fix)                                                                                                                                                                       |
| Branch                    | `claude/restructure-foundation`                                                                                                                                                                                                                                                                   |
| Web image                 | `master-suite/web:bbfb8ae` — digest `sha256:7bc7250394cdeffe1e46f4a0818bfd9e12b6ade6a9c3c2b6d29c4f7a0d293a2e`                                                                                                                                                                                     |
| Worker image              | `master-suite/worker:bbfb8ae` — digest `sha256:cf6810836a3aad27908422a175a338c24bb2bcc2d0aed51f7d70147134700e19`                                                                                                                                                                                  |
| Migrations added          | 6 — see §3                                                                                                                                                                                                                                                                                        |
| Previous deployed version | **Confirm before starting.** `scripts/release.sh status` on the VM reports what is running and what can be rolled back to. This runbook assumes the deployed version is at or after `main` (`f16ed67`); if it is older, stop and re-inventory — there will be more than four migrations to apply. |

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

Six migrations, in this order. `prisma migrate deploy` applies them
automatically — the breakdown is here so the operator knows what each one locks.

| #   | Migration                                          | What it does                                                                                                       | Lock                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `20260910190000_lead_triage_queue`                 | New table `LeadTriageEntry`, 2 enums, 7 indexes                                                                    | New table — nothing existing is locked                                                                                                                                                                                                                                           |
| 2   | `20260911100000_triage_idempotency_and_outbox`     | New tables `IdempotentRequest`, `NotificationOutbox`; 1 column on the new `LeadTriageEntry`                        | As above                                                                                                                                                                                                                                                                         |
| 3   | `20260911150000_follow_up_lead_relation`           | Detaches orphans; adds the FK **`NOT VALID`**; 2 indexes on `Task` and `FollowUpTask`                              | The `NOT VALID` add is brief. **The two `CREATE INDEX` statements take a `SHARE` lock on `Task` and `FollowUpTask` for the build — writes to those two tables wait, reads do not.**                                                                                              |
| 4   | `20260911150500_follow_up_lead_relation_validate`  | `VALIDATE CONSTRAINT`                                                                                              | `SHARE UPDATE EXCLUSIVE` — **does not block writes**                                                                                                                                                                                                                             |
| 5   | `20260912020000_booking_unit_exclusivity`          | `Booking_confirmed_requires_unit` (CHECK, `NOT VALID`) and `Booking_one_confirmed_per_unit` (partial unique index) | The `NOT VALID` add is brief. **`CREATE UNIQUE INDEX` takes a `SHARE` lock on `Booking` for the build — writes to `Booking` wait, reads do not.** The index covers only live confirmed rows, so the build is proportional to confirmed sales, not to every booking ever written. |
| 6   | `20260912020500_booking_unit_exclusivity_validate` | `VALIDATE CONSTRAINT` on the CHECK                                                                                 | `SHARE UPDATE EXCLUSIVE` — **does not block writes**                                                                                                                                                                                                                             |

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

### 9.1 Application rollback — the normal case

```bash
scripts/release.sh rollback production
```

**The previous application version runs correctly against the new schema.** This
was checked, not assumed:

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

### 9.2 Database recovery — only for data loss

Needed only if data is wrong or missing, not merely if the release misbehaves.

```bash
scripts/backup-ship.sh              # take one NOW, before anything else
scripts/restore-verify.sh           # restore into a scratch database and compare
```

Restoring a backup taken **before** the migration returns the schema to its
previous shape, so the **new** application will not run against it — the new code
expects `LeadTriageEntry` and the rest. After a database restore you must also
roll the application back (§9.1). Do them in that order: database, then
application.

`FIELD_ENCRYPTION_KEY` is **not** in the database. A restore without the
matching key leaves every encrypted field unreadable. Confirm the key is
recoverable before you need it.

---

## 10. Responsibilities

| Step                                                    | Owner                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| Approve the release scope                               | Client owner                                                               |
| §2 preflight, and the decision on its stop conditions   | Production operator                                                        |
| §9.2 backup taken and **verified restorable** before §3 | Production operator                                                        |
| §3 migration                                            | Production operator                                                        |
| §4 start order                                          | Production operator                                                        |
| §5 backfill, per workspace                              | Production operator                                                        |
| §6–7 checks and smoke tests                             | Production operator, with one client agent and one client manager for 9–15 |
| Declaring the deployment good, or calling §9            | Client owner, on the operator's report                                     |
| First-day monitoring (§7 of the handover)               | Named support contact                                                      |

The author of this release has **no production access and has run none of the
above against production.** Every figure quoted in this runbook was measured in
an isolated environment and is labelled as such.
