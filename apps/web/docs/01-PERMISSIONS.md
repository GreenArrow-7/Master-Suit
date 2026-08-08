# LeadFlow CRM — Roles, Permissions and Visibility

## 1. The three independent gates

A request is allowed only if **all three** pass. They are separate mechanisms and
are tested separately.

| Gate           | Question                                         | Enforced in                                                               |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| **Tenant**     | Does this record belong to the actor's tenant?   | Prisma client extension + `WHERE tenant_id` on every query + Postgres RLS |
| **Permission** | Does the actor's role grant `<module>:<action>`? | `assertPermission()` in the API kernel, before the handler body           |
| **Visibility** | Is this record inside the actor's data scope?    | `visibilityWhere()` merged into every read; re-checked on write           |
| **Field**      | May the actor see or edit this specific field?   | `applyFieldSecurity()` on serialise, `stripUneditableFields()` on write   |

The UI hides what the actor cannot use, but hiding is never the control. Every
handler re-derives the decision server-side from the session, not from the request.

## 2. Visibility scopes

Ordered, each strictly containing the previous.

| Scope          | Resolves to                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `NONE`         | no records                                                                                                       |
| `OWN`          | `ownerId = actor.id`                                                                                             |
| `TEAM`         | owners in the actor's teams **plus** all descendant teams; managers additionally see direct and indirect reports |
| `BRANCH`       | owners whose `branchId` is in the actor's branch set                                                             |
| `REGION`       | owners in any branch under the actor's region                                                                    |
| `ORGANIZATION` | all records in the tenant                                                                                        |

Scope is stored per role **per permission**, not per role globally — a Team Manager
may hold `leads:VIEW` at `TEAM` but `reports:VIEW_REPORTS` at `BRANCH`.

Unassigned records (`ownerId IS NULL`) are visible to anyone holding `ASSIGN` on the
module at `TEAM` or wider; otherwise they are invisible. This is what makes an
"Unassigned leads" queue work without leaking the whole tenant.

## 3. Default role matrix

Rank orders the hierarchy; a role may only administer roles of a higher rank number.

| Rank | Role                       | Key                 | Default scope | Notes                                                                                               |
| ---- | -------------------------- | ------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| 0    | Super Administrator        | `super_admin`       | ORGANIZATION  | cross-tenant provisioning only; cannot read tenant record data without an audited break-glass grant |
| 10   | Organization Administrator | `org_admin`         | ORGANIZATION  | full configuration inside one tenant                                                                |
| 20   | Sales Director             | `sales_director`    | ORGANIZATION  | all sales data, no user/security administration                                                     |
| 30   | Regional Manager           | `regional_manager`  | REGION        |                                                                                                     |
| 40   | Branch Manager             | `branch_manager`    | BRANCH        |                                                                                                     |
| 50   | Team Manager               | `team_manager`      | TEAM          | may reassign inside the team                                                                        |
| 60   | Sales Representative       | `sales_rep`         | OWN           |                                                                                                     |
| 60   | Field Sales Representative | `field_rep`         | OWN           | adds field-sales module, mobile-first                                                               |
| 40   | Marketing Manager          | `marketing_manager` | ORGANIZATION  | marketing objects org-wide, leads read-only org-wide                                                |
| 60   | Marketing Executive        | `marketing_exec`    | OWN           | own campaigns; no lead export                                                                       |
| 40   | Customer Service Manager   | `service_manager`   | ORGANIZATION  | tickets and SLA configuration                                                                       |
| 60   | Customer Service Agent     | `service_agent`     | TEAM          | own and team tickets                                                                                |
| 45   | Reporting Analyst          | `analyst`           | ORGANIZATION  | read + report build + export; no record edits                                                       |
| 90   | Read-Only User             | `read_only`         | TEAM          | view only, no export                                                                                |

## 4. Permission matrix

`—` none · `O` own · `T` team · `B` branch · `R` region · `A` all · `✓` granted (unscoped action)

### Records

