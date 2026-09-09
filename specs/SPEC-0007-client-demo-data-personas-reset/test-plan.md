# SPEC-0007 — Test plan

| Field | Value |
|---|---|
| Specification | `SPEC-0007` |
| Risk | `R3` |
| Last updated | 2026-09-08 |

Every case lands in a harness that already exists. No new harness, no new
dependency, no new configuration file. Each case names the requirements it
verifies.

| Layer | Harness | Command |
|---|---|---|
| Unit and integration | `apps/web/vitest.config.mts` | `npm test` |
| Route integration against a running app | `apps/web/vitest.server.mts` | `npm run test:server` |
| Tenant isolation | `apps/web/tests/tenant/isolation.spec.ts` | `npm run test:tenant` |
| Permissions | `apps/web/tests/permission/` | `npm run test:permission` |
| End to end | `apps/web/playwright.config.ts` | `npm run test:e2e` |

Existing cases to read before writing: `apps/web/tests/tenant/isolation.spec.ts`
for the two-workspace fixture pattern, and `apps/web/tests/tenant/rls.spec.ts`
for the database-layer proof.

## Unit

- `UT-001` — Five departments exist; the workspace holds at least 24 active
  employee profiles; and **every** one of them carries a department, a
  designation and a manager unless it is the single head of the hierarchy. The
  assertion is an invariant over the whole population, not a count range, so it
  cannot pass while some employees are unpopulated. *(verifies `FR-001`,
  `FR-002`; amended by `CHG-001`)*
- `UT-002` — The reporting hierarchy is at least two levels deep, contains no
  cycle, and has exactly one employee with no manager. *(verifies `FR-003`)*
- `UT-003` — Leave requests exist in approved, pending and rejected states, and
  attendance contains present, late, absent and half-day states. *(verifies
  `FR-006`, `FR-007`)*
- `UT-004` — No generated name, address or identifier matches an entry in the
  prohibited-source list, and every generated electronic address sits on the
  reserved demonstration domain. *(verifies `DATA-001`, `DATA-005`)*
- `UT-005` — The generator writes zero rows carrying biometric, face-template,
  attendance-capture, compensation, payroll, payslip, bank-account, IBAN or
  wage-protection data. *(verifies `DATA-002`, `DATA-003`)*
- `UT-006` — No generated value is read from, or derived from, any file outside
  the generator's own invented corpus. *(verifies `DATA-004`)*
- `UT-007` — **Reset coverage.** Every tenant-scoped model is removed by the
  reset through the tenant cascade, through an explicit deletion, or is a named
  and reasoned exclusion. Adding a model that satisfies none of the three fails
  this case. *(verifies `FR-015`, `FR-011`; scope confirmed by `CHG-002`)*
- `UT-008` — Two generations from the same seed key produce identical counts
  and identical natural keys. *(verifies `FR-014`)*
- `UT-009` — Attendance is generated only for working days and skips the seeded
  holidays. *(verifies `FR-004`, `FR-007`)*
- `UT-010` — The generator writes nothing when the target workspace does not
  exist, and reports why. *(verifies `FR-001`)*

## Integration

- `IT-001` — A seed against an empty disposable database produces the required
  counts and reports them, with its duration. *(verifies `FR-004`, `FR-005`,
  `NFR-003`, `NFR-004`, `OBS-001`)*
- `IT-002` — A second seed over an already-seeded workspace leaves the counts
  unchanged. *(verifies `FR-013`)*
- `IT-003` — A reset followed by a seed restores the Sales baseline, the HRMS
  baseline and the three persona memberships. *(verifies `FR-012`)*
- `IT-004` — Two consecutive resets produce identical counts and identical
  natural keys. *(verifies `FR-013`)*
- `IT-005` — After a reset no HR record of the demo workspace survives,
  asserted per model rather than in aggregate. *(verifies `FR-011`)*
- `IT-006` — The Sales persona can list and open its own leads, opportunities,
  activities, follow-ups, tasks, reports and dashboards. *(verifies `FR-010`)*
- `IT-007` — The HR persona can list employees, departments, attendance and
  leave, and can approve and reject a pending leave request. *(verifies
  `FR-006`, `FR-008`, `FR-010`)*
- `IT-008` — The Management persona can read both modules and the workspace
  administration area. *(verifies `FR-010`)*
- `IT-009` — Seeding a workspace entitled to only one product module produces
  that module's data and does not fail. *(verifies `FR-005`)*
- `IT-010` — A reset preserves the workspace, its role catalogue and the three
  memberships, so credentials survive. *(verifies `FR-012`)*

## Security

- `ST-001` verifies `SEC-004` — A demonstration persona listing any collection
  never returns another workspace's rows, and a user of another workspace never
  sees the demo workspace's rows. Application layer, both directions.
- `ST-002` verifies `SEC-004` — The same isolation proved at the database layer
  over the application role, for the HR models this specification populates.
- `ST-003` verifies `SEC-005`, `SEC-003` — Negative authorization at the route:
  the Sales persona is refused employees, attendance, leave, HR documents and
  HR reports; the HR persona is refused leads, opportunities, accounts, calls
  and campaigns. Each asserted as an explicit status, not a redirect.
- `ST-004` verifies `SEC-005` — Positive authorization: each persona reaches
  what its role grants, so a passing negative suite cannot be a broken login.
- `ST-005` verifies `SEC-003` — Every demonstration persona, including the
  Management persona, is refused the platform control plane.
- `ST-006` verifies `SEC-001`, `OBS-002` — The demo seed is refused for each of
  the four environment gates independently, nothing is written in any of the
  four cases, and the refusal names its gate.
