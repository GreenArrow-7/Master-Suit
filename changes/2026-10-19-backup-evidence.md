# Every release records the backup timer, the daily cadence and the off-site copy

**What** — `backup-status.sh`, which the release preflight runs on production,
now also prints the nightly backup timer's state and last run, how many of the
last seven days have a complete backup, and the newest backup that left the
machine. `backup-ship.sh` records where and how much in its `.shipped-at`
marker. PR —.

**Why** — NFR-13 ("daily PITR and an off-site copy"). The owner accepted RPO
24 h: a restore point a day, which the nightly timer and each release already
give. What was missing was evidence from production, which needed the owner to
SSH in; and the preflight, run without the backup environment, printed "nothing
has left this machine" while the nightly timer shipped every night.

**Where**

- `apps/web/scripts/backup-status.sh` — timer and last-run lines from
  `systemctl show`, the seven-day cadence, the off-site line from markers.
- `apps/web/scripts/backup-ship.sh` — marker holds UTC time, destination by
  name (never the whole `BACKUP_REMOTE`), artefact count; still written only
  after verification.
- `apps/web/scripts/test-backup-roundtrip.sh` — section 9, "backup status
  evidence" (CI step "Backup round trip").
- `docs/BACKUP-RECOVERY.md` ("Recovery point: 24 hours"),
  `docs/product/RELEASE-RUNBOOK.md` §9.2, `docs/PRODUCTION-RELEASE-PROCEDURE.md`
  §3, `docs/DEPLOY-AZURE.md`.

**Behaviour** — new `[backup-status]` lines: `timer master-suite-backup.timer:
active, last fired …, next …`, `last nightly run: success, exited … (status 0)`,
`daily cadence: N of the last 7 full days have a complete backup` (today
excluded), `off-site: newest shipped backup <stamp> (Nh old), shipped <marker>`.
An inactive timer, a failed run, a missed day or an off-site copy older than
`BACKUP_MAX_AGE_HOURS` prints a `note:`. Exit codes are unchanged; no systemctl,
or no systemd behind it, prints "timer state not checked" and carries on. The
"nothing has left this machine" note stays only when no marker exists. Markers
from before this hold only the time and still read.

**Verified** — `scripts/test-backup-roundtrip.sh` in a Debian container
(node:24-bookworm, no systemd): all 28 checks pass; against the old
`backup-status.sh` and `backup-ship.sh` 11 of the 16 new checks fail (the
exit-code ones and the kept note pass on both, as they should). Unit folder, tsc, prettier as in the PR.

**Left open**

- The first release after this merges puts the real lines in its log; that is
  the production evidence NFR-13 asked for.
- WAL-based continuous PITR if an RPO under 24 h is ever wanted — not built:
  Postgres settings, a restart and a WAL destination (`docs/BACKUP-RECOVERY.md`).
- The rclone, s3 and rsync marker labels are not exercised (no remote in CI).