| Module                      | org_admin | sales_dir | regional | branch | team_mgr | sales_rep | field_rep | mktg_mgr | mktg_exec | svc_mgr | svc_agent | analyst | read_only |
| --------------------------- | --------- | --------- | -------- | ------ | -------- | --------- | --------- | -------- | --------- | ------- | --------- | ------- | --------- |
| leads:VIEW                  | A         | A         | R        | B      | T        | O         | O         | A        | T         | B       | T         | A       | T         |
| leads:CREATE                | ✓         | ✓         | ✓        | ✓      | ✓        | ✓         | ✓         | ✓        | ✓         | —       | —         | —       | —         |
| leads:EDIT                  | A         | A         | R        | B      | T        | O         | O         | T        | O         | —       | —         | —       | —         |
| leads:DELETE                | A         | —         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| leads:ASSIGN                | A         | A         | R        | B      | T        | —         | —         | —        | —         | —       | —         | —       | —         |
| leads:REASSIGN              | A         | A         | R        | B      | T        | —         | —         | —        | —         | —       | —         | —       | —         |
| leads:BULK_UPDATE           | A         | A         | R        | B      | T        | —         | —         | T        | —         | —       | —         | —       | —         |
| leads:EXPORT                | A         | A         | R        | B      | —        | —         | —         | A        | —         | —       | —         | A       | —         |
| leads:IMPORT                | ✓         | ✓         | ✓        | ✓      | —        | —         | —         | ✓        | —         | —       | —         | —       | —         |
| leads:VIEW_SENSITIVE_FIELDS | ✓         | ✓         | ✓        | ✓      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| opportunities:VIEW          | A         | A         | R        | B      | T        | O         | O         | A        | —         | B       | —         | A       | T         |
| opportunities:EDIT          | A         | A         | R        | B      | T        | O         | O         | —        | —         | —       | —         | —       | —         |
| opportunities:DELETE        | A         | A         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| accounts:VIEW               | A         | A         | R        | B      | T        | T         | T         | A        | —         | A       | T         | A       | T         |
| accounts:EDIT               | A         | A         | R        | B      | T        | O         | —         | —        | —         | —       | —         | —       | —         |
| contacts:VIEW               | A         | A         | R        | B      | T        | T         | T         | A        | T         | A       | T         | A       | T         |
| activities:VIEW             | A         | A         | R        | B      | T        | O         | O         | A        | —         | B       | T         | A       | T         |
| activities:CREATE           | ✓         | ✓         | ✓        | ✓      | ✓        | ✓         | ✓         | ✓        | ✓         | ✓       | ✓         | —       | —         |
| tasks:VIEW                  | A         | A         | R        | B      | T        | O         | O         | O        | O         | B       | T         | A       | T         |
| tasks:ASSIGN                | A         | A         | R        | B      | T        | —         | —         | —        | —         | B       | —         | —       | —         |
| documents:VIEW              | A         | A         | R        | B      | T        | O         | O         | —        | —         | B       | T         | A       | —         |
| documents:DELETE            | A         | —         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| tickets:VIEW                | A         | —         | —        | B      | —        | —         | —         | —        | —         | A       | T         | A       | T         |
| tickets:EDIT                | A         | —         | —        | —      | —        | —         | —         | —        | —         | A       | T         | —       | —         |
| products:VIEW               | A         | A         | A        | A      | A        | A         | A         | A        | A         | A       | A         | A       | A         |
| products:EDIT               | ✓         | ✓         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| fieldsales:VIEW             | A         | A         | R        | B      | T        | —         | O         | —        | —         | —       | —         | A       | —         |
| fieldsales:CREATE           | ✓         | —         | —        | —      | —        | —         | ✓         | —        | —         | —       | —         | —       | —         |

### Marketing and configuration

