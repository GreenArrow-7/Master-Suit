# Change impact guide

Before you change one of these areas, this is what else it reaches and which
tests will tell you if you broke it. Paths relative to `apps/web/`.

| | |
| --- | --- |
| Branch | `claude/ponytail-lite-0e416b` |
| Commit | `babbaa06db5620590e1308a6a1fa94054b304992` |
| Analysed | 12 Nov 2026 |

Fan-in figures come from the Graphify dependency graph (10,206 nodes, 36,388
edges) and mean: how many other files depend on this one.

---

## The blast-radius table

Change anything in the top rows and you are changing the whole product.

| File | Fan-in | What it decides |
| --- | --- | --- |
| `src/lib/db.ts` | **736** | Tenancy guard, `withTx`, `withPlatformTx`, the connection pool |
| `src/lib/errors.ts` | 254 | Every thrown HTTP error shape |
| `src/lib/api/handler.ts` | 245 | The prologue for all 253 API routes |
| `src/lib/security/entitlements.ts` | 239 | Module entitlement and workspace landing |
| `src/lib/security/rbac.ts` | 236 | Permission, scope, role authority |
| `src/lib/workspace-page.ts` | 144 | Page-level entitlement and permission |
| `src/lib/security/record-scope.ts` | 114 | Every by-id access check |
| `src/lib/security/audit.ts` | 105 | The audit trail |

**Always run for a change to any of the above:**

```bash
npx vitest run tests/permission tests/tenant tests/security
npx tsc --noEmit
```

---

## Lead assignment and distribution

**Touch any of these and all of them are in scope** — they are one mechanism
spread over four files.

| Change this | Also reaches |
| --- | --- |
| `services/distribution/assignLead.ts:223` | the rotation (`turns:206`, `weightedSlots:192`), triage fallback, owner notification |
| `services/distribution/eligibility.ts:200` | **automatic assignment, bulk allocate, cross-team route AND manual triage placement** — one gate, four callers |
| `services/distribution/allocation.ts` | `FOR UPDATE SKIP LOCKED` bulk allocate, claim, cross-team route |
| `services/distribution/triageQueue.ts:193` | manual placement of a waiting lead |
| `services/sla/checkLeadFirstContact.ts` | re-assignment on breach — calls `assignLead` again |

**Non-obvious consequences:**

- Eligibility reads **HR data**: approved leave, roster entries, standing
  shifts, holidays, the check-in cut-off. A change to `HrLeaveRequest`,
  `HrRosterEntry`, `HrEmployeeShift` or `HrHoliday` can change who gets leads.
- HR-sourced refusal reasons are flattened to a single `UNAVAILABLE` **before
  they are persisted** into the triage entry (`eligibility.ts:120`), not at
  render time. If you move that, you leak why someone is away into a sales
  screen.
- `assignLead` is enqueued, not called inline. Changing its signature means
  changing the job payload in `workers/jobs.ts`, and a rolling deploy will have
  old and new side by side.
- **Manual lead creation never reaches this code** — `createLead.ts:173` always
  sets an owner, so `{ skip: !!ownerId }` at `:253` always skips. If you intend
  manual creation to distribute, that is a behaviour change, not a bug fix.

**Tests to run:**

```bash
npx vitest run tests/sales/allocation.spec.ts tests/sales/assignment-working-hours.spec.ts tests/sales/lead-triage.spec.ts tests/sales/lead-triage-worker.spec.ts tests/sales/triage-completion.spec.ts tests/sales/sla-escalation.spec.ts
```

---

## The lead list, grid, board and export

**One query serves four surfaces.** `leadListQuery` (`services/leads/leadList.ts:166`)
is used by the grid, the board (same `where` object), the export route and the
mobile list. A change here changes every lead count a user sees.

