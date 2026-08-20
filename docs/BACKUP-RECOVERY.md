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

### Off the machine

A backup on the same disk as the thing it backs up is a copy, not a backup: the
most likely reason to need it — the VM is gone — is also the reason it would not
be there. This used to be a line in this document asking you to run an upload by
hand, which is a step that happens until the week it does not, with nothing
anywhere noticing.

Set `BACKUP_REMOTE` and `backup.sh` copies each run off the machine itself, then
checks that it arrived:

```bash
BACKUP_REMOTE=s3://master-suite-backups/prod   # or any of the forms below
```

| Form | Uses | For |
| --- | --- | --- |
| `/mnt/nas/master-suite` | `cp` | a mount, a second volume, a USB disk |
| `file:///mnt/nas/master-suite` | `cp` | the same, written explicitly |
| `backups@host:/srv/master-suite` | `rsync` over ssh | another machine you control |
| `s3://bucket/prefix` | `aws s3 sync` | S3, MinIO, any S3-compatible store |
| `rclone:remote:path` | `rclone` | Azure Blob, B2, GCS, Dropbox — anything rclone speaks |

**The verification is the point, not the upload.** `aws s3 sync` and `rsync` both
exit 0 for a transfer that moved less than everything — a full disk at the far
end, a truncated object, a prefix typo that wrote somewhere nobody will look. So
every mode re-reads what landed and compares it against the manifest: full
checksums where the destination is readable from here, manifest round-trip plus
per-artefact sizes for object stores.

The manifest is copied **last**, after everything else has landed. A shipment
interrupted halfway therefore leaves a directory with no manifest, and both
`restore-verify.sh` and `backup-ship.sh` refuse a backup without one — so an
incomplete copy can never be mistaken for a complete one.

To re-ship a run by hand, or to check that an older copy is still intact:

```bash
scripts/backup-ship.sh /var/backups/master-suite/<stamp>                 # ship and verify
BACKUP_SHIP_VERIFY_ONLY=1 scripts/backup-ship.sh /var/backups/...        # verify what is there
```

The second is worth running occasionally on its own. Bit rot on a cheap remote
disk is real, and no upload-time check can catch something that decayed after it
arrived.

The scheduled unit sets `BACKUP_REQUIRE_REMOTE=1`, so a scheduled backup with no
destination configured refuses at preflight rather than after an hour of
dumping. And `backup-status.sh` **fails** — not warns — when the newest complete
backup has no `.shipped-at`, because a backup that never left is not a weaker
backup, it is no backup at all for the failure it exists for.

### Schedule

Installed, not documented:

```bash
sudo apps/web/scripts/install-backup-schedule.sh /var/backups/master-suite
```

That writes six systemd units and starts three timers:

| Timer | When | What it does |
| --- | --- | --- |
| `master-suite-backup` | 02:30 daily | `backup.sh`, with encryption required |
| `master-suite-restore-verify` | Sun 04:00 | `restore-verify.sh` against `latest` |
| `master-suite-backup-status` | 09:00 daily | fails if the newest backup is stale |

02:30 is half an hour before the maintenance worker's retention sweep at 03:00,
so a backup always precedes the deletions you would need it to undo. Sunday
04:00 is after both.

The passphrase and the retention settings live in `/etc/master-suite/backup.env`
(mode 600, root-owned), not in the unit files — unit files are world-readable
and `systemctl cat` prints them.

**The scheduled run refuses to write an unencrypted backup.** The unit sets
`BACKUP_REQUIRE_ENCRYPTION=1`, and `backup.sh` checks it in the preflight rather
than at the encryption step: refusing after the dump and mirror have run would
waste the hour *and* leave a plaintext copy of every customer's record sitting in
the destination directory, which is the outcome the flag exists to prevent.

#### Why systemd and not the cron line that used to be here

Three properties cron does not have, each matching a way a backup schedule
silently stops working:

- `Persistent=true` — a VM that was off at 02:30 runs the backup at the next
  boot. Cron skips the day and says nothing.
