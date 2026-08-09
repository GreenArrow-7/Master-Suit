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

## Not done: the foreign keys

The sweep treats the symptom. The cause is 131 missing constraints, and adding
them is a real decision rather than a tidy-up:

- Each `ALTER TABLE ... ADD CONSTRAINT ... REFERENCES "Tenant"` takes a lock and
  validates every existing row. On large tables that is not free.
- Any remaining orphan blocks its constraint, so the sweep has to run first —
  and stay run, on every environment, before the migration.
- `ON DELETE CASCADE` on 131 tables makes deleting a workspace a much larger
  transaction than it is today. That is the correct behaviour, but it should be
  a deliberate choice with an eye on how workspace deletion is actually invoked.

Until then, deleting a workspace keeps leaving rows behind, and this script is
how they are collected.
