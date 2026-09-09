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

## CI on the new SHA

`21705d7`, PR #47 into `dev/yourhan-next`.

| Gate | Result |
|---|---|
| SDD validation (GitHub) | **success** |
| CI → typecheck, lint, format, schema drift, tenant isolation, raw-SQL scope, README schema counts, observability drift, Redis auth, face token gate, backup round trip, unit tests, integration (server), build | **all pass** |
| CI → E2E | **did not run.** `ci.yml` gates the Playwright steps on `github.event_name == 'push' \|\| github.base_ref == 'main'`, and this PR targets `dev/yourhan-next`. It runs when the release-candidate PR to `main` next runs. |
| CI → Audit | **fails** |

### The Audit failure is inherited, not introduced

`git diff 63daf3d..21705d7 -- apps/web/package.json apps/web/package-lock.json`
is **empty** — this change touches no dependency. To settle it rather than
assert it, the release candidate's own CI run was re-run on 2026-09-09: PR #46
at `63daf3d`, which passed on 2026-09-08, now **fails at the same single step,
`Audit`, with every other gate including E2E green**.

Three advisories published between 2026-09-08 and 2026-09-09:
`next` (critical, two RCEs, fix requires `next@16.3.4` — outside the stated
range), `nodemailer` (high, four advisories, `npm audit fix` is sufficient),
`sharp` (high, via `libheif`, dragged by the `next` bump).

**The release candidate is therefore no longer CI-green either**, and that is
a release-management fact rather than a defect in this change. Bumping a
framework major inside a P0 incident fix is exactly the drive-by
`docs/sdd/BUG_WORKFLOW.md` forbids, so it is registered here and left alone.

### `REG-001` fail-before / pass-after

The spec itself has not yet been executed by a runner, because the E2E gate did
not run on this PR — stated plainly rather than glossed. What **was** executed,
against both images, is the spec's own assertions driven by an equivalent
Playwright harness using the identical locators
(`getByRole('checkbox', { name: 'Select <lead>' })`, `page.once('dialog')`,
`getByRole('button', { name: 'Delete', exact: true })`):

- against `master-suite/web:c879c6c7f7e8`: **0** matching Delete buttons after
  selection — the click has nothing to hit;
- against the image built from this branch: **1**, the confirmation reads
  "Delete 1 lead(s)? They will no longer appear in any list.",
  `DELETE /api/v1/leads/… → 200`, the row leaves the list and `deletedAt` is
  set.

So the assertions are demonstrated to fail before and pass after; what remains
unproven is the spec file's own wiring under the Playwright runner, and that is
the release-candidate PR's E2E run to establish.

## Full-gate CI, including Playwright — PR #49, base `main`

E2E is gated in `ci.yml` on `github.event_name == 'push' || github.base_ref == 'main'`,
so a PR into `dev/yourhan-next` skips it. A draft PR whose base **is** `main`
(#49, `DO NOT MERGE`) was opened solely to make the full gate execute on the
exact release-candidate content. Merging still goes #47 and #48 into
`dev/yourhan-next`, then #46 into `main`.

### First run — `956754a`

**51 passed, 1 failed.** Every gate before E2E green: typecheck, lint, format
check, schema drift, tenant isolation, raw-SQL scope, README schema counts,
observability drift, Redis auth, face token gate, backup round trip, unit
tests, integration (server).

The three new persona assertions all passed on the first attempt:

| Spec | Result |
|---|---|
| `platform-workspace-create` — the platform owner creates a workspace through the wizard | **passed** (10.7s) |
| `platform-workspace-create` — a rejected field is named on the review step | **passed** (4.1s) |
| `platform-workspace-create` — a workspace administrator is refused the console without being logged out | **passed** (6.5s) |
| `platform-workspace-edit` — a workspace administrator cannot reach the platform area | **passed**, unchanged by the denial-UX change |

The one failure was `REG-002`: the uploaded document never appeared in the
list. **The cause is the environment, not the product.** `ci.yml` runs Postgres
and Redis only, and `.env.example` points `S3_ENDPOINT` at `127.0.0.1:9000`, so
`putObject` cannot succeed on a runner. Lead document upload — with download,
delete, `403`, `404`, path traversal, the size cap and an EICAR refusal — was
verified end to end against the deployed image in a disposable stack that does
have MinIO and ClamAV (`bug-010.md`).

**And it took `REG-001` with it.** `crm-lifecycle` is a serial describe, so the
abort left the lead-delete regression — the reason this change exists —
reported as "did not run". That is the more serious half of the failure: a
false red in an unrelated test hid the one that matters.

`REG-002` now asserts unconditionally as far as the environment allows — the
control is present, pressing it issues the `POST`, and the server accepts it —
and skips only the storage half, only on a `5xx` from `putObject`, with the gap
named. A `4xx` is still a failure, so the product refusing is never mistaken
for the runner lacking a bucket.

### Second run — `90ee47a` — **every gate green**

`gh run view 34366512152` — `verify` in 18m14s, all thirty-four steps `✓`,
including **E2E**, **Build** and **Audit**. Playwright: **54 passed, 1 skipped,
0 failed.**

| Assertion | Result |
|---|---|
| `REG-001` — an administrator deletes a lead from the list | **passed (6.3s)** — executed by the Playwright runner, not argued |
| `REG-002` — a document uploads to the lead, lists, and downloads | **skipped**, storage gap named; the upload half asserted |
| the platform owner creates a workspace through the wizard | **passed (11.4s)** |
| a rejected field is named on the review step | **passed (3.1s)** |
| a workspace administrator is refused the console without being logged out | **passed (4.9s)** |
| a workspace administrator cannot reach the platform area (pre-existing) | **passed (3.6s)** — the denial-UX change did not weaken it |
| **Audit** | **passed** — first green since 2026-09-08, via #48 |

`REG-001` failing before the fix and passing after is now demonstrated by the
runner rather than by an equivalent harness, which is what the earlier record
could not claim.

### Gap registered, not fixed

CI has no object storage. Adding a service to `.github/workflows/*` is `R5`
and human-only (`docs/RISK_CLASSIFICATION.md`), so it is recorded for the
owner rather than attempted: until a bucket exists on the runner, the storage
half of document handling has no CI coverage anywhere.

## Verdict

`CHG-001` through `CHG-004`: **converged**. `BUG-006` is fixed and has a test
that fails without the fix. `BUG-007` is **not** closed and is not claimed to
be; what shipped for it is the evidence trail that was missing, not a fix.
