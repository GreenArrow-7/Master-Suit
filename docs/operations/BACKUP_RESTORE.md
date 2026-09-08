# Backup and Restore

What the repository proves, and what it cannot. Authoritative detail:
`docs/BACKUP-RECOVERY.md` (2026-08-21).

## Database backups

- `scripts/backup.sh <out>`: `pg_dump` custom format (compressed) +
  bucket mirror (`mc mirror`) + `manifest.txt` (versions, counts, sha256);
  optional GPG AES-256 with `BACKUP_PASSPHRASE`, mandatory when
  `BACKUP_REQUIRE_ENCRYPTION=1`; retention pruning with `BACKUP_KEEP_MIN`
  floor. VERIFIED (E2 script); TESTED off-deployment per
  `docs/BACKUP-RECOVERY.md` "Verification status" (2026-08-20/21).
- Schedule: `infra/systemd/master-suite-backup.timer` nightly 02:30
  (`Persistent=true`), installed by `scripts/install-backup-schedule.sh`
  (writes six units, `/etc/master-suite` 700, env file 600). E2.
- Freshness: `master-suite-backup-status.timer` daily 09:00 runs
  `backup-status.sh` (exit 1 when stale/missing/incomplete; threshold
  `BACKUP_MAX_AGE_HOURS`). E2.
- Whether the timer is installed and succeeding in production:
  `UNKNOWN — requires production/infrastructure verification`.

## File / object-storage backups

Included in the same run (bucket mirrored into `<out>/<stamp>/objects/`).
DOCUMENTED: "The object half has not been exercised" against a live bucket.
Bucket versioning: not configured in any compose file (E2 negative);
`docs/OPERATIONAL-READINESS.md` §3 lists it as unrehearsed.

## Off-host copies

`scripts/backup-ship.sh` (modes `local`, `s3`, `rclone`, `rsync`) re-reads
what landed and reconciles against the manifest; `BACKUP_SHIP_LIST=1` lists
the remote; a pull mode fetches a run back. `scripts/test-backup-roundtrip.sh`
exercises the `local` transport and is CI gate "Backup round trip" (E2
`ci.yml`). Production remote configuration and success:
`UNKNOWN — requires production/infrastructure verification`.

## Retention

Script-level pruning (documented test: eight runs over 60 days pruned to the
window, `BACKUP_KEEP_MIN` honoured). Production values: `UNKNOWN`.

## Restore process and verification

- `scripts/restore-verify.sh [--prefer-remote] <run>`: restores into
  `<db>_restorecheck` and `<bucket>-restorecheck`, reconciles row counts and
  the migration ledger, checks RLS is still forced; never touches live
  data. Weekly timer `master-suite-restore-verify.timer` Sunday 04:00. E2.
- DOCUMENTED evidence: database half passed on 2026-08-20 (49 migrations at
  the time, 174 forced tables, zero `pg_restore` errors) on a non-production
  cluster; object half not exercised.
- Restoring for real: `docs/BACKUP-RECOVERY.md` "Restoring for real"
  section (E4). No restore into production is recorded anywhere.
- RPO/RTO: not defined in the repository (`docs/OPERATIONAL-READINESS.md`
  §2.4 unticked). `UNKNOWN`.

## Conflicts

**EVC-005** (release-blocking, see `docs/EVIDENCE_CONFLICTS.md`):
`docs/OPERATIONAL-READINESS.md` (2026-08-26) shows every backup row as
"Exists ☐ / Rehearsed ☐", while `docs/BACKUP-RECOVERY.md` (2026-08-21)
records the scripts, timers and off-deployment verification. The scripts
exist (E2). The readiness checklist appears not to have been updated after
the backup work; production rehearsal remains unproven either way.

## Evidence Sources

E2: `apps/web/scripts/backup.sh`, `backup-ship.sh`, `backup-status.sh`,
`restore-verify.sh`, `install-backup-schedule.sh`, `test-backup-roundtrip.sh`,
`infra/systemd/*`, `.github/workflows/ci.yml`.
E4: `docs/BACKUP-RECOVERY.md`, `docs/OPERATIONAL-READINESS.md`,
`docs/DEPLOY-AZURE.md` §8.
Unverified: production schedule status, remote destination, encryption
setting, last successful restore-verify, RPO/RTO.
