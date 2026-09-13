# Operator evidence — commands, expected results, stop conditions

> **Superseded for audit and restore commands (14 September 2026):** use `OPERATOR-CHECKLIST.md`. It runs the audits in the `migrate` service with read-only, role-checked connections and uses the guarded restore script, all verified locally against the baseline.

**For the production operator. Nothing here has been run against production by this work; every result column is empty until the operator fills it in.** Engineering state is in `COLLECTIONS-CHECKPOINT-2026-09-12.md`; this file is only what needs a production host or a production backup.

Conventions used throughout:

- `«owner-url»`, `«passphrase»`, `«remote»` — **placeholders**. Inject them from the secret store your host uses. `secret-get` in earlier drafts was **not an installed command**; it was a placeholder and is not used below.
- All commands run from `apps/web` on the deployment host at the candidate revision, unless a script header says otherwise (`backup.sh` and `restore-verify.sh` are written to be run as `../scripts/…` from the backup directory's parent — their own usage lines are quoted).
- Never paste a connection string, passphrase or token into chat, a ticket, or a commit. Paste the scripts' output; it is designed to contain none of them.

Every script below was run in this environment against the validation database to prove it executes with the arguments shown; the argument forms were read from the scripts' own usage text, not remembered.

---

## 1. Who

| Needs                                                                      | Held by                                   |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| Production database **owner** connection string (`MIGRATION_DATABASE_URL`) | Production operator, via the secret store |
| Shell on the deployment host (Docker Compose, `scripts/release.sh`)        | Production operator                       |
| Production backup directory and `BACKUP_PASSPHRASE` / `BACKUP_REMOTE`      | Production operator                       |
| Alertmanager recipient mailbox (`ALERT_PAGE_EMAIL_TO`)                     | Whoever is on call                        |
| Client workspace administrator account                                     | Client administrator                      |

If any of these is unavailable, the row that needs it stays **blocked**, and this file says so rather than the checkpoint saying "pending".

## 2. Read-only preflight and audits — before the migration

### 2.1 Deployed version

```bash
scripts/release.sh status
```

Expected: the running tag and the previous tag, both resolvable images on the host. **Stop** if the running tag is older than `main` (`f16ed67`) — the migration inventory in the runbook assumes at-or-after `main` and would be wrong.

### 2.2 Preflight

```bash
MIGRATION_DATABASE_URL='«owner-url»' node scripts/rc-preflight.mjs
```

| Line                                              | Meaning for the affected records                                                                                                                                                                                                                                                                                                                                                    | Continue / Stop                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unfinished migration rows`                       | A migration row with no `finished_at`: a previous deploy died mid-migration. `migrate deploy` refuses until resolved.                                                                                                                                                                                                                                                               | **Stop** if > 0                                                                                                                                                                                                                                           |
| `constraint already present`                      | The follow-up FK exists: this is a re-run, migrations 3–4 will no-op.                                                                                                                                                                                                                                                                                                               | Continue                                                                                                                                                                                                                                                  |
| `orphaned leadId references`                      | Follow-ups whose `leadId` points at a lead that no longer exists. **Migration 3 sets their `leadId` to NULL — the rows are kept, they simply stop claiming a lead.** They remain visible on the follow-up list under their owner; they disappear from lead screens (they were never reachable there anyway, the lead is gone). No commission, booking or HR record references them. | Continue **if** the operator records the count and confirms after migration (runbook §3.1) that exactly that many were detached. **Stop** if the count is a material fraction of `FollowUpTask` — that suggests a bulk lead deletion nobody has explained |
| `cross-workspace references`                      | A follow-up whose lead belongs to **another workspace**: a tenancy fault. The FK cannot express "same tenant", so the migration does not repair it; RLS means the follow-up's owner sees a dangling reference.                                                                                                                                                                      | **Stop** if > 0 — each row needs a human to decide which workspace it belongs to                                                                                                                                                                          |
| `already detached (leadId IS NULL)`               | Rows already in the post-migration state.                                                                                                                                                                                                                                                                                                                                           | Continue                                                                                                                                                                                                                                                  |
| `live leads`, `already correct`                   | Leads whose `nextFollowUpAt` already equals the derived value.                                                                                                                                                                                                                                                                                                                      | Continue                                                                                                                                                                                                                                                  |
| `work no overdue screen can see` (_missing_)      | Leads with an open obligation but a NULL `nextFollowUpAt`: **an agent's overdue work is invisible until the backfill runs.**                                                                                                                                                                                                                                                        | Continue; **remediated by the backfill** (runbook §5), which is mandatory after deploy, not optional                                                                                                                                                      |
| `showing the wrong date` (_stale_)                | Leads whose displayed date is not the earliest open obligation: the list sorts and counts on a wrong value.                                                                                                                                                                                                                                                                         | Continue; remediated by the backfill                                                                                                                                                                                                                      |
| `showing a date with nothing open` (_unexpected_) | Leads that appear to have work when nothing is open: agents chase closed items.                                                                                                                                                                                                                                                                                                     | Continue; remediated by the backfill                                                                                                                                                                                                                      |
| `automation versions` / `update_field targets`    | Informational.                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                                         |
| `rules that will start failing`                   | An automation rule writes `nextFollowUpAt`, which the release now refuses (`ProtectedFieldError`). **It will fail on its next run, silently to the agent.**                                                                                                                                                                                                                         | **Stop** if > 0 — rewrite the rule first                                                                                                                                                                                                                  |
| `saved views mentioning it`                       | Saved views filtering on the withdrawn field: the user sees a notice and an unfiltered list.                                                                                                                                                                                                                                                                                        | Continue; tell those users (handover guide §5)                                                                                                                                                                                                            |

**Explicit acceptance needed** (not a blanket "continue"): the orphan count, the three drift counts, and the saved-view count are each **recorded in the ticket** by the operator and confirmed remediated after the backfill. Cross-workspace rows and failing rules are never accepted; they are fixed first.

### 2.3 Booking audit

```bash
MIGRATION_DATABASE_URL='«owner-url»' node scripts/rc-booking-audit.mjs   # exit 1 on a stop condition
```

| Line                                                            | Meaning                                                                                                                   | Continue / Stop                                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Units carrying more than one live confirmed booking`           | A double-sale already in the data. `CREATE UNIQUE INDEX` **will fail** and roll migration 5 back.                         | **Stop** if any; each pair is the client's decision (which sale stands)                                                                                                                     |
| `Live confirmed bookings naming no unit`                        | Migration 6 (`VALIDATE CONSTRAINT`) **will fail**.                                                                        | **Stop** if any; each row is given its unit or returned to `DRAFT`, by the client                                                                                                           |
| `confirmed sales whose unit still reads available/held/blocked` | Historical: confirmation never touched inventory before. **These units can still be sold again by the unit route today.** | **Record the count and the references.** Remediation: move each unit to `BOOKED` through `PATCH projects/{id}/units/{unitId}` by an administrator, _after_ deployment. Not a blanket accept |

### 2.4 Collections legacy audit

```bash
MIGRATION_DATABASE_URL='«owner-url»' node scripts/rc-collections-legacy-audit.mjs
```

| Line                                                         | Meaning                                                                                                                                | What finance decides                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bookings with a legacy `collectedAt` and no verified receipt | "Collected" rested on a button press                                                                                                   | Record the real receipt (amount, date, reference, evidence) and have it verified — or accept that the sale is not collected                           |
| Commissions `COLLECTED`/`PAID` on uncovered bookings         | The payout gates **now refuse** to approve or pay runs containing the unpaid ones; the paid ones are history and are listed for review | For `COLLECTED`: record receipts or expect the run to stay blocked. For `PAID`: review; a recovery case is _not_ opened automatically for legacy rows |
| Unpaid payouts containing them                               | Will be refused at `APPROVED`/`PAID` with `not_covered`                                                                                | As above                                                                                                                                              |
| Confirmed bookings with no agreed agency fee                 | Nothing can be measured against them; not eligible                                                                                     | Needs the amendment decision in the checkpoint §1                                                                                                     |

**Stop condition — revised 12 September evening:** any row in sections 2 or 3 is an **operational migration issue that must be reviewed before release**, not a guard that worked. Those runs and commissions will be refused at approval and payment the moment the candidate is deployed; if finance has not worked the list first, real payouts stop on day one. The deploy does not fail on it; the release decision should.

### 2.5 P&L — exact defects, so acceptance is of something specific

`src/services/leadership/pl.ts`:

| Line                                                               | Defect                                            | Impact on the number shown                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `:76` `status: { not: 'CANCELLED' }`                               | `DRAFT` bookings count as revenue                 | Revenue includes sales that have not been confirmed; a draft typed in error inflates the period until cancelled                                |
| `:227` payslips selected by period only, no `run.status` filter    | Unapproved or rejected payroll runs count as cost | Cost includes payroll that was never paid; margin understated                                                                                  |
| `:236` payroll attributed via `salesUser.teams` (**current** team) | A transfer restates closed periods                | Last quarter's cost moves to the employee's new team; the booking side was fixed to freeze placement at confirmation, the payroll side was not |

Not fixed in this candidate. **Acceptance being requested:** that the P&L screen ships with these three behaviours, stated in the handover guide in these words. If not accepted, P&L is excluded from the release scope table and the three fixes are scheduled (≈1 day + gate cycle).

## 3. Migration, backup, recovery

### 3.1 Backup restored into an isolated target — production topology, no destructive step

The product's own chain, run **on the production host**, restoring into a scratch database and scratch bucket prefix that the script creates and drops (`restore-verify.sh` header: "This never touches the live database or the live bucket"):

```bash
# 1. take a fresh backup (the scheduled unit does this; run it by hand for the drill)
BACKUP_PASSPHRASE='«passphrase»' ../scripts/backup.sh /var/backups/master-suite

# 2. prove the off-host copy, not the local one
BACKUP_PASSPHRASE='«passphrase»' BACKUP_REMOTE='«remote»' \
  ../scripts/restore-verify.sh --prefer-remote /var/backups/master-suite/latest
```

Expected: exit 0; the reconciliation section reports counts matching the manifest; `FIELD_ENCRYPTION_KEY` confirmed recoverable from the secret store (not from the backup — it is not in it). **Stop** if the remote copy cannot be restored or the manifest does not reconcile: the backup is a hope, not a control.

**What this work did instead, and what it does not prove:** a `pg_dump -Fc`/`pg_restore` of the validation database (counts, FK, RLS, migrations intact — `restore-rehearsal.txt`) and the transport checks 11/11 (`backup-restore.log`). That proves the mechanism on a laptop; it does not prove the production backup, the passphrase in the secret store, or the remote.

### 3.2 Recovery decision — by integrity and compatibility, not by reflex

| Situation                                                               | Response                                                                                                                                  | Why                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application fault, data intact                                          | **Roll forward** on the candidate (hotfix commit → gates → `release.sh production <commit>`)                                              | `main` is compatible with the migrated schema for everything except unitless confirmation and a second sale of a sold unit, which the constraints refuse as a 500 in the old code (runbook §9.1). Rolling back trades one fault for a known one |
| Application fault, data intact, roll-forward not possible in the window | **Compatible rollback** `scripts/release.sh rollback production` with the two 500s accepted for the window                                | Documented exposure, no data loss                                                                                                                                                                                                               |
| Data corrupted or lost by the release                                   | **Database recovery** to the pre-deployment backup, **then** application rollback (schema shape), **then** re-apply what the restore lost | The order matters: the new code expects the new tables                                                                                                                                                                                          |
| Data corrupted by something unrelated to the release                    | Database recovery; application stays                                                                                                      |                                                                                                                                                                                                                                                 |

**Re-applying what a restore loses.** `scripts/rc-post-deploy-delta.mjs '«deployment instant»'` lists, per table and per workspace, rows created or modified since the instant, with money state separated. That is the _list_. The **audit log is not a replay mechanism**: it records events, objects and field values, but not ordering across concurrent writers beyond timestamps, not idempotency keys, and not external side effects (emails, WhatsApp messages, webhook deliveries, object-storage writes). Re-entry is manual, from that list, with the audit log as a reference — and the external side effects (a welcome email already sent, a receipt document already uploaded) are not re-done by anyone. This is a stated limitation, not a solved problem.

### 3.3 Recovery rehearsal with an actual compatible candidate — on staging

```bash
scripts/release.sh staging 3dc115a          # deploy the candidate
# make one change of each kind through the UI/API: a lead, a follow-up, a booking with a unit, a receipt
scripts/release.sh rollback staging               # start the previous tag (main) against the migrated schema
# exercise: lead list, follow-up complete, booking CONFIRM with a unit (works), booking CONFIRM without a unit (expected: 500 — record it)
scripts/release.sh staging 3dc115a          # roll forward again
```

Expected: everything but the two documented cases works under the old tag; the candidate comes back cleanly; the delta script shows the rows written during the drill. **Stop** if anything _other_ than the two documented cases fails under the old tag — that is an unknown incompatibility.

## 4. Monitoring alert delivery

Prometheus rules exist (`infra/prometheus-alerts.yml`: `ApplicationDown`, `QueueHasNoConsumer`, `TenantGuardTripped`, … 12 in all) and Alertmanager routes to email (`infra/alertmanager-entrypoint.sh`, `ALERT_PAGE_EMAIL_TO`). None has been seen to fire end to end.

```bash
# inject a synthetic alert straight into Alertmanager; expect one email at ALERT_PAGE_EMAIL_TO
docker compose -p master-suite -f infra/docker-compose.yml -f infra/docker-compose.prod.yml exec alertmanager \
  amtool alert add DeliveryDrill severity=info instance=drill --annotation=summary='alert delivery drill' --alertmanager.url=http://localhost:9093
```

Then the real path: stop the worker for two minutes and expect `QueueHasNoConsumer` to fire and arrive, then start it and expect the resolution.

Expected: both emails at the on-call address within the route's group interval. **Stop** if the drill email never arrives — the on-call path is not a path.

## 5. Accounts and role verification

- **Demo:** `demo@youhan.in` is retained **for the client-facing demo only**, on the demo workspace. It is a shared credential and is not a production user.
- **Production:** every person gets an individual account (handover guide §1). The client administrator creates them; each person completes the forced password change on first sign-in.

Verification, by the client administrator with the operator watching:

| Check                                                                                                              | Expected                              |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| A selling agent's account: `Sales → Leads` visible; `POST /api/v1/collections/receipts` → **403**                  | Agents cannot record receipts (D-8.1) |
| Finance account A records a receipt; finance account A verifies it → **403**; finance account B verifies → **200** | Two people, no exception (D-8.2)      |
| Finance account B builds a payout; finance account B approves it → **403**; account A approves → **200**           | Payout maker-checker preserved        |
| `demo@youhan.in` on the production workspace                                                                       | **Does not exist**                    |

## 6. Evidence table — to be filled by the operator

| Item                                   | Command / source | Result | Date | By  |
| -------------------------------------- | ---------------- | ------ | ---- | --- |
| Deployed version                       | §2.1             |        |      |     |
| Preflight counts + acceptances         | §2.2             |        |      |     |
| Booking audit                          | §2.3             |        |      |     |
| Collections legacy audit → finance     | §2.4             |        |      |     |
| P&L acceptance (or exclusion)          | §2.5             |        |      |     |
| Backup restore into isolated target    | §3.1             |        |      |     |
| Rollback/roll-forward drill on staging | §3.3             |        |      |     |
| Alert delivery drill                   | §4               |        |      |     |
| Accounts and role verification         | §5               |        |      |     |

Until every row has a result, **production remains NOT APPROVED**, whatever the gates say.
