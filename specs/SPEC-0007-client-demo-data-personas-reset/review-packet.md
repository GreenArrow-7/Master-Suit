# SPEC-0007 — Human code-review packet (FINAL)

| Field | Value |
|---|---|
| Specification | `SPEC-0007` |
| Risk | `R3` |
| Prepared | 2026-09-08, by an AI agent |
| Decision required | `APPROVE` · `REQUEST_CHANGES` · `BLOCKED` |
| Reviewer | 1 human reviewer (R3). **This packet records no decision.** |

An agent prepared this. It is not a review, and nothing in it discharges a gate.
This supersedes the interim packet: it reflects the final diff, after `CL-007`
and the two defects that followed it.

## A · Business scope

The People module had configuration and employee profiles but no attendance,
leave, shifts or holidays, so every HR screen past the directory was empty.
This adds a deterministic synthetic HR dataset, a login for the HR persona that
did not exist, and a guard that stops a future model escaping the demo reset.

- **Sales demo reused, not rebuilt.** Audited screen by screen; every one
  already populated. No Sales records were added.
- **HRMS dataset added.** The whole of the new data.
- **Three personas**, all on existing catalogue roles.
- **Reset verified**, not extended — see `CHG-002`.
- **No deployed environment.** That is `SPEC-0008`, R5, unsigned.

## B · Dataset — measured, not intended

| | |
|---|---|
| Employee profiles | **41** (40 active, **1 intentionally suspended**) |
| Departments | **5**, none empty |
| Designations | **8** |
| Shifts / Holidays / Leave types | **2** / **6** / **4** |
| Leave balances | **160** (40 active × 4) |
| Leave requests | **18** — 9 approved, 5 pending, 4 rejected |
| Attendance | **1800** over **45** working days |
| Attendance mix | PRESENT 1433 · LATE 179 · REMOTE 125 · ABSENT 49 · ON_LEAVE 14 |

Identical on a fresh seed and on a top-up; identical fingerprint after a
modify-and-reset cycle.

## C · Defects found and fixed — all five surfaced by running the code

1. **Timezone drift.** `workDate` built from local midnight put **360 rows**
   (40 employees × 9 Sundays) on **Saturdays** on this UTC+3 host. Everything is
   UTC now. This is the `SPEC-0004` class of host-dependent defect that
   `NFR-002` forbids.
2. **Duplicate empty departments.** The generator created five of its own beside
   the four the Sales seed already had — seven, of which three had no employees.
   Now reuses the existing four and adds Finance.
3. **Missing `hr_admin` persona.** The role was in the catalogue but held by
   nobody, so the HRMS demonstration had no login at all.
4. **Suspended user / active profile.** The seed suspends a rep *after* writing
   employee profiles and updated only the `User`. A fresh seed reported 41
   active employees and a top-up reported 40 — the same database, two answers.
   Pre-existing; exposed by requiring per-employee coverage.
5. **Account book not idempotent.** The spotlight handed the account manager
   *8 more* accounts every seed, so fresh-then-top-up left her owning all 12 and
   **emptied the Sales persona's accounts screen** (reps see accounts at TEAM
   scope). Pre-existing; exposed by the fresh-vs-top-up regression added for
   `CHG-001`. Now capped at 8 and stable.

Plus **four defects in my own tests**, each commented at the site: an empty-state
assertion that failed a legitimately two-section page; selectors assuming a
`<main>` element and row anchors that do not exist; a credential scan that
flagged `const DEMO_PASSWORD = process.env.DEMO_PASSWORD`; and a scan that
flagged the one-character `postgresql://u:p@` placeholders used to test the
database-name gate.

## D · Change records and clarifications

| Id | Disposition |
|---|---|
| `CHG-001` | **Approved with amendment.** `FR-002`'s 24–30 cap replaced by an invariant over all active profiles, floor 24, fixture expectation 41 and explicitly not a ceiling |
| `CHG-002` | **Approved.** `FR-011`'s premise was false — the reset already cleared HR via `tenant.delete()` and 187 of 188 cascade relations. No teardown code written |
| `CL-004` | **Resolved.** Payroll out of scope; nothing seeded, nothing fabricated |
| `CL-005` | **Resolved.** 45 working days; model-supported statuses only; no invented `HALF_DAY` |
| `CL-007` | **Resolved.** All demo addresses moved to reserved domains |

**`CL-007` carried a trap worth reviewing.** Two pieces of logic selected the
personas by **domain suffix**. After moving them to `example.com`, that suffix
matches *every* seeded account — the un-suspend repair would have **revived the
deliberately suspended rep**, and the spotlight would have given all forty logins
the persona treatment. Both are now keyed on an explicit `DEMO_PERSONA_EMAILS`
list. Product code (`instagramHandle`), the tenant `primaryDomain` and non-address
URLs were left alone: they are not electronic addresses.

## E · Security

Asserted at the **route handler**, never the navigation — page-level checks all
returned 200 because the pages render a refusal, so a page-level suite would
have been green and worthless.

| Check | Result |
|---|---|
| `sales_rep` → HR resources | refused |
| `hr_admin` → leads / opportunities / accounts | refused |
| All three personas → platform control plane | refused |
| Demo workspace ↔ second workspace, both directions | refused |
| `org_admin` | tenant-scoped, **not** a platform administrator |
| Seed/reset refusal gates | all four refuse **before any write**, row counts unchanged |
| Outbound | mock providers; **zero** integration connections |
| Sensitive data | **zero** compensation, payroll, payslip, face template, biometric consent, attendance punch; **zero** profiles with IBAN, bank, WPS or salary |
| Email domains | **41 of 41** on `example.com` (RFC 2606) |

