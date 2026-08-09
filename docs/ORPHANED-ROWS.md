# Rows that outlive their workspace

## What was actually wrong

The suspicion was leftover end-to-end workspaces. That turned out to be false —
`tests/e2e/globalTeardown.ts` does its job, and a sweep for tagged workspaces
found **none**. The development database held exactly seven workspaces, all
legitimate.

What it also held was **318,666 rows belonging to workspaces that no longer
exist**:

| Rows | Table |
|---:|---|
| 308,703 | `RolePermission` |
| 2,553 | `PlatformAuditEvent` |
| 2,132 | `LeadStage` |
| 1,048 | `AuditLog` |
| 1,000 | `Activity` |
| 951 | `Role` |
| 687 | `Lead` |
| … | 15 more tables |

## The cause

**131 of the 177 tenant-scoped tables have no foreign key to `Tenant`.** Only 46
do. So deleting a workspace removes the rows in those 46 and silently abandons
everything else.

`Role` is the clearest case. Its model declares `tenantId String` and no
relation, so Postgres has no constraint to act on:

```prisma
model Role {
  id       String @id @default(cuid())
  tenantId String          // ← no `tenant Tenant @relation(...)`
  ...
}
```

`User` and `WorkspaceMembership` *do* declare the relation, which is why neither
had a single orphan while `Role` had 951. The teardown's own comment — "Tenant
deletion cascades to users, roles, memberships, leads and the rest" — is right
about users and wrong about roles.

`RolePermission` cascades from `Role`, so those 308,703 rows were held alive
purely by the 951 roles above them.

## Does it matter?

Not for correctness. Row-level security matches `tenantId` against the session's
workspace, and a deleted workspace can never be a session's workspace, so an
orphan is unreachable and always will be.

It matters for everything that counts. The permission backfill in
`scripts/backfill-admin-permissions.mjs` reported granting **121,891**
permissions — a number that made no sense against seven workspaces, because most
of it was written onto roles belonging to workspaces that had been deleted weeks
earlier. Anything that aggregates across tenants has the same problem.

## The sweep

```
node scripts/clean-orphaned-rows.mjs            # dry run, lists every table
node scripts/clean-orphaned-rows.mjs --apply    # delete
```

The rule is not a heuristic: a row goes only when its `tenantId` names a
workspace **absent from the `Tenant` table** — not soft-deleted, absent.

Tables are swept repeatedly until a pass removes nothing, because some reference
each other and a parent can fail on a child that has not been cleared yet. That
converges without a hand-maintained ordering that would drift.

On the development database it removed **317,323 rows in three passes**, leaving
none. Roles fell from 984 to 33 and role permissions from ~312,000 to 3,596. The
demo workspace still signs in and every page still renders.

## The foreign keys, now added

`20260809060000_tenant_foreign_keys` closes the cause. Every one of the 177
tenant-scoped tables now has `FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE`, and the Prisma schema declares the matching relation so the
next `migrate diff` does not try to drop them.

**CASCADE is safe here** because no product code hard-deletes a `Tenant`. Every
path in `src/` soft-deletes by setting `deletedAt`, so the cascade fires only
when somebody deliberately removes a workspace — a test teardown or an operator
— which is exactly when its rows should go too. The 46 tables that already had
the constraint already had CASCADE; this makes the other 131 agree with them.

### Three phases, for lock time

Adding 131 constraints naively validates every row of every table while holding
an `ACCESS EXCLUSIVE` lock on each. Instead:

1. **Sweep the orphans.** A constraint cannot be validated while a row violates
   it, and an operator having run the script first is a hope rather than a
   guarantee.
2. **`ADD CONSTRAINT … NOT VALID`.** Brief lock, no scan. From that moment no
   *new* row can be orphaned, which is the part that stops the problem growing.
3. **`VALIDATE CONSTRAINT`.** Scans under `SHARE UPDATE EXCLUSIVE`, which does
   not block reads or writes.

All 177 are listed rather than the 131 that were missing, and each is added only
if absent — so the migration is correct both on a database built by replaying
every migration, where 46 already exist, and on one that has drifted.

### Two things the test database taught it

**A cascade can break a live row.** Deleting an orphaned `Project` sets
`Booking.projectId` to null through an existing `ON DELETE SET NULL`, and that
booking then fails `Booking_subject_check` — which requires a project, listing
or unit. The sweep catches `check_violation` as well as `foreign_key_violation`
and leaves such rows alone.

**A deployment should not fail on legacy residue.** Validation is attempted per
constraint; one that cannot be validated stays `NOT VALID` and is named in a
warning. It still enforces on every new and updated row. Failing the whole
migration instead would block a deploy on data that predates the rule.

On both the development and test databases the result is the same: 177
tenant-scoped tables, full constraint coverage, **zero left unvalidated**.
