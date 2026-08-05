# Deployment

The current launcher is for local development. Production deployment must use:

- TLS behind a trusted proxy that overwrites forwarding headers.
- Managed PostgreSQL with separate migration and non-`BYPASSRLS` application roles.
- Managed Redis/Valkey and private object storage with encryption and lifecycle rules.
- Deployment jobs that run Prisma and Alembic migrations before application rollout.
- Secret-manager injection; no `.env` files in images.
- Real email, telephony, malware-scanning and other selected providers.
- Health/readiness probes, structured logs, metrics, traces and error reporting.
- Encrypted daily backups, point-in-time recovery and tested restore procedures.

Do not deploy the current milestone as a commercial production system until every
open release blocker in `SECURITY-REMEDIATION.md` is closed.
