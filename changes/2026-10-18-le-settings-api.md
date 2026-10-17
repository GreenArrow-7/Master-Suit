# Lead settings: required custom fields on Add lead, the lead form layout, holidays in assignment, brand colours on the QR page, a paged Audit Log, and the OpenAPI document

**18 Oct 2026** · feature · Lead Eagle, admin, allocation, audit, API (audit M18-02, M18-03, M18-04, M18-08, M18-09, M18-11, M18-12, M18-13, M19-01)

**What.** Lane settings-api of the 11 Oct requirements audit (#214), re-checked
against `main` first:

- **M18-02 sources — already done** by #169 (catalogue, sub-sources, pickers, reports by entry).
- **M18-13 export log — already done** by #159 (`EXPORT_REQUESTED` with report, range and rows on a report CSV).
- **M18-03 custom fields.** The Add lead form shows the workspace's active custom
  fields, the required ones starred. A person creating a lead without a required
  field gets 422 naming it (`custom.<key>`); an API key still lands its lead. The
  lead CSV carries a custom field's column when the grid shows it (`cf:<key>`).
- **M18-04 lead form layout.** Administration → Settings → Custom Fields has a
  Lead form card: the order of the Add lead form after Full name, and a Shown box
  per field. A hidden field leaves the form and the lead page's Details card
  (Other numbers included). Phone and Source cannot be hidden.
- **M18-08 holidays.** A rule that respects working hours passes over everyone on
  a confirmed holiday of the workspace's register (`holiday (<name>)`, on the
  waiting-queue entry when nobody is left). The register opens to every workspace:
  Administration → Holidays without People, People → Holidays with it. A rule's
  "respect working hours" can be set from the API and the Allocation panel.
- **M18-09 branding.** Company profile sets the brand and accent colours. The QR
  capture page (`/c/{ws}/{key}`) shows the workspace's logo and a brand-colour
  rule, as `/p` and `/s` do.
- **M18-12 Audit Log.** Pages by keyset (Older / Newest, across both logs) and
  narrows to a range of the workspace's days.
- **M19-01 OpenAPI.** `GET /api/v1/openapi.json` (public) serves an OpenAPI 3.1
  document built from every route's `route()` spec: path, query and body schemas,
  the permission (`x-permission`), product modules and security. `docs/03-API.md`
  no longer claims a browsable `/api-docs`.
- **M18-11 retention — needs the owner** (below).

**One migration (114 in all):** `20261018093700_lead_form_layout` adds
`OrganizationSetting.leadFormLayout` (JSONB, default `[]`). Additive.

**Why.** The owner-approved audit rows above; the lane brief of 18 Oct.

**Where** (under `apps/web/`)

- `src/lib/api/handler.ts`: `route()` keeps its spec on the handler (`handler.spec`).
- `src/lib/api/openapi.ts`: zod (v3) → JSON Schema, route file → path, the document.
- `public/openapi.json` (generated), `src/app/api/v1/openapi.json/route.ts` (serves it).
- `src/services/leads/customFields.ts`: `customForCreate(…, { required })`; `createLead` takes `requireCustom`; `api/v1/leads` passes it unless an API key calls.
- `src/app/api/v1/leads/export/route.ts`: custom columns.
- `src/components/forms/CustomFieldInput.tsx`: the control by type, moved out of `LeadDetail.tsx`.
- `src/lib/leads/formLayout.ts`: the fields, `leadFormLayout`, `layoutBody`. `api/v1/lead-form-layout` (PUT, `settings:MANAGE_CONFIGURATION`, audited).
- `sales/leads/new/{page,LeadForm}.tsx`, `sales/leads/[id]/{page,LeadDetail}.tsx`, `admin/custom-fields/{page,FormLayout}.tsx`.
- `src/services/distribution/eligibility.ts`: `holidayNow`; `services/distribution/rules.ts` and `api/v1/distribution-rules`: `respectWorkingHours`; `sales/allocation/{page,RulesPanel}.tsx`.
- `api/v1/workspaces/{ws}/hr/[resource]`: `holidays` joins the resources every workspace may use; `people/holidays/page.tsx` asserts any module; `admin/holidays/page.tsx` re-exports it; nav entry `Holidays` (Administration, without People).
- `api/v1/workspaces/{ws}/settings/[section]` (company: `primaryColor`, `accentColor`, `#RRGGBB`), `admin/[section]` (colour fields), `c/[workspaceSlug]/[key]/page.tsx`.
- `admin/audit/page.tsx`: `before` cursor (`<ISO>|<id>`), `from`/`to`.