| Module                            | org_admin | sales_dir | regional | branch | team_mgr | sales_rep | field_rep | mktg_mgr | mktg_exec | svc_mgr | svc_agent | analyst | read_only |
| --------------------------------- | --------- | --------- | -------- | ------ | -------- | --------- | --------- | -------- | --------- | ------- | --------- | ------- | --------- |
| campaigns:VIEW                    | A         | A         | R        | B      | —        | —         | —         | A        | O         | —       | —         | A       | —         |
| campaigns:EDIT                    | A         | —         | —        | —      | —        | —         | —         | A        | O         | —       | —         | —       | —         |
| forms:MANAGE_CONFIGURATION        | ✓         | —         | —        | —      | —        | —         | —         | ✓        | —         | ✓       | —         | —       | —         |
| landingpages:MANAGE_CONFIGURATION | ✓         | —         | —        | —      | —        | —         | —         | ✓        | —         | —       | —         | —       | —         |
| communications:CREATE             | ✓         | ✓         | ✓        | ✓      | ✓        | ✓         | ✓         | ✓        | ✓         | ✓       | ✓         | —       | —         |
| automation:MANAGE_AUTOMATION      | ✓         | —         | —        | —      | —        | —         | —         | ✓        | —         | ✓       | —         | —       | —         |
| distribution:MANAGE_CONFIGURATION | ✓         | ✓         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| sla:MANAGE_CONFIGURATION          | ✓         | —         | —        | —      | —        | —         | —         | —        | —         | ✓       | —         | —       | —         |
| reports:VIEW_REPORTS              | A         | A         | R        | B      | T        | O         | O         | A        | O         | A       | T         | A       | T         |
| reports:CREATE                    | ✓         | ✓         | ✓        | ✓      | —        | —         | —         | ✓        | —         | ✓       | —         | ✓       | —         |
| dashboards:CREATE                 | ✓         | ✓         | ✓        | ✓      | —        | —         | —         | ✓        | —         | ✓       | —         | ✓       | —         |
| users:MANAGE_USERS                | ✓         | —         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| roles:MANAGE_USERS                | ✓         | —         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| settings:MANAGE_CONFIGURATION     | ✓         | —         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| integrations:MANAGE_CONFIGURATION | ✓         | —         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| apikeys:ACCESS_API                | ✓         | —         | —        | —      | —        | —         | —         | —        | —         | —       | —         | —       | —         |
| auditlogs:VIEW                    | A         | —         | —        | —      | —        | —         | —         | —        | —         | —       | —         | A       | —         |

Administrators may edit every cell of this matrix per role, per module, per action.
The table above is only the seeded default.

## 5. Field-level permissions

`FieldPermission(roleId, objectType, fieldKey)` carries `canView`, `canEdit` and a
`maskStrategy`. Applied to built-in fields and custom fields alike.

| Strategy       | `+971501234567` becomes                 |
| -------------- | --------------------------------------- |
| `HIDE`         | field absent from the response entirely |
| `MASK_ALL`     | `•••••••••`                             |
| `MASK_PARTIAL` | `+9715•••••67`                          |
| `MASK_EMAIL`   | `y•••@example.com`                      |

Rules that hold everywhere:

- Masking happens in the serialiser, so masked values never leave the process —
  not in list APIs, not in exports, not in report output, not in webhook payloads,
  not in AI prompts.
- A field the actor cannot edit is dropped from the write payload before validation,
  so a crafted request cannot smuggle it in.
- Reading a field marked `isSensitive` writes a `SENSITIVE_FIELD_VIEWED` audit row.
- Filtering and sorting on a hidden field is rejected — otherwise a masked value is
  recoverable through binary search on filters.

## 6. Seeded permission catalogue

24 modules × the 15 actions in `PermissionAction` = the `Permission` table. Not
every pair is meaningful (`products:REASSIGN` is not), so the seed inserts only the
valid pairs — 214 rows. `RolePermission` then grants a subset per role with a scope.

## 7. Test obligations (Phase 1 exit)

| Test                            | Asserts                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tenant/isolation.spec.ts`      | tenant B's records are invisible on every list, get, update, delete, export and report endpoint |
| `tenant/prisma-guard.spec.ts`   | a query issued without `tenantId` throws before reaching Postgres                               |
| `permission/scope.spec.ts`      | a rep sees only own leads; a team manager sees the team; a branch manager sees the branch       |
| `permission/field.spec.ts`      | hidden fields absent from list, detail, export and webhook payloads                             |
| `permission/escalation.spec.ts` | a rep cannot grant themselves a permission or change their own role                             |
| `permission/export.spec.ts`     | export restriction is enforced server-side even when the client requests all columns            |
| `permission/api-key.spec.ts`    | a revoked key returns 401; a key cannot exceed its role's scope                                 |
| `permission/automation.spec.ts` | an automation action cannot write a record its owning tenant does not own                       |
