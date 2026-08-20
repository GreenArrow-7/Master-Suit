# Backup and recovery

Two stores hold customer data and **both** must be backed up:

| Store | Holds | Backed up by |
| --- | --- | --- |
| PostgreSQL | Every row of every tenant | `pg_dump -Fc` |
| Object storage (MinIO / S3) | Call recordings, HR documents, payslip attachments, biometric capture frames | `mc mirror` |

The database carries only the *metadata* of the objects. Restore it alone and
you get `Recording` rows pointing at audio that no longer exists, `Document`
rows pointing at contracts that are gone, and no way to tell from inside the
application that anything is missing.

Until 2026-08-20 the only documented procedure was a single `pg_dump` line in
`docs/DEPLOY-AZURE.md`. Object storage was not backed up at all — every call
recording and HR document existed in exactly one place, on one VM's disk.

---

## Taking a backup

```bash
cd apps/web/infra
BACKUP_PASSPHRASE='<from your secret store>' ../scripts/backup.sh /var/backups/master-suite
```

Produces `/var/backups/master-suite/<UTC timestamp>/`:

```
database.dump      pg_dump custom format
objects/           the bucket, mirrored object by object
manifest.txt       versions, row counts, object count, sha256 of each artefact
```

With `BACKUP_PASSPHRASE` set these become `database.dump.gpg` and
`objects.tar.gpg` (AES-256) and the plaintext is removed. Without it the script
warns loudly and continues — unencrypted is acceptable only while the backup
stays on a disk you already trust with the live data, which is to say only for
the minutes before you ship it.

**Ship it off the machine.** A backup on the same disk as the thing it backs up
is a copy, not a backup:

```bash
az storage blob upload-batch -d master-suite-backups -s /var/backups/master-suite/<stamp>
```

### Schedule

```cron
# 02:30 UTC daily, an hour before the retention sweep at 03:00 so a backup
# always precedes the deletions it would need to be restored from.
30 2 * * * cd /opt/master-saas/apps/web/infra && BACKUP_PASSPHRASE=... ../scripts/backup.sh /var/backups/master-suite >> /var/log/master-suite-backup.log 2>&1
```

Retention: 30 days, enforced by the object-storage lifecycle policy on the
destination container rather than by deleting locally.

---

## Proving a backup

An untested backup is a hope, not a control. This is the whole reason the drill
is a script and not a paragraph — written as prose it is somebody's afternoon,
so it slips, and the first real attempt happens during the incident.

```bash
cd apps/web/infra
BACKUP_PASSPHRASE='...' ../scripts/restore-verify.sh /var/backups/master-suite/<stamp>
```

It restores into `leadflow_restorecheck` and drops it again, so it never touches
the live database and is safe to run against production. Run it **weekly**, and
always against the backup the server took rather than one made by hand.

Exit 0 means all six checks passed:

| Check | Catches |
| --- | --- |
| sha256 against the manifest | A truncated or corrupted transfer |
| `pg_restore` without errors | A dump that failed part-way and was never noticed |
| Migration ledger clean and at head | A dump from before a migration the running code requires |
| Row counts reconcile with the manifest | A partial dump. Small gaps are writes between dump and manifest; a large one is a failure |
| Object count matches the manifest | The half that used to be absent entirely |
| Every non-vendor `Recording` has its object | Rows and bytes drifting apart in either direction |

The last check is the one worth understanding: it fails both when the backup is
missing objects the database expects, and when rows were deleted without their
objects. Those are opposite bugs and this catches them from opposite sides.

---

## Restoring for real

Never restore over a live database. The order is: new instance, verify,
repoint.

1. **Restore the snapshot into a new database instance**, never over the live
   one.
   ```bash
   dc exec -T postgres psql -U leadflow -d postgres -c 'CREATE DATABASE leadflow_restored;'
   gpg -d --passphrase "$BACKUP_PASSPHRASE" database.dump.gpg \
     | dc exec -T postgres pg_restore -U leadflow -d leadflow_restored --no-owner
   ```
2. **Restore the objects** into the bucket the restored deployment will use.
   ```bash
   mc mirror --overwrite ./objects target/leadflow-documents
   ```
3. **`prisma migrate status`** against it — the ledger must be clean.
4. **Confirm row-level security survived.** A restore that loses
   `FORCE ROW LEVEL SECURITY` gives you a database with no tenant isolation:
   ```sql
   SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity;
   -- must be 0
   ```
   Then re-run the role grants: `master_saas_app` is a cluster-level role and
   survives, but a database restored `--no-owner` has none of its privileges.
5. **Point a staging deployment at it** and smoke-test sign-in plus one CRM
   read and one document download — the download is what proves the objects
   came back too.
6. **Only then** repoint production connection strings.

---

## What is deliberately not backed up

**Redis.** Cache and queue state. Every job is re-derivable and idempotent —
`lib/queue.ts` keys jobs by a hash of their payload — so a lost queue costs
delayed work, not lost work. The exception worth knowing: delayed SLA jobs are
lost with it, and nothing re-derives them.

**`.env.production`.** It holds `FIELD_ENCRYPTION_KEY`, which seals every stored
TOTP secret and provider credential. It belongs in a secret store with its own
backup, not in the same archive as the ciphertext it decrypts. A backup that
contains both the encrypted data and the key protecting it is unencrypted with
extra steps.

---

## Before a schema or data migration

Take a named snapshot and record the restore ID. `migrate deploy` has no
down-path: a genuine reversal means writing a *forward* migration, and pretending
otherwise on a live database is how data gets lost. Roll the application version
back first; restore data only when forward repair is unsafe, because restoration
discards every write after the recovery point.

**No migration is approved until its restoration procedure has been rehearsed.**

---

## Verification status

`scripts/restore-verify.sh` was exercised on 2026-08-20 against a PostgreSQL 16
cluster with the full 49-migration schema and seeded data. The database half
passed end to end: dump, restore into a scratch database, zero `pg_restore`
errors, all five reconciled row counts matching, the migration ledger at head
(49/49), and 174 tables still carrying `FORCE ROW LEVEL SECURITY` in the
restored copy.

**The object half has not been exercised.** `mc mirror` in both scripts is
written against MinIO's documented client and has not been run against a live
bucket. Run one full `backup.sh` → `restore-verify.sh` cycle on the deployment
before relying on it, and check that the object count in `manifest.txt` is not
zero — a silently empty mirror is the failure mode to look for.
