# SPEC-NNNN — Test plan

> Copy to `specs/SPEC-NNNN-short-slug/test-plan.md`.
> Tests are designed **against the requirements**, before the implementation
> exists. A test written to match whatever the code turned out to do proves
> only that the code is self-consistent.
> Required from R2 upward (`docs/sdd/RISK_TO_PROCESS_MATRIX.md`).

| Field | Value |
|---|---|
| Specification | `SPEC-NNNN` |
| Risk | `R?` |
| Author | functional role |
| Date | YYYY-MM-DD |

## Test types

`UT` unit · `IT` integration · `E2E` end-to-end · `ST` security ·
`PT` performance · `REG` regression.

Existing suites this maps onto: `apps/web/tests/{unit,tenant,permission,
security,hr,sales,integration,server}` under Vitest, and `tests/e2e` under
Playwright. `VERIFIED` from `apps/web/vitest.config.mts`,
`vitest.server.mts` and `playwright.config.ts`.

## Case format

### UT-001

| Field | Value |
|---|---|
| Test ID | `UT-001` |
| Type | `UT` |
| Requirement(s) | `FR-001` |
| Purpose | what this proves, in one line |
| Preconditions | fixtures, actor, permissions, tenant, existing rows |
| Input | |
| Expected outcome | observable and specific |
| Negative case | the paired failure this also pins down, or "separate case `UT-002`" |
| Security relevance | none / describes the boundary it protects |
| Automation status | `PLANNED` / `AUTOMATED` / `MANUAL` / `NOT AUTOMATED — reason` |

## Coverage sections

Each section below is filled in or explicitly marked not applicable with a
reason. An empty section with no reason is an incomplete plan.

### Happy paths

The behaviour the requirements ask for, per requirement.

### Negative behaviour

Rejected input, missing record, wrong state, forbidden transition.

### Authorization

Per actor and scope: permitted, forbidden, and the actor who is authenticated
but out of scope. A forbidden case that returns data is the failure this
section exists to catch.

### Tenant isolation

A second tenant must not see, change or infer the first tenant's data. Where
the change touches tenant-owned rows, this section is mandatory and cites the
existing isolation layers (`docs/architecture/DATABASE.md`).

### Failure paths

Dependency down, timeout, partial success, transaction rollback.

### Malformed input

Wrong types, missing fields, oversized payloads, unexpected extra fields,
encoding surprises.

### Boundary conditions

Empty, one, many, maximum, first run, data predating the change.

### Concurrency

Two callers at once; the same caller twice; a race on the same row.

### Retries and idempotency

Where applicable: the same operation applied twice must not double its effect.

### External dependency failure

The provider is slow, rate-limited, returns an error, or returns something
unexpected.

### Regression coverage

`REG-` cases pinning behaviour that must not change. For a bug fix, the
regression test must be demonstrated to fail against the unfixed code.

## Requirement coverage

| Requirement | Tests | Covered |
|---|---|---|
| `FR-001` | `UT-001`, `IT-002` | yes |
| `SEC-001` | `ST-001` | yes |

Every requirement appears. A requirement with no test is written as "none" so
the gap is visible; it is not omitted from the table.

**Rule:** a `SEC-` requirement is discharged by a security test that proves
the boundary, not by a unit test that happens to touch the area.

## Execution record

Filled in during `VERIFYING`. Record what actually happened, including
environmental failures and anything not run.

| Test | Date | Result | Notes |
|---|---|---|---|