**Behaviour.**

- A workspace with a required custom field: Add lead asks for it; leads from the
  API, the import, forms and portals land as before.
- Hiding a field in the layout removes it from Add lead and from Details; values
  already on leads stay.
- On a confirmed holiday, automatic assignment queues every new lead for a
  leader (where its rule respects working hours, the default) and says why.
  Provisional holidays block nobody.
- The Audit Log keeps 150 rows a page and shows an Older link when there are more.

**Decisions taken.**

- Required custom fields are asked of a person, not of an API key: a machine that
  leaves a field out must not lose the lead (as intake already behaves).
- The layout orders and hides the system fields; custom fields keep their own
  order and switch. Phone and Source are never hidden (calling and routing).
- Other numbers are added on the lead page, so hiding them affects the lead page
  only; Lead.secondaryPhone (the audit's example) is not on any screen.
- Holidays are the existing register (`HrHoliday`), opened to every workspace;
  editing it needs `employee:EDIT` at organisation scope, as in HR.
- The OpenAPI document is generated into `public/openapi.json` and kept equal to
  the routes by `tests/unit/openapi.spec.ts` (run it with `OPENAPI_WRITE=1` after
  changing a route's schemas or adding a route; the file is prettier-ignored and
  compared parsed). It is public. No OpenAPI dependency was added: the spec
  lints what a linter checks first (3.1.0, unique operationIds, every path
  parameter declared and required, every `$ref` resolves).

**Verified.**

- New, failing on the old code: `tests/unit/openapi.spec.ts` (4), `tests/sales/audit-log-paging.spec.ts` (2), in `tests/sales/custom-fields.spec.ts` the M18-03 case and the three layout cases, in `tests/sales/assignment-working-hours.spec.ts` the two holiday cases, the company-colour case in `tests/permission/admin-editors.spec.ts`, the capture-page case in `tests/sales/forms-lead-eagle.spec.ts`, and the `respectWorkingHours` assertions in `tests/sales/distribution-rules.spec.ts`.
- Run together with `tests/unit` and the existing specs for every area touched (lead fields, triage, SLA, audit trail, page access, field security, record scope, entitlement, the security prologue, secret egress, HR write verbs, lead page connections, saved views, search, provisioning, reports): 92 files, 2,226 passed, 2 skipped (POSIX-only, on Windows). tsc clean; eslint no errors; migration applied on the rig.
- Not checked in a browser here (rig rules); `tests/e2e/every-route.spec.ts` now also opens `admin/holidays`.

**Review fixes.** Two reviews found five defects; each has a case that failed first.

- The Audit Log's From/To took any `NNNN-NN-NN`, and `?from=2026-00-10` crashed
  the page in `dayBounds`. `isDayKey` (lib/leads/followUpDue.ts) itself threw on
  a zero month or day; it is now `parseTypedDate(value) === value`, and the page
  uses it (also the follow-ups API's `date` and the board's range).
- Add lead never showed the server's refusal of a custom field: `applyProblem`
  cut `custom.<key>` to `custom`, which nothing renders. It keeps the full
  path when the form has a control by that name (`errorKey`,
  tests/unit/form-errors.spec.ts).
- A workspace zone Intl does not know ("GST") made every automatic assignment
  throw once holidays were checked. `knownTimeZone` (services/hr/rules.ts,
  now behind `workspaceTimezone` too) falls back to Asia/Dubai in both
  holiday and shift checks.
- The OpenAPI document copied a case-insensitive regex as a case-sensitive
  pattern (campaign `code`). A regex with i, m or s flags is no longer
  documented as a pattern.

**Left open.**

- **M18-11 (owner):** the retention window per data class (audit log, attendance
  punches, AI events, leads) and whether a workspace may shorten the deployment's
  window or only lengthen it. `src/lib/jobs/retention.ts` deletes nothing without
  a number on purpose; a per-workspace override is a small change once decided.
- Logo upload to object storage (M18-09): the logo is still a URL.
- Per-user weekday hours for workspaces without rosters (M18-08): `User.workingHours` exists, unused and unedited.
- Responses in the OpenAPI document carry no schemas (handlers return untyped objects).
- The other non-GET routes without an `auditEvent` (M18-12) are listed in `changes/2026-10-11-report-export-audit.md`.
