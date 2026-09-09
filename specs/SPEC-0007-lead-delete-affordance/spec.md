# SPEC-0007 — Lead deletion affordance and workspace-provisioning diagnosability

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0007` |
| Title | Lead deletion affordance and workspace-provisioning diagnosability |
| Status | `IMPLEMENTING` |
| Risk | `R2` |
| Owner | Engineering |
| Created | 2026-09-09 |
| Last updated | 2026-09-09 |
| Supersedes | none |
| Superseded by | none |

### Why `R2`, stated so it can be disagreed with cheaply

The change set is: a bulk action added to an existing grid over an existing
endpoint (`R2` by the table's own example, "adding a column to a grid"), an
error-message improvement in a form (`R1`), and two `logger.warn` statements in
one route's error helper.

- The argument for `R3` is that a file under `src/app/api/v1` is edited. What
  is edited there is logging: no route is added, no response shape changes, no
  service logic changes. `R3`'s examples are all three of those.
- The argument for `R4` is that a destructive control is added to a screen.
  The control is gated on `can(ctx, 'leads', 'DELETE')` — the same permission
  the server independently enforces in the API kernel — and **no authorization,
  visibility, RLS, tenant-context or session code is touched**. The screen now
  reads an authorization decision that the codebase already reads on the lead
  detail page; it does not make one.

Author's classification is `R2`. If a reviewer takes the `R4` reading, the
`LeadGrid` change reverts cleanly on its own.

## Problem

Two production symptoms were reported on 2026-09-09 against
`https://one.youhan.in`:

1. **An Administrator cannot delete Leads.**
2. **Users/Administrators are unable to create a Workspace.**

Both were traced end to end. See `bug-006.md` and `bug-007.md`.

`BUG-006` reproduces. The leads list — the screen an administrator is on when
they want to remove leads — has **no delete control of any kind**. Selecting
rows offers Assign, Change stage and Add task. The product's only lead deletion
is one record at a time, behind an unlabelled `More ▾` menu on the lead detail
page. The permission (`leads:DELETE`, `ORGANIZATION` scope on the Company
Administrator role), the `DELETE /api/v1/leads/[id]` route, the soft-delete
service and the RLS policies were all verified working. Nothing was broken
below the screen; the screen offered nothing to press.

`BUG-007` does **not** reproduce. Workspace creation succeeds on the exact
image production is running, through the API and through the five-step wizard
in a real browser. What the investigation did establish is that the
provisioning route is the one mutation path outside the API kernel, so a `403`,
`409` or `422` from it is written to no log at all — a report of "workspace
creation fails" therefore leaves no evidence to correlate against, and the
wizard answers a `422` with the bare words "Validation failed" without naming
the field. Those two gaps are why `BUG-007` cannot be closed either way, and
they are what this specification changes.

## Goal

An administrator holding `leads:DELETE` can delete leads from the list they are
looking at; and the next report of a failed workspace provisioning arrives with
a server-side record and a client-side message that name the cause.

## Background and context

- Leads list: `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/page.tsx`
  and `LeadGrid.tsx`. The grid already carries a selection model and a bulk bar.
- Lead deletion: `DELETE /api/v1/leads/[id]` →
  `services/leads/updateLead.ts::deleteLead`. It is a **soft delete**
  (`deletedAt`), inside `withTx(ctx.tenantId, …)`, after
  `assertRecordVisible(ctx, 'leads', before, tx, 'DELETE')`.
- Workspace provisioning: `POST /api/v1/platform/workspaces`, behind
  `requirePlatformOwner`, in `withPlatformTx`. It does not use the API kernel
  `route()` helper and therefore does not inherit its request logging.

## Scope

- `LeadGrid` gains a bulk Delete action, rendered only when the viewer holds
  `leads:DELETE`, confirming before it acts.
- The leads page passes that permission to the grid, exactly as the lead detail
  page already does.
- The bulk-failure message stops saying "could not be updated" for actions that
  are not updates.
- `POST /api/v1/platform/workspaces` logs its rejections, not only its crashes.
- The create-workspace wizard names the fields a `422` rejected.

## Out of scope

- Any change to authorization, permissions, roles, scopes, visibility rules,
  RLS policies, tenant context or session handling. **None of these is touched.**
- Changing lead deletion from soft to hard, or adding a restore/undo surface.
- The absent `DELETE /api/v1/tasks/[id]` endpoint (405), observed during the
  mutation-matrix sweep and registered separately rather than absorbed here.
- Fixing `BUG-007`. It has no reproduced cause to fix.
- **`BUG-008`** — the platform console's refusal returns the control-plane
  page in the redirect body. Reproduced, registered, and deliberately **not**
  fixed here: moving authorization into eleven pages is `R4` and needs the
  human gate and Application Security. See `bug-008.md`.
- Re-gating the rest of the task API off `leads` and onto `tasks:*`.
- A MIME allowlist for uploads, and the raw display filename — both recorded
  in `bug-010.md`, neither a defect.