## F · Database

**No schema change. No migration. No RLS change.** `npm run check:drift` reports
*No difference detected*; `schema.prisma` and `migrations/` are untouched in
`git status`.

## G · Tests

| Suite | Result |
|---|---|
| SPEC-0007 vitest (5 files) | **47 passed** |
| `tests/hr` + persona security, serial | **447 passed / 28 files** |
| Playwright `demo-walkthrough` | **5 passed** |
| `tsc --noEmit` / `eslint` | **0 errors** each |
| `check:drift` / `check:test-data` | **pass** |
| B2 validator / B3 agent | **93/93** · **70/70** |
| `validate --all` / SPEC-0007 | **PASS**, 0 errors |
| Scope-check ×4 · `verify-session` | **PASS**, 4 sessions / 4 verification records |

### Baseline comparison — controlled attribution

Same command, same Node, same linked `node_modules`, same `.env.test`, same
database, same `--no-file-parallelism`. **B** is a temporary worktree at
`f16ed67`, the commit before this work, since removed.

| | A · SPEC-0007 | B · baseline `f16ed67` |
|---|---|---|
| Test files | 5 failed / **157** | 5 failed / **152** |
| Tests | **24 failed** / 1939 passed / 1963 | **24 failed** / 1891 passed / 1915 |
| Failing files | `assistant-guardrails`, `guarded-prologue`, `capture-vault`, `env-example-parses`, `observability` | **the same five** |

**The failure set is identical.** SPEC-0007 adds exactly 5 test files and 48
tests — 14 + 5 + 9 + 4 + 16 — and **all 48 pass**.

| Classification | Count |
|---|---|
| `INTRODUCED_BY_SPEC_0007` | **0** |
| `PRE_EXISTING_BASELINE` | **24**, reproduced identically at `f16ed67` |
| `ENVIRONMENTAL` | previously ~16–21, now **resolved** — `rls`, `pooling`, `reference`, `ai-usage-console`, `guard-exemptions`, `service-identity-browser` all pass once `.env.test` supplies `RLS_DATABASE_URL` and a matching `APP_URL` |
| `FLAKY_NON_DETERMINISTIC` | **0** — both runs produced the same set |
| `UNKNOWN` | **0** |

SPEC-0007 does not increase the failure set. The 24 pre-existing failures are
**not** in security or tenant-isolation behaviour: they are AI tool-declaration
coverage, a prologue-reimplementation scan, capture-vault (SPEC-0005's own
in-flight subject), example-env schema parsing, and observability config.

## H · Final diff — twelve files

| File | Purpose | Risk |
|---|---|---|
| `apps/web/prisma/seed/hr.ts` | new · the HR generator | The UTC block is the part to read twice |
| `apps/web/prisma/seed/index.ts` | persona list, HR call, suspended-rep fix, un-suspend repair re-keyed | Touches account state; read the two comments |
| `apps/web/prisma/seed/crm.ts` | spotlight keyed on the persona list; account book made idempotent; one synthetic from-address | Changes which accounts the demo manager owns |
| `apps/web/tests/hr/demo-dataset.spec.ts` | new · 14 cases | — |
| `apps/web/tests/hr/demo-reset-coverage.spec.ts` | new · 5 cases | — |
| `apps/web/tests/hr/demo-reset.spec.ts` | new · 9 cases, spawns the seed | Destructive; must run with `--no-file-parallelism` |
| `apps/web/tests/hr/demo-docs.spec.ts` | new · 4 cases | — |
| `apps/web/tests/security/demo-personas.spec.ts` | new · 16 cases | — |
| `apps/web/tests/e2e/demo-walkthrough.spec.ts` | new · 5 Playwright cases | — |
| `apps/web/scripts/demo-smoke.mjs` · `mobile-audit.mjs` · `ensure-workspace-admin.mjs` | default/example addresses updated for `CL-007` | Defaults only |
| `docs/DEMO.md` | the runbook | — |

Not part of this change and **must not be committed with it**: the transferred
governance corpus (`docs/sdd/`, `docs/evidence/`, `docs/EVIDENCE_CONFLICTS.md`,
`docs/RISK_CLASSIFICATION.md`) and two files belonging to other specifications
(`prepare-test-db.mjs`, `tablesearch-a11y.spec.ts`).

## I · Process deviations, not hidden

1. **`TASK-002` to `TASK-005` ran under `ASES-0001`**, the session opened for
   `TASK-001`, rather than one session each. Later work used bounded sessions —
   `ASES-0002`, `ASES-0003`, `ASES-0004`.
2. **`TASK-008`'s scope was widened** to hold `UT-011`, because `SDD-V057`
   refuses a session for a task with no required test. It was right to.
3. **`ST-002` is narrower** than the test plan first described, and `ST-010`
   asserts configuration rather than hammering the login route. Both reasoned in
   `VER-0002`.
4. **These suites share one fixture** and must run with `--no-file-parallelism`.

## Known limitations

- The 24 pre-existing baseline failures above. Reproduced, classified, not fixed
  — fixing them is outside this specification's scope.
- The demo environment does not exist; nothing here has been deployed.
- The seed prints a generated password to the operator's terminal. Correct for a
  local run; **`SPEC-0008` must ensure that never reaches a CI or deploy log.**

## The decision

| Field | Value |
|---|---|
| Decision | *not recorded* |
| Reviewer role | Senior Developer / Qualified Human Reviewer |
| Date | — |
