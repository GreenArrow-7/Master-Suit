# Implementation roadmap

## Milestone 1 — protected runnable foundation

Preserve clean source copies, repair mandatory 2FA, secure telephony callbacks,
correct external-call isolation, add controlled schema baselines and local launchers.

## Milestone 2 — shared identity and tenancy

Introduce platform users, memberships, invitations, canonical tenant IDs, shared
sessions/TOTP, module entitlements and deactivation propagation.

Status: in progress. Global users, workspace memberships, employee links, shared
sessions, workspace switching, additive backfill migration and the first platform
owner APIs/pages are implemented. Invitations, final legacy-session retirement and
HRMS identity removal remain.

## Milestone 3 — database isolation

Move HRMS to tenant-owned PostgreSQL models, install RLS, use a non-bypass
application role and prove cross-tenant rejection through disposable integration tests.

## Milestone 4 — commercial control plane

Plans, trials, seats, storage limits, billing interface, suspension, data export,
retention and platform administration.

Status: in progress. Workspace creation, plan selection, trial provisioning,
module entitlements, suspension/activation API, per-workspace overrides and global
audit events are implemented. Billing settlement, usage metering and export/delete
workflows remain.

## Milestone 5 — production operations

Real providers, observability, backup restoration, security regression, staged
deployment, rollback rehearsal and customer onboarding.