## Actors

Company Administrator (workspace, holds `leads:DELETE`); Sales user without
`leads:DELETE`; Platform Owner (provisioning).

## Functional requirements

- `FR-001` — The leads list offers a Delete action for the current selection to
  a viewer holding `leads:DELETE`, and offers it to nobody else.
- `FR-002` — The action confirms before it acts, and states truthfully what
  happens: the leads stop appearing in lists.
- `FR-003` — Deletion uses the existing `DELETE /api/v1/leads/[id]` endpoint.
  No new endpoint, no bulk endpoint, no client-side database access.
- `FR-004` — A partially failed bulk action reports how many failed and leaves
  the selection intact.
- `FR-005` — `POST /api/v1/platform/workspaces` writes one `warn` record for
  every rejected request, carrying request id, status, and either the error
  code or the names of the failing fields.
- `FR-006` — `FR-005` records **no field values**, so nothing the operator
  typed — an administrator's password among the inputs — reaches a log.
- `FR-007` — The create-workspace wizard, on a `422`, names the fields that
  failed rather than only the word "Validation failed".
- `FR-008` — A signed-in account that is refused the platform console is told
  that it lacks platform access, and is not sent to the sign-in screen.
- `FR-009` — A caller with no session is still sent to the sign-in screen, and a
  genuine failure resolving the session is no longer reported as either.
- `FR-010` — A task can be deleted by a viewer holding `tasks:DELETE`, from the
  task list, as a soft delete.

## Security requirements

- `SR-001` — The server-side authorization for lead deletion is unchanged. The
  new control is a rendering condition, never a decision: the API kernel
  asserts `leads:DELETE` independently on every request.
- `SR-002` — Tenant isolation for lead deletion is unchanged and re-verified:
  an administrator deleting another tenant's lead receives `404` and the row is
  untouched.
- `SR-003` — A user without `leads:DELETE` receives `403` from the endpoint
  whatever the client sends, and is offered no control.
- `SR-004` — `FR-006`: provisioning logs carry codes and field names only.

## Observability requirements

- `OR-001` — A rejected workspace provisioning is discoverable from
  `docker logs` by request id and status.

## Failure behaviour

A lead that fails to delete leaves its row in place and is counted in the
error line. A lead already deleted answers `404`; the count reports it as a
failure rather than pretending it succeeded.

## Edge cases

- Selecting leads, then deleting some successfully and some not: the grid
  refreshes and the failures remain selected.
- Deleting a lead that carries activities, tasks or documents: permitted, and
  verified. Soft delete does not orphan them.

## Acceptance criteria

- `AC-001` — An administrator selects a lead in the list, presses Delete,
  confirms, and the lead leaves the list and stays gone after a reload.
  `deletedAt` is set; the row is not removed.
- `AC-002` — A viewer without `leads:DELETE` is offered no Delete control and
  is refused `403` by the endpoint.
- `AC-003` — A cross-tenant delete answers `404` and changes nothing.
- `AC-004` — A rejected provisioning request appears in the web log with its
  status and cause, and with no field values.
- `AC-005` — The full mutation matrix (lead create/update/delete, workspace
  create, workspace settings update) still passes.
- `AC-006` — A company administrator reaching `/platform` lands on a page that
  explains the lack of platform access; an anonymous caller still reaches
  `/login`; the platform owner is unaffected.
- `AC-007` — `DELETE /api/v1/tasks/[id]` answers `200` for a holder of
  `tasks:DELETE` and the task leaves every list; the endpoint refused with
  `405` before.
- `AC-008` — Lead document upload, download, delete and every negative case
  behave as `bug-010.md` records.

## Assumptions

- Deletion of a lead by an administrator is intended product behaviour. Sourced
  from the existing `leads:DELETE` permission, its `ORGANIZATION` grant on the
  Company Administrator role, the `DELETE` route, the `deleteLead` service and
  the delete control already present on the lead detail page. This is
  inference confirmed by four independent existing artefacts, not a new
  product decision.

## Open questions

None blocking. `BUG-007` needs the reporter to say **which account** saw
workspace creation fail and **what the screen said**; see `bug-007.md`.

## Rollback and reversibility expectations

Every change is additive and confined to four files. Reverting the commit
restores the previous behaviour exactly; there is no migration, no data change
and no configuration change.

## Evidence and existing-system references

- Production version evidence, RLS and grant comparison, reproduction
  transcripts and the mutation matrix: `bug-006.md` and `bug-007.md`.
- `docs/sdd/BUG_WORKFLOW.md`, `docs/RISK_CLASSIFICATION.md`,
  `docs/sdd/RISK_TO_PROCESS_MATRIX.md`.

## Revision history

| Date | Change |
|---|---|
| 2026-09-09 | Raised from the 2026-09-09 production report. |

## Approval

Gate 1, author-level for `R2`. See `sdd.json`.
