# ADR 0002: Security before feature consolidation

Status: accepted.

Mandatory 2FA, webhook authentication, tenant-scoped external identifiers,
controlled migrations, proxy trust and production configuration are remediated
before shared dashboards or commercial features. A runnable milestone may be
released to development, but it cannot be labelled production-ready while shared
identity and database-enforced tenant isolation remain incomplete.
