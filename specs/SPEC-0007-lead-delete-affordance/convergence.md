# SPEC-0007 — Convergence

## What was verified, and against what

Two web containers on one disposable stack, one database:

- **Before** — `master-suite/web:c879c6c7f7e8`, the exact image production is
  running (`org.opencontainers.image.revision`
  `c879c6c7f7e8e45e90387a3f764599ba4667dfdc`).
- **After** — an image built from this branch.

The disposable database was compared with production before any of it was
trusted: identical migration set (66), identical RLS policies and
`relrowsecurity` / `relforcerowsecurity` flags across all 202 tables, identical
`master_saas_app` grants across all 202 tables. Both connect as
`master_saas_app` — `NOSUPERUSER`, `NOBYPASSRLS` — so RLS is genuinely in force
in the reproduction.

Nothing was executed against production. Production supplied read-only
evidence: the running image tag, the request log, the platform audit table, the
role-permission grants, and the catalogue comparison above.

## Acceptance criteria

| | Before | After |
|---|---|---|
| `AC-001` — administrator deletes a lead from the list | bulk bar reads `Assign \| Change stage \| Add task \| Clear`; **no delete exists** | bulk bar reads `Assign \| Change stage \| Add task \| Delete \| Clear`; confirm reads "Delete 1 lead(s)? They will no longer appear in any list."; `DELETE /api/v1/leads/… → 200`; the row leaves the list and `deletedAt` is set — the row itself is retained |
| `AC-001` — from a Smart View | same bulk bar, no delete | delete present |
| `AC-002` — viewer without `leads:DELETE` | `403` from the endpoint | `403` from the endpoint, `canDelete` absent from the payload, and the grid offers no selection at all |
| `AC-003` — cross-tenant delete | `404`, `deletedAt` still null | `404`, `deletedAt` still null |
| `AC-004` — a rejected provisioning request | **nothing written anywhere** | one `warn` per rejection carrying request id, status and either the error code or the field names; no values |
| `AC-005` — mutation matrix | all pass | all pass |
| `REG-001` | fails — the control does not exist | passes |

## Was the failure systemic?

No. A bounded mutation matrix on the deployed image, before any change:

| Operation | Result |
|---|---|
| Read leads | `200` |
| Create lead | `200` |
| Update lead | `200` |
| Delete lead (API) | `200`, soft-deleted |
| Create workspace (API and wizard) | `201` |
| Update workspace settings | `200` |
| Create task | `200` |
| Delete task | `405` — **no `DELETE` handler exists on `/api/v1/tasks/[id]`** |

Authentication, authorization, tenant context, RLS, transactions and the API
kernel are all working. The one genuine gap the sweep turned up beyond
`BUG-006` is the missing task `DELETE` handler, which is registered rather than
absorbed — it is out of scope here and needs its own record.

## Was anything else changed?

No. Six files, listed in `plan.md`. No migration, no dependency, no
environment variable, no compose or infrastructure change, and nothing under
`apps/web/src/lib/auth/` or `apps/web/src/lib/security/`.

## Was any behaviour altered that nobody asked for?

Two, both stated rather than slipped in:

1. The shared bulk-failure message now reads "could not be completed" instead
   of "could not be updated". It is shared with actions that are not updates.
2. `canDelete` is a **required** prop on `LeadGrid`, so a future caller cannot
   omit it silently. This is the reason the second existing caller was found.

## Is the documentation still true?

Yes, with one addition: no requirement previously said the leads list must
expose the permissions it enforces, which is how this defect survived. `FR-001`
to `FR-004` close that gap. `FR-005` to `FR-007` close the parallel gap on the
provisioning path — that a rejected control-plane mutation must be recorded.

## Open findings carried out of this work

| Finding | Status |
|---|---|
| `BUG-007` — workspace creation reported as failing | `CANNOT_REPRODUCE`. Needs the account, the verbatim message and the timestamp. With `CHG-002` deployed, the timestamp alone is enough. |
| `DELETE /api/v1/tasks/[id]` answers `405` | Observed, out of scope, needs its own record |
| Platform console redirects a signed-in non-owner to `/login` | Candidate explanation `C1` for `BUG-007`; unevidenced and authorization-adjacent, so deliberately not changed on a hunch |

## Verdict

`CHG-001` through `CHG-004`: **converged**. `BUG-006` is fixed and has a test
that fails without the fix. `BUG-007` is **not** closed and is not claimed to
be; what shipped for it is the evidence trail that was missing, not a fix.
