# Assignments whose scope is not a scope: find them before deploying the fix

**PRODUCTION. Read-only.** Run this **before** releasing the scope fix, because
the fix changes what these rows grant.

## Why it matters before, not after

`MembershipRole.scopeType` was a free-text column. Until this change, a value
the resolver did not recognise was read as `ORGANIZATION` — so a row saying
`BRACNH` granted its role's permissions **across the whole workspace**.

The fix makes an unrecognised scope grant **nothing**. That is the right way
round, and it means anybody holding such a row **loses access at the moment of
deployment** — access they should never have had, but access they may be using
today.

So: find them first, decide per row, then deploy. Not the other way round.

## The inventory

```sql
SELECT t.slug            AS workspace,
       mr.id             AS assignment_id,
       mr."scopeType"    AS stored_scope,
       mr."scopeId",
       mr.status,
       mr."effectiveFrom", mr."effectiveTo",
       r.key             AS role_key,
       r.name            AS role_name,
       u.email, u."fullName",
       mr."createdAt",
       mr."assignedById"
FROM "MembershipRole" mr
JOIN "Tenant" t              ON t.id = mr."tenantId"
JOIN "Role" r                ON r.id = mr."roleId"
JOIN "WorkspaceMembership" wm ON wm.id = mr."membershipId"
LEFT JOIN "User" u           ON u.id = wm."salesUserId"
WHERE mr."scopeType" NOT IN
      ('ORGANIZATION','REGION','BRANCH','TEAM','DEPARTMENT','DIRECT_REPORTS','OWN','OWN_RECORD')
ORDER BY mr.status, t.slug, mr."createdAt";
```

**No rows is the expected answer.** The only writer that ever accepted a free
value is the assign API, and it now rejects anything off that list.

Two more worth running, because they are the same class of silence:

```sql
-- A scope that names a record, naming none: caps at BRANCH/TEAM while matching
-- no branch or team, so it grants less than whoever set it intended.
SELECT t.slug, mr.id, mr."scopeType", r.key, u.email
FROM "MembershipRole" mr
JOIN "Tenant" t ON t.id = mr."tenantId"
JOIN "Role" r ON r.id = mr."roleId"
JOIN "WorkspaceMembership" wm ON wm.id = mr."membershipId"
LEFT JOIN "User" u ON u.id = wm."salesUserId"
WHERE mr."scopeType" IN ('REGION','BRANCH','TEAM','DEPARTMENT') AND mr."scopeId" IS NULL;
```

```sql
-- A scopeId belonging to another workspace, or to nothing at all.
SELECT t.slug, mr.id, mr."scopeType", mr."scopeId", r.key, u.email
FROM "MembershipRole" mr
JOIN "Tenant" t ON t.id = mr."tenantId"
JOIN "Role" r ON r.id = mr."roleId"
JOIN "WorkspaceMembership" wm ON wm.id = mr."membershipId"
LEFT JOIN "User" u ON u.id = wm."salesUserId"
WHERE mr."scopeId" IS NOT NULL
  AND mr."scopeType" = 'BRANCH'
  AND NOT EXISTS (SELECT 1 FROM "Branch" b WHERE b.id = mr."scopeId" AND b."tenantId" = mr."tenantId");
```

## Reading the result

| What the row shows                     | What it meant before                    | What it means after | Do                    |
| -------------------------------------- | --------------------------------------- | ------------------- | --------------------- |
| `status` not `ACTIVE`                  | nothing — revoked rows are not loaded   | nothing             | nothing               |
| outside its effective window           | nothing                                 | nothing             | nothing               |
| ACTIVE, in window, unrecognised scope  | **the role, workspace-wide**            | **nothing**         | decide per row, below |
| ACTIVE, scope needs an id and has none | the role, capped but matching no record | unchanged           | re-assign with the id |

For an ACTIVE row with an unrecognised scope, the question is not "what did the
column say" but **"what was this person meant to have?"** — and the column
cannot answer it, which is the whole defect. Ask whoever is named in
`assignedById`, then re-assign deliberately through
**Administration → Roles → Assign a role**, which now refuses anything that is
not a scope.

**Do not** translate a stored value by guessing — `BRACNH` is not evidence of
`BRANCH`. It is evidence that somebody typed into a box that should not have
accepted it.

## Rollback

The fix is code only; no migration, no data written. Rolling back the release
restores the previous reading of these rows, including the wide one. The rows
themselves are untouched either way, so the inventory stays valid across a
rollback.
