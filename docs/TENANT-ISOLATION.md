# Tenant-isolation design

Every tenant-owned record carries the canonical tenant ID. API code derives it
from the authenticated membership, never request bodies or webhook payloads.
Application queries include it explicitly; PostgreSQL RLS independently checks a
transaction-local `app.tenant_id`. Webhooks resolve tenant identity from a random
integration key plus a valid signature.

Sales call identifiers are now unique by tenant, provider and external ID. RLS
role/policy templates exist, but activation awaits transaction-context refactoring
described in `RLS-ROLLOUT.md`.
