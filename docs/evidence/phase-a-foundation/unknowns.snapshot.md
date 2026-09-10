# Known unknowns — snapshot at Phase A acceptance

Every item Phase A could not establish from the repository, as recorded in
the documentation. These are correctly marked in the source documents; this
snapshot collects them so they can be tracked into later phases.

None of these blocks acceptance of Phase A. Several block a production
release claim, and are marked accordingly.

## Runtime and infrastructure unknowns

| # | Unknown | Recorded in | Release impact |
|---|---|---|---|
| U-01 | Whether the production host runs the `release.sh` + Compose mechanism the repository describes, and which commit is currently deployed | `operations/DEPLOYMENT.md`, EVC-003, GAP-DEP-01 | **Blocking** |
| U-02 | Whether backups are installed and succeeding on the production host; the newest manifest; retention actually applied | `operations/BACKUP_RESTORE.md`, EVC-005, GAP-BAK-01 | **Blocking** |
| U-03 | Whether an object-storage restore has ever succeeded; the object half of `restore-verify.sh` is documented as never exercised against a live bucket | `operations/BACKUP_RESTORE.md`, GAP-BAK-02 | **Blocking** |
| U-04 | Whether backups are encrypted in production (`BACKUP_PASSPHRASE` set) | SEC-OBS-008, GAP-BAK-03 | Blocking |
| U-05 | Stated RPO and RTO; none exists in the repository | GAP-BAK-03 | Blocking |
| U-06 | Production row-level-security catalogue state and the connected role's attributes | EVC-004 (C4), `architecture/DATABASE.md` | To be determined |
| U-07 | Whether alert delivery works end to end from Alertmanager | `operations/OBSERVABILITY.md`, GAP-OBS-03 | Blocking |
| U-08 | Whether `DEPLOY_KNOWN_HOSTS_<ENV>` is set for each environment | SEC-OBS-005, GAP-SEC-06 | Blocking |
| U-09 | Branch protection rules and required status checks on `main` | GAP-CI-01 | Blocking |
| U-10 | Reviewers configured on the GitHub `production` environment | `operations/DEPLOYMENT.md` | Blocking |
| U-11 | Whether GHCR images are built for releases, and whether the deploy path should pull them | EVC-012, GAP-DEP-02 | To be determined |
| U-12 | Whether the `face`, `clamav` and `pgbouncer` containers run in production | `SYSTEM_INVENTORY.md`, `architecture/SYSTEM_OVERVIEW.md` | Non-blocking |
| U-13 | Production values of session TTL, idle timeout and lockout settings | `security/AUTHENTICATION.md` | Non-blocking |
| U-14 | Production secret-handling practice, and whether any external secret manager is in use | `security/SECRETS_AND_CONFIG.md` | Non-blocking |
| U-15 | Production database size, replica presence, PgBouncer use | `architecture/DATABASE.md` | Non-blocking |
| U-16 | Whether an exception-tracking or log-shipping agent is installed on the host outside the repository | `operations/OBSERVABILITY.md` | Non-blocking |
| U-17 | Whether mobile store builds are published | `SYSTEM_INVENTORY.md` | Non-blocking |
| U-18 | The latest CI `verify` result on `main`; `gh` is unauthenticated in this environment | EVC-014, GAP-TEST-02 | Non-blocking for Phase A, blocking for a release claim |
| U-19 | TLS certificate status, DNS records, firewall rules | `operations/DEPLOYMENT.md` | Blocking |

## Repository-answerable unknowns Phase A did not exhaust

These are marked `UNKNOWN — requires verification` rather than the runtime
form, because a further pass over the repository could resolve them.

| # | Unknown | Recorded in |
|---|---|---|
| U-20 | Whether `Idempotency-Key` and `If-Match` are implemented as documented | EVC-008, `standards/API_STANDARDS.md` |
| U-21 | What each of the 38 non-kernel route handlers checks | SEC-OBS-002, GAP-SEC-01 |
| U-22 | The outbound webhook signature construction | `architecture/DATA_FLOW.md`, `INTEGRATIONS.md` |
| U-23 | Abuse controls on the public lead-capture path | SEC-OBS-010 |
| U-24 | The geocoding provider behind `/api/v1/geocode` | `architecture/INTEGRATIONS.md` |
| U-25 | Whether presigned URLs are used for object access | `security/SECURITY_MODEL.md` |
| U-26 | Worker concurrency for the eight queues that do not declare one | `architecture/BACKEND.md` (INFERRED) |
| U-27 | Whether the `hrms-28of28-baseline` tag still resolves after the history rewrite | historical, noted during the review of `docs/evidence/baseline-28of28` |

## Counting

26 occurrences of an UNKNOWN marker across the Phase A documents, using three
approved forms: the runtime form (8), the production form (2), and the
plain form (2), with the remainder appearing inside tables and conflict
entries that reference them.

## Evidence Sources

E1: the Phase A document set, extracted by scanning for UNKNOWN markers and
by reading each document's unverified list.
E4: `docs/EVIDENCE_CONFLICTS.md`, `docs/PHASE_A_GAP_ANALYSIS.md`,
`docs/security/SECURITY_OBSERVATIONS.md`.