| Also reaches |
| --- |
| `lib/leads/boardFilter.ts` (`boardWhere` — the board, Follow-ups, Calls, Tasks, Site visits lists) |
| `lib/leads/followUpDue.ts` (`followUpDueWhere` — due/overdue on the workspace's clock) |
| `services/leadership/reports.ts` (`reportParams` reads the same URL parameters) |
| `services/leads/createLead.ts` (`leadSearch`) |
| `lib/api/pagination.ts` (`cursorWhere` — the keyset) |

**Watch for:** `GET /api/v1/leads` is a **separate** assembly
(`app/api/v1/leads/route.ts:55-104`) with none of the chips. If you add a filter
to `leadListQuery`, the REST list API will not have it.

**Tests to run:**

```bash
npx vitest run tests/unit/lead-named-filters.spec.ts tests/sales/lead-kanban.spec.ts tests/sales/lead-grid-pages.spec.ts tests/sales/lead-saved-views.spec.ts tests/sales/xlsx-export.spec.ts tests/permission/lead-record-scope.spec.ts
```

`tests/unit/lead-named-filters.spec.ts:83` asserts the page source and the
export source both literally contain `leadListQuery(ctx, params, rules)` — so a
divergence fails CI rather than shipping two different numbers.

---

## Roles, permissions and scopes

| Change this | Also reaches |
| --- | --- |
| `lib/security/rbac.ts` | 236 dependents — every route and page |
| `lib/security/permissionCatalogue.ts` | the role editor's matrix, **and the CI permission-catalogue gate** |
| `services/identity/roles.ts` | role CRUD, the matrix, assignment history |
| `services/platform/provisioning.ts:135-171` | Lead Eagle's five starter roles for **new** workspaces only — existing ones are never reseeded |
| `services/platform/createWorkspace.ts:171-190` | Company Admin, derived from every `Permission` row |

**Non-obvious consequences:**

- Adding a permission changes what Company Admin holds **in new workspaces
  only**. Existing workspaces keep the role rows they have.
- `services/hr/access.ts` holds HR's own predicates, and HR's TEAM means direct
  reports only. A change to the general scope ladder does not change HR.
- The CI gate at `.github/workflows/ci.yml:198` checks the permission catalogue;
  a new permission that is not registered fails the build.

**Tests to run:**

```bash
npx vitest run tests/permission tests/security/platform-admin-crud.spec.ts tests/tenant/provision-lead-work.spec.ts tests/platform/workspace-edit-entitlements.spec.ts
```

---

## Payroll

| Change this | Also reaches |
| --- | --- |
| `services/hr/payroll.ts` | the whole run lifecycle, payslips, the register report |
| `services/hr/overtime.ts:593` | `approvedOvertimeMinutes` is **consumed by `calculateRun`** |
| `services/hr/attendance.ts` | punches become days become unpaid-day deductions |
| `services/hr/wps.ts` | the SIF file, keyed on `EmployeeProfile.wpsPersonId` / `bankAgentId` |
| `services/hr/lifecycle.ts:433` | `settlementFor` — gratuity and unused leave on offboarding |

**Non-obvious consequences:**

- **Maker-checker is on the record, not the role.** Whoever is stamped
  `preparedById` cannot approve the run (`payroll.ts:649-651`). Do not "fix" a
  403 here by relaxing the permission.
- `lockRun` (`:686-700`) stamps the overtime claims and adjustments the run
  consumed so they cannot be re-decided or re-paid. Changing what a run consumes
  means changing what lock stamps.
- An employee reads only their own payslip and only once the run is
  APPROVED/LOCKED/PAID (`:809`, `:836`), and each view writes a
  `DOCUMENT_ACCESSED` audit row.
- `HrSettlementSnapshot` inlines the whole policy so the figure stays
  re-derivable after someone edits the rates. Do not normalise it away.

**Tests to run:**

```bash
npx vitest run tests/hr/payroll.spec.ts tests/security/hr-action-authority.spec.ts tests/hr/reports.spec.ts tests/hr/overtime.spec.ts tests/hr/pdf.spec.ts
```

---

## AI configuration and ONE AI

| Change this | Also reaches |
| --- | --- |
| `lib/ai/provider.ts` | **every** AI feature — it is the only file that knows a provider's wire format |
| `lib/ai/gemini.ts:70` | credential resolution for the assistant, analysis, audit, coach, drafts |
| `lib/ai/assistant/tools.ts` | the 16 tools **and** Test connection, which imports `TOOLS` to validate |
| `lib/ai/usage.ts` / `allowance.ts` | budget ceilings at platform → provider → workspace → user → feature |
| `lib/integrations/verify.ts:93` | Test connection — the Google branch sends real tool declarations |

**Non-obvious consequences:**

- **Adding or changing a tool changes Test connection.** `verify.ts:184-194`
  imports `TOOLS` and sends every declaration to Google. A malformed schema
  turns a working connection ERROR — and that is the point: it is how #248's
  total outage would now be caught.
- **A tool with no arguments is the known trap.** `getMyDay` declares
  `parameters: { type:'object', properties:{} }`, which Google rejects. The fix
  lives in the translation (`provider.ts:378-380` omits `parameters` when the
  schema has no properties), not in the tool — so a tool added tomorrow cannot
  reintroduce it. Do not move that logic into the tool definitions.
- **A new tool must declare `requires`.** `tests/security/assistant-guardrails.spec.ts:155`
  fails otherwise. It must also scope its own rows — the declarative check only
  gates the verb.
- The assistant has **no model cascade** (`service.ts:178` resolves one model);
  analysis and audit do. If you add fallback, add it there, not in `provider.ts`.
- A workspace whose connection is ERROR must **not** fall back to the deployment
  key (`gemini.ts:94-98`), asserted by
  `tests/tenant/gemini-broken-connection-no-fallback.spec.ts`.

**Tests to run:**

```bash
npx vitest run tests/security/assistant-guardrails.spec.ts tests/unit/ai-provider.spec.ts tests/unit/ai-provider-label.spec.ts tests/tenant/gemini-key.spec.ts tests/tenant/gemini-broken-connection-no-fallback.spec.ts tests/unit/assistant-failure.spec.ts tests/unit/ai-cascade.spec.ts
```

---

## The API kernel

Changing `lib/api/handler.ts` changes all 253 routes. Specifics:

- **Order is the contract:** auth → rate limit → entitlement → permission →
  sensitive marking → caps → validation → idempotency → handler → audit →
  scrub. Reordering changes what a refused caller learns.
- **The array cap is counted before zod runs.** Moving it after means a 20,000
  entry body is parsed before being refused.
- **Idempotency is not atomic** (`:411-419`) and its failure is swallowed. Any
  write that must never double hands its key to its service instead
  (`services/idempotency.ts` `claimKey`/`completeClaim`; the pattern is in
  `services/leads/logCall.ts`).
- **A replay skips the audit row** (`:279` vs `:283`). If you change the replay
  branch, check that.
- Adding or changing a route's schemas means regenerating the OpenAPI document:
  `OPENAPI_WRITE=1 npx vitest run tests/unit/openapi.spec.ts`.

**Tests to run:**

```bash
npx vitest run tests/unit/openapi.spec.ts tests/unit/mutation-audit.spec.ts tests/sales/idempotency-key.spec.ts tests/security/guarded-prologue.spec.ts
```

---

## Money: commissions, collections, payouts

| Change this | Also reaches |
| --- | --- |
| `services/money/commissions.ts` | the ledger, clawbacks, reconciliation, and what a payout can cover |
| `services/money/collections.ts` | receipts, verification, `assertCovered`, `lockBooking` |
| `services/money/payouts.ts` | runs, netting, approval, the only thing that marks a commission PAID |
| `services/money/slabs.ts` | `applySlab`, `splitAmount`, band validation |
| `app/api/v1/bookings/route.ts:242` | `moveUnitIn` — the double-sale control |

**Non-obvious consequences:**

- The ledger is **never edited backwards**. A cancellation writes a negative
  reversal row. Do not add an update path.
- Separation of duties lives in the **service** so no route can skip it:
  `payouts.ts:185`/`:191` and `collections.ts:457`.
- An APPROVED payout whose commissions changed drops back to DRAFT
  (`collections.ts:586-598`).
- `accrueCommission` currently has **no record-scope check** on the booking. If
  you add one (you should), expect tests that accrue across scopes to change.

**Tests to run:**

```bash
npx vitest run tests/sales/payouts.spec.ts tests/sales/collections.spec.ts tests/sales/commissions.spec.ts tests/sales/fee-amendments.spec.ts tests/sales/bookings-route.spec.ts
```

---

## Attendance and the face service

| Change this | Also reaches |
| --- | --- |
| `services/hr/attendance.ts` | check-in, the day roll-up, **and lead distribution eligibility** |
| `services/hr/face.ts` | the HTTP client; matching and liveness are done **here**, not in Python |
| `apps/face/` | the Python engine — changing its response shape breaks `face.ts:152-240` |
| `services/hr/rules.ts` | the check-out rules and the work gate |

**Non-obvious consequences:**

- Check-in works in a workspace with **no HRMS**, through the self-service route
  that asserts no entitlement at all (`.../hr/self/[action]/route.ts:50-59`).
  Adding an entitlement assert there would break every Sales-only workspace.
- A refused punch is still written as an `HrAttendancePunch`, with its frames
  kept. That is what Face Activity reads.
- Changing who is "off shift" changes who receives leads.

**Tests to run:**

```bash
npx vitest run tests/hr/attendance-manager.spec.ts tests/hr/punch-validation.spec.ts tests/hr/punch-rejections.spec.ts tests/hr/self-service-route.spec.ts tests/hr/checkout-work-gate.spec.ts tests/hr/roster.spec.ts
```

The real engine is exercised only by the `face-e2e` CI job
(`.github/workflows/ci.yml:580`) with `FACE_E2E=required`.

---

## Background jobs and queues

- `workers/jobs.ts` must stay a **literal** — the CI observability gate parses it
  with a regex (`scripts/check-observability.mjs:109-119`,
  `.github/workflows/ci.yml:319`).
- `JOBS` is `Record<QueueName, Jobs>`, so an undrained queue or orphan consumer
  is a compile error.
- An **unknown job name is acknowledged and discarded** (`jobs.ts:67-71`). During
  a rolling deploy where web updates before worker, a renamed job is silently
  lost. Keep an alias, as `hr-event-push` does.
- `maintenance` allows **one attempt** — the next sweep is the retry — and runs
  one job at a time, so a long job delays the five-minutely sweeps.

**Tests to run:**

```bash
npx vitest run tests/unit/observability.spec.ts tests/tenant/queue-fairness.spec.ts tests/sales/lead-triage-worker.spec.ts
```

---

## Adding a page or a route

| Doing this | Must also do |
| --- | --- |
| Adding a page in a module folder | Assert its module in the page itself — `tests/permission/page-access.spec.ts` fails otherwise |
| Adding a page under `realty/` or `lead-eagle/` | Make it a re-export of the `sales/` page — `tests/unit/realty-routes.spec.ts` / `lead-eagle-routes.spec.ts` guard it |
| Adding a mutating API route | Declare `auditEvent`, audit in the handler, or register it in `tests/unit/mutation-audit.spec.ts` |
| Changing a route's schemas | `OPENAPI_WRITE=1 npx vitest run tests/unit/openapi.spec.ts` |
| Adding a platform console page | It must pass `tests/security/platform-page-guard.spec.ts:75` |
| Adding a screen that reads several lists | Read them in **one** `withTx` — the pool holds 10 and one render may take half; `tests/sales/screen-connections.spec.ts` measures it |

---

## The full gate before a pull request

From `apps/web`:

```bash
npx tsc --noEmit && npm run lint && npm run format:check
```

```bash
npx vitest run
```

```bash
npx next build
```

Browser tests run on PRs to `main` and pushes to `main` only. CI additionally
gates the permission catalogue, schema drift, tenant isolation, raw-SQL scope,
observability drift, Redis auth, the face token and model download, the backup
round trip and `npm audit` — all 11 gates verified present at this commit.