- `systemctl --failed` — a failed run is visible in one command and stays
  visible. Cron mails root, on a host with no MTA.
- `systemctl list-timers` — "when did this last run, when does it next run" is a
  question with an answer.

#### Retention

30 days, enforced by `backup.sh` itself after a successful run, with two guards
because a prune is the only step here that destroys data:

- It runs only once a manifest has been written, so a failed backup can never be
  the thing that clears the older ones.
- `BACKUP_KEEP_MIN` (default 3) backups survive whatever their age. If the
  schedule broke forty days ago, an age-only rule would delete every backup in
  existence on the day somebody noticed.

Only directories matching the `20260820T023000Z` stamp pattern are considered —
a partial transfer, a mount point or an operator's notes directory in the same
root is left alone. Set `BACKUP_RETENTION_DAYS` in `/etc/master-suite/backup.env`.

If you also ship backups to object storage, keep a lifecycle policy on that
container as well; this prunes the local copies only.

#### Noticing that backups have stopped

A backup job that stops running is silent by construction — nothing errors, and
the directory that was there yesterday is still there, just not getting any
newer. The usual way it is discovered is during a restore.

`scripts/backup-status.sh` asks the one question the backup unit cannot answer
about itself: is there a *complete* backup on disk newer than
`BACKUP_MAX_AGE_HOURS` (default 48)? A failing run shows as a failed service; a
timer that never fired at all — masked, disabled, host off, clock moved —
produces no failed service, because no service ran.

```bash
systemctl --failed                                  # on the VM
apps/web/scripts/backup-status.sh /var/backups/master-suite   # by hand
```

It also refuses to count a run with no manifest, or a manifest with no dump
beside it, as the newest backup — a half-finished run must not hide the fact
that the last complete one is older.

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

### Prove the copy you would actually use

The weekly timer verifies the backup on **this** disk. In the disaster this
exists for, that disk is gone and the copy you restore from is the off-host one
— so at least once, prove that copy restores, not just the local original:

```bash
# a path-shaped BACKUP_REMOTE (a mount, a second volume) needs no fetch:
scripts/restore-verify.sh /mnt/nas/master-suite/<stamp>

# an object store: pull one back first, then verify it exactly as above
aws s3 sync s3://master-suite-backups/prod/<stamp> /tmp/drill/<stamp>
scripts/restore-verify.sh /tmp/drill/<stamp>
```

This is not yet a timer. `backup-ship.sh` proves the bytes arrived and stayed
intact, and `restore-verify.sh` proves a backup is a database — but the
composition of the two, on a schedule, needs a fetch step per remote type and a
place to put a full copy. Until it exists this is a drill somebody runs, which
is exactly the kind of instruction this document is elsewhere trying to replace
with a unit file. Treat it as the known gap it is.

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

### The schedule, and what has been proved about it

Verified on 2026-08-20, off the deployment:

- **Retention.** Against forged directory sets: eight runs spanning 60 days
  pruned to five, the 29-day-old one kept and the 31/45/60-day ones removed;
  non-matching directories untouched. With every backup older than the window,
  `BACKUP_KEEP_MIN` held the newest three rather than deleting all five.
- **Encryption requirement.** `BACKUP_REQUIRE_ENCRYPTION=1` with no passphrase
  exits 1 in the preflight, before the destination directory is created.
- **Freshness check.** All seven branches exercised — missing root, empty root,
  a run with no manifest, a manifest with no dump, healthy, stale past the
  threshold, and stale-but-verified.
- **Installer.** Run against a temporary unit directory: six units written with
  every placeholder substituted, `/etc/master-suite` at 700, the env file at 600,
  the backup root at 750, and a re-run preserving an existing passphrase.
  `systemd-analyze verify` passes on all six units.

**What has not been proved:** `systemctl enable --now` and an actual timer
firing. The verification host has no running systemd (`systemctl
is-system-running` reports `offline`), so that step was exercised with a stub.
On the deployment, confirm it with:

```bash
systemctl list-timers 'master-suite-*'
systemctl start master-suite-backup.service && journalctl -u master-suite-backup -f
```
