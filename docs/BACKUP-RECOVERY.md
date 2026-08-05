# Backup and recovery

- Enable PostgreSQL point-in-time recovery plus daily encrypted snapshots.
- Version object storage and retain deletion markers according to tenant policy.
- Back up migration history, encryption-key metadata and audit storage together.
- Test restoration quarterly into an isolated account and reconcile record counts.
- Before schema or data migration, take a named snapshot and record the restore ID.
- Rollback changes application version first; restore data only when forward repair
  is unsafe, because restoration discards writes after the recovery point.

No migration is approved until its restoration procedure has been rehearsed.
