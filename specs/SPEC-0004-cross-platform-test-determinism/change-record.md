# SPEC-0004 — Change record

Changes made after the specification entered `APPROVED_FOR_IMPLEMENTATION`.
Historical approved intent is never erased.

## CHG-001

**Date:** 2026-09-08
**Type:** scope addition, authorised at approval
**Raised by:** the gate 1 approval itself, which names a workstream the
specification did not yet carry.
**Authorisation:** Product Owner, human, 2026-09-08 — the same decision that
discharged gate 1.

### What changes

The approved scope includes *"bounded Playwright harness investigation and
remediation"*. `SPEC-0004` was written before `CONV-012` recurred and carried
no task for it, so `TASK-008` is added.

Two requirements are added to serve it:

one functional requirement covering harness readiness, and one non-functional
requirement forbidding a blind retry, an arbitrary sleep or a raised global
timeout as the remedy. Both are stated in `spec.md`.

### Why it is in this specification rather than its own

The approver placed it here explicitly, and it is the same class of work as
`RC-1` to `RC-3`: a defect in the test harness, not in the product. It changes
no application code and carries the same `R2` classification.

### What does not change

No existing task, requirement or acceptance criterion is amended. `RC-4`
remains outside this specification and outside this approval.

### Traceability

`SPEC-0003/CONV-012` → `CHG-001` → `TASK-008` → the harness readiness
requirement and its no-retry constraint, both in `spec.md`

## CHG-002

**Date:** 2026-09-08
**Type:** defect remediation, discovered by this specification's own work
**Raised by:** `TASK-004`. Verifying the bootstrap against a genuinely empty
database exposed a pre-existing race the repository had never run into.
**Authorisation:** within the gate 1 approval, which covers the bootstrap and
its associated tests. No product code is touched.

### What was found

After `db:test:reset` the suite reported **1830 passed · 4 failed · 86
skipped**, against **1914 · 4 · 2** on a database that already held data. The
84 additional skips all trace to one error:

```
Invalid `prisma.permission.upsert()` invocation in tests/helpers/fixtures.ts:101
Unique constraint failed on the fields: (`module`, `action`)
```

`upsert` is not atomic against a concurrent insert. Several suites build their
own tenants in parallel and each walks the same 8 modules × 6 actions, so on an
**empty** catalogue they race to create the same rows and one loses.

It was invisible until now for a simple reason: nobody had ever run the suite
against an empty test database. Whatever data happened to be there made every
upsert a no-op, and a no-op cannot race.

**The bootstrap did not cause this. It revealed it**, which is what a
deterministic environment is for.

### What changes

`TASK-009` makes the catalogue creation tolerant of a concurrent insert — the
losing writer re-reads the row that now exists instead of failing. The fix is
in the test helper, which is where the race is; the bootstrap script is not
given a duplicate copy of the module and action lists, because a second source
of truth for a permission catalogue is worse than the race.

### What does not change

No product code, no schema, no migration. `RC-4` remains out of scope.

### Traceability

`TASK-004` verification → `CHG-002` → `TASK-009` → `IT-006`
