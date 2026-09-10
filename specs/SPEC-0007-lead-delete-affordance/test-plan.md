# SPEC-0007 — Test plan

Everything below ran against a disposable stack (`msqa`) whose web container is
the exact image production runs (`master-suite/web:c879c6c7f7e8`) for the
"before" column, and an image built from this branch for the "after" column.
Nothing was run against production; production supplied read-only evidence only.

| ID | Requirement | Case | Expected | Before | After |
|---|---|---|---|---|---|
| `TC-001` | `FR-001`, `FR-002`, `FR-003`, `AC-001` | Administrator selects a lead in the list and deletes it | leaves the list, `deletedAt` set, row retained | **no control exists** | pass |
| `TC-002` | `FR-001`, `AC-001` | The same, from a Smart View | as `TC-001` | **no control exists** | pass |
| `TC-003` | `FR-003` | `DELETE /api/v1/leads/[id]` as an administrator | `200`, soft-deleted | pass | pass |
| `TC-004` | `SR-001`, `SR-003`, `FR-001`, `AC-002` | The same as a user without `leads:DELETE` | `403`, and no control offered | pass | pass |
| `TC-005` | `SR-002`, `AC-003` | The same against another tenant's lead | `404`, row untouched | pass | pass |
| `TC-006` | `FR-003` | Deleting a lead that carries activities | `200` | pass | pass |
| `TC-007` | `FR-004` | Deleting a non-existent or already-deleted lead | `404`, counted as a failure | pass | pass |
| `TC-008` | `AC-005` | Platform Owner creates a workspace through the API | `201`, complete provisioning | pass | pass |
| `TC-009` | `AC-005` | Platform Owner creates a workspace through the wizard, in a browser | `201` | pass | pass |
| `TC-010` | `AC-005` | Creator's membership after `TC-009` | primary admin, `company_admin`, full grants | pass | pass |
| `TC-011` | `SR-002` | New workspace cannot reach another workspace's data | `404` | pass | pass |
| `TC-012` | `FR-005`, `FR-006`, `FR-007`, `SR-004`, `OR-001`, `AC-004` | A rejected provisioning request | one `warn` record carrying status and cause and **no field values**; the wizard names the fields | **nothing logged; "Validation failed" only** | pass |
| `TC-013` | `AC-005` | Mutation matrix: lead create / update / delete, workspace create, workspace settings update | all succeed | pass | pass |
| `TC-014` | `FR-010`, `AC-007` | `DELETE /api/v1/tasks/[id]` as a holder of `tasks:DELETE` | `200`, soft-deleted | **405, no handler** | pass |
| `TC-015` | `FR-008`, `AC-006` | Company administrator opens `/platform` | told they lack platform access | **307 → `/login`, reads as a logout** | 307 → `/no-platform-access`, explained |
| `TC-016` | `FR-009`, `AC-006` | Anonymous opens `/platform` | sent to sign in | 307 → `/login` | 307 → `/login` |
| `TC-017` | `AC-006` | Platform owner opens `/platform` and the wizard | unaffected | `200` | `200` |
| `TC-018` | `AC-008` | Lead document upload, download, delete, and the negative cases in `bug-010.md` | as recorded | pass | pass |
| `REG-002` | `AC-008` | e2e: a document uploads to the lead, lists, and downloads | passes | passes | passes |
| `REG-001` | `FR-001`, `FR-002`, `FR-003`, `AC-001` | e2e: an administrator deletes a lead from the list | passes | **fails** | pass |

`TC-004` and `TC-005` are the security boundary. They pass in **both** columns,
which is the point: the fix adds a control, not an authority.