- `ST-007` verifies `SEC-002`, `OBS-002` — The demo reset is refused under the
  same four gates, the target row counts are unchanged after each refusal, and
  the refusal names its gate.
- `ST-008` verifies `SEC-006`, `DATA-005` — No action available to a
  demonstration persona dispatches an outbound message when the environment
  selects the mock providers: the follow-up email, the invitation and the
  notification worker are each asserted.
- `ST-009` verifies `SEC-006` — A freshly seeded demo workspace holds zero
  integration connections, so no callback key resolves to it.
- `ST-010` verifies `SEC-003` — Demonstration logins are subject to the
  per-account throttle, the per-IP throttle and account lockout.
- `ST-011` verifies `SEC-007` — No credential value appears in the
  specification directory, the generator, the test corpus or the seed's
  committed output.
- `ST-012` verifies `FR-017`, `SEC-003` — The client-facing login exists at the
  address the business named, is ACTIVE, holds `org_admin`, carries the platform
  role `USER`, and holds no more than one workspace membership. Resolved by
  **address**, not by role: every other case in that file resolves a persona by
  role, which would keep passing if this account were renamed or deleted.
- `ST-013` verifies `FR-017` — The client-facing login reads Sales leads,
  opportunities and accounts, and HR employees, on one session. The positive
  half, without which the refusals below prove only that the account is broken.
- `ST-014` verifies `FR-017`, `SEC-004` — The client-facing login is refused
  every resource of the second workspace, with a refusal status rather than a
  server error.
- `ST-015` verifies `FR-017`, `SEC-003` — The client-facing login is refused the
  platform control plane.
- `ST-016` verifies `FR-017`, `SEC-004` — Every table the client-facing login
  reads has row-level security enabled **and forced**, so the isolation holds
  below the application rather than only inside it.

## End to end

- `E2E-001` — Management login, management dashboard, Sales leads, contacts and
  accounts, opportunities, pipeline, an activity and a task, a dashboard or
  report, HR employees, departments, reporting structure, attendance, leave, HR
  dashboard, logout. Run on both supported hosts. *(verifies `FR-010`,
  `NFR-001`, `NFR-002`)*
- `E2E-002` — Sales persona login, Sales dashboard, lead flow, opportunity flow;
  HR navigation absent. *(verifies `FR-009`)*
- `E2E-003` — HR persona login, employee list, department view, attendance view,
  leave queue with an approval and a rejection; Sales navigation absent.
  *(verifies `FR-008`)*
- `E2E-004` — Destructive controls absent for the Sales persona; a modification
  made during `E2E-002` is gone after a reset and the baseline is back.
  *(verifies `FR-012`)*
- `E2E-005` — No screen in `E2E-001` renders an unintended empty state. Each
  intended empty state is asserted by name, so "empty because excluded" and
  "empty because broken" cannot be confused. *(verifies `FR-008`)*

- `E2E-006` — **One login, both modules, one session.** The client-facing
  credential authenticates once, walks the Sales surface and then the HRMS
  surface, and the session cookie is unchanged throughout — no re-authentication
  and no workspace switch. It is then refused the platform console. *(verifies
  `FR-017`)*

## Regression

- `REG-001` — The existing demo seed still produces its current Sales counts;
  the HR addition changes nothing that exists today. *(verifies `FR-009`)*
- `REG-002` — The existing reset still clears everything it cleared before.
  *(verifies `FR-011`)*

## Documentation verification

- `UT-011` verifies `FR-016`, `SEC-007` — The demonstration documentation names
  all three personas and the seed and reset commands, and contains no
  credential. A prose check, but a mechanical one: "does the runbook name the
  HR persona" and "has somebody pasted a password into it" are both answerable
  without judgement, and the second is the one worth catching automatically.
- `UT-012` verifies `FR-016`, `FR-017` — The runbook names the single
  client-facing login, says in words that it is the single one, and marks the
  other personas internal. Naming it is not enough: the document lists four
  addresses, and one that does not say which is the client's leaves the choice
  to whoever is in a hurry.
- `UT-013` verifies `DATA-005` (as amended by `CHG-004`) — Across every seeded
  tenant, exactly one address sits off a reserved domain, and it is the client
  login. Generated records — contacts, leads, account mail addresses and account
  websites — carry none. Asserted against the database rather than the seed
  source, because an address built by concatenation would escape a source scan.
- `UT-014` verifies `FR-016` — The client-facing workspace is `YOUHAN ONE Demo`
  and no seeded value a client can see carries the previous brand. Scoped to
  what is visible, not to governance history, where the old name is the
  truthful record.
- `UT-015` verifies `FR-011`, `FR-012` — A seed that fails is never silently
  tolerated by its caller: a refused seed exits non-zero **and** reports its
  reason, and a seed that cannot start is reported as a spawn failure rather
  than mistaken for a refusal. Written for `CONV-008`, whose second half was
  that `spawnSync` reports a process that never ran as a null status, which
  satisfied every "should have failed" assertion in the file.

Anything about the documentation that needs judgement — whether it is *clear* —
is checked by a human at convergence, not asserted here.

## Gates that must stay green

`npm run typecheck`, `npm run lint`, `npm run check:drift` — the check behind
the claim of no schema change, and the verification for `NFR-001` —
`npm run check:test-data`, `npm run test:tenant`, `npm run test:permission`,
and `node tools/sdd/cli.mjs validate --all`.

## What is not tested, and why

- Payroll and the wage-protection export: excluded by `CL-004`. If that
  clarification reverses, those surfaces need their own security cases before
  any demonstration reaches them.
- Face attendance: no enrolment exists in the demo dataset, so there is nothing
  to exercise.
- Any deployed environment: out of scope; `SPEC-0008` owns it.
