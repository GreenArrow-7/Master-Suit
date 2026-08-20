# Operational readiness verification

**Status: NOT VERIFIED. Every item below is unexecuted.**

This is a checklist, not a record of work done. Nothing here has been rehearsed
against a production-like environment, because no such environment exists yet.
Where a control exists in code, that is stated and linked; **code existing is not
the same as the procedure having been rehearsed**, and the distinction is the
whole point of this document.

## 1. Production database migration

| # | Step | Exists in code | Rehearsed | Evidence |
|---|---|---|---|---|
| 1.1 | `prisma migrate deploy` against a production-shaped database | Yes — 11 migrations | ☐ | |
| 1.2 | Migration run against a copy of real data volume | — | ☐ | |
| 1.3 | Time the migration; confirm the lock window is acceptable | — | ☐ | |
| 1.4 | Confirm RLS policies exist on every new table after deploy | Catalog-driven block in migrations | ☐ | |
| 1.5 | Rollback rehearsal: restore, re-apply, confirm no data loss | — | ☐ | |

**Known risk:** `schema.prisma` has drifted ahead of the migrations once already
in this project's history. Add a CI step running
`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
so the next drift fails a build rather than surfacing at runtime.

## 2. Backup and restore

| # | Step | Exists | Rehearsed | Evidence |
|---|---|---|---|---|
| 2.1 | Automated Postgres backup on a schedule | ☐ | ☐ | |
| 2.2 | Backups encrypted at rest and access-controlled | ☐ | ☐ | |
| 2.3 | **Restore to a scratch instance and verify row counts** | ☐ | ☐ | |
| 2.4 | Documented RPO and RTO, agreed with the customer | ☐ | ☐ | |
| 2.5 | Restore rehearsal timed against the stated RTO | ☐ | ☐ | |

**A backup that has never been restored is not a backup.** 2.3 is the row that
matters; the rest are inputs to it.

## 3. Object-storage recovery

| # | Step | Exists | Rehearsed | Evidence |
|---|---|---|---|---|
| 3.1 | Bucket versioning or equivalent enabled | ☐ | ☐ | |
| 3.2 | Documents and attendance captures included in the backup set | ☐ | ☐ | |
| 3.3 | Restore a deleted document and confirm the checksum still matches | ☐ | ☐ | |
| 3.4 | Confirm quarantine objects are **not** restored into the clean prefix | ☐ | ☐ | |
| 3.5 | Lifecycle rule collects orphaned quarantine objects | ☐ | ☐ | |

## 4. Secret rotation

| # | Secret | Blast radius if rotated | Procedure written | Rehearsed |
|---|---|---|---|---|
| 4.1 | `FIELD_ENCRYPTION_KEY` | **Attendance captures and TOTP secrets become undecryptable** if the value is simply replaced. Re-wrap first with `scripts/rotate-field-encryption-key.mjs` (dry run, then `--apply`), and deploy the new key only once that completes | ☐ | ☐ |
| 4.2 | `WEBHOOK_SIGNING_PEPPER` | Inbound webhook signatures fail until partners update | ☐ | ☐ |
| 4.3 | Database credentials | Downtime unless rotated with a rolling restart | ☐ | ☐ |
| 4.4 | S3 credentials | Uploads and downloads fail | ☐ | ☐ |
| 4.5 | `FACE_SERVICE_TOKEN` | **None, if rotated with the script.** `scripts/rotate-face-token.sh <env-file>` does the three ordered steps — face accepts both, web sends the new one, face stops accepting the old one — so no check-in fails while it runs. Rotating by hand still fails closed until both sides restart | ☐ | ☐ |

There is no secret whose rotation signs users out. `SESSION_SECRET` used to be
listed here as doing exactly that, and it did not: sessions are rows in
`PlatformSession` matched by SHA-256 token hash, with no signing step anywhere.
Reaching for it during an incident would have left every session valid while
appearing to revoke them all. It has been removed. To revoke sessions, use
`revokeAllSessions` for one account, or `PATCH /api/v1/platform/workspaces/:id`
with `revokeSessions` for a whole workspace.

**4.2 is destructive and needs a written migration path before it is ever done.**
Rotating that key without re-encrypting is data loss, not a rotation.

**4.5 is the only one with a schedule attached.** The face sidecar turns camera
frames into biometric vectors and its only authentication is that one bearer
token, so its age is published as `masterapp_secret_age_days` and
`FaceServiceTokenStale` raises a ticket past `FACE_TOKEN_MAX_AGE_DAYS` (90 by
default). A deployment that has never rotated reports an age of the threshold
plus one, so it fires there too — "no stamp" and "rotated yesterday" must not
look the same. There is deliberately no timer doing it unattended: the rotation
restarts the service attendance depends on, twice.

## 5. Monitoring and alerts

| # | Signal | Instrumented | Alert configured | Owner |
|---|---|---|---|---|
| 5.1 | Application error rate | Structured logs (pino) | ☐ | |
| 5.2 | `TENANT GUARD TRIPPED` — a cross-tenant query bug | Logged at error | ☐ | |
| 5.3 | Face engine unavailable | `/health` on the sidecar | ☐ | |
| 5.4 | **Malware scanner unavailable** — uploads are failing closed | `antivirusHealth()` | ☐ | |
| 5.5 | Documents stuck in PENDING or ERROR | Queryable | ☐ | |
| 5.6 | `ROTATED_TOKEN_REPLAYED` — possible session theft | Platform audit event | ☐ | |
| 5.7 | Failed sign-ins and lockouts | Platform audit event | ☐ | |
| 5.8 | Queue depth and job failures | BullMQ | ☐ | |
| 5.9 | Database connections, disk, replication lag | ☐ | ☐ | |
| 5.10 | Certificate expiry | ☐ | ☐ | |

**There is currently no alerting at all.** Every signal above is observable in
logs or the database; none of them pages anyone.

## 6. Rate limiting

| # | Control | Exists | Verified under load |
|---|---|---|---|
| 6.1 | Login: 10/IP and 5/account per 15 min | Yes — `lib/security/ratelimit.ts` | ☐ |
| 6.2 | Per-session API limit | Yes — 1200/min | ☐ |
| 6.3 | API-key limit | Yes — 600/min | ☐ |
| 6.4 | Upload endpoint | **Inherits the session limit only** | ☐ |
| 6.5 | Face punch endpoint | Inherits the session limit; minimum punch interval also applies | ☐ |
| 6.6 | Behaviour when Redis is unavailable | **Unverified — confirm it fails closed, not open** | ☐ |

**6.6 is a real gap.** If the limiter fails open when Redis is down, the login
throttle disappears exactly when the system is already unhealthy.

## 7. Scheduled jobs

| # | Job | Implemented | Scheduled | Monitored |
|---|---|---|---|---|
| 7.1 | Retention cleanup (recordings, webhooks, soft-deletes, attendance captures) | Yes — `lib/jobs/retention.ts` | ☐ | ☐ |
| 7.2 | Expiring-document notification | Data available; **no job sends anything** | ☐ | ☐ |
| 7.3 | Leave year-end carry-forward | Manual action in the UI | ☐ | ☐ |
| 7.4 | Temporary-location request expiry | `expireTemporaryRequests` exists; **nothing calls it** | ☐ | ☐ |
| 7.5 | Re-scan of quarantined documents after a scanner outage | **Not implemented** | ☐ | ☐ |

## 8. Retention controls

| # | Control | Configurable | Enforced | Verified |
|---|---|---|---|---|
| 8.1 | Attendance capture frames | Per workspace | By the retention job | Verified in a scratch run |
| 8.2 | Face templates | Deleted on consent withdrawal and on exit | Yes | Verified |
| 8.3 | Employee documents | **No retention policy at all** | ☐ | ☐ |
| 8.4 | Audit log | **Retained indefinitely** | ☐ | ☐ |
| 8.5 | Soft-deleted records | 90 days | Retention job | ☐ |

**8.3 and 8.4 need a decision.** Passport scans and audit rows kept forever is a
choice, and it should be a deliberate one rather than a default.

## 9. Incident response and rollback

| # | Item | Written | Rehearsed |
|---|---|---|---|
| 9.1 | Who is on call, and how they are reached | ☐ | ☐ |
| 9.2 | Severity definitions and escalation path | ☐ | ☐ |
| 9.3 | **Personal-data breach procedure and UAE PDPL notification timeline** | ☐ | ☐ |
| 9.4 | Application rollback: redeploy the previous image | ☐ | ☐ |
| 9.5 | Database rollback: restore plus replay | ☐ | ☐ |
| 9.6 | Compromised-session response (mass revocation) | Possible via `logout-all` per user; **no bulk tool** | ☐ |
| 9.7 | Compromised-credential response (secret rotation) | See section 4 | ☐ |
| 9.8 | Post-incident review template | ☐ | ☐ |

**9.3 is not optional** for a system holding biometric templates and passport
scans in the UAE.
