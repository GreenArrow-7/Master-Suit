# The nine roles in `review-demo`: inventory, impact, and the remediation to approve

Nine roles matching the end-to-end suite's generators exist in the workspace
`review-demo`, created 19–20 September 2026. This is the inventory to run, what
the result means, and the remediation — **nothing here deletes anything.**

**PRODUCTION. Every query in sections 1–4 is read-only.**

## What is already known

```
 review-demo | seller_mu8vfn6x      | Seller mu8vfn6x      | 2026-09-19 21:00:22
 review-demo | seller_mu8vfnag      | Seller mu8vfnag      | 2026-09-19 21:00:22
 review-demo | journey_rep_mu8vfnag | Journey Rep mu8vfnag | 2026-09-19 21:00:23
 review-demo | journey_rep_mu8vfn6x | Journey Rep mu8vfn6x | 2026-09-19 21:00:23
 review-demo | journey_rep_mu8w22lh | Journey Rep mu8w22lh | 2026-09-19 21:17:45
 review-demo | journey_rep_mu8w4rq2 | Journey Rep mu8w4rq2 | 2026-09-19 21:19:45
 review-demo | journey_rep_mu9a09aq | Journey Rep mu9a09aq | 2026-09-20 03:48:08
 review-demo | journey_rep_mu9hvk30 | Journey Rep mu9hvk30 | 2026-09-20 07:28:33
 review-demo | scope_mua8r456       | Scope probe mua8r456 | 2026-09-20 20:00:46
```

Each key is `<template>_<eight base-36 characters>`, which is what
`Date.now().toString(36)` produces and what `business-journey.spec.ts` and
`record-scope.spec.ts` built their role keys from. Seven arrived within a
20-minute window and the rest within a day, which is a suite being run
repeatedly, not a workspace being configured.

**A pattern match and a timestamp are evidence, not authorisation.** Sections 1
to 4 are what turns them into a decision.

## 1. The identities, and whether anyone holds them

```sql
SELECT r.id, r.key, r.name, r.rank, r."isActive", r."isSystem", r."createdById",
       (SELECT count(*) FROM "User" u
         WHERE u."tenantId" = r."tenantId" AND u."roleId" = r.id AND u."deletedAt" IS NULL) AS primary_holders,
       (SELECT count(*) FROM "MembershipRole" mr
         WHERE mr."tenantId" = r."tenantId" AND mr."roleId" = r.id AND mr.status = 'ACTIVE') AS assigned_holders,
       (SELECT count(*) FROM "WorkspaceInvitation" wi
         WHERE wi."tenantId" = r."tenantId" AND wi."roleId" = r.id) AS open_invitations,
       (SELECT count(*) FROM "RolePermission" rp
         WHERE rp."tenantId" = r."tenantId" AND rp."roleId" = r.id) AS granted_permissions
FROM "Role" r JOIN "Tenant" t ON t.id = r."tenantId"
WHERE t.slug = 'review-demo'
  AND r.key ~ '^(seller|journey_rep|scope)_[0-9a-z]{8}$'
ORDER BY r."createdAt";
```

**This is the decisive column set.** `primary_holders + assigned_holders = 0`
for all nine means deactivating them affects **nobody**. Any non-zero count is a
real person and changes the decision — see §5.

## 2. Who those holders are, if there are any

```sql
SELECT r.key, u.id AS user_id, u.email, u."fullName", u.status, 'primary' AS held_as
FROM "Role" r JOIN "Tenant" t ON t.id = r."tenantId"
JOIN "User" u ON u."roleId" = r.id AND u."tenantId" = r."tenantId" AND u."deletedAt" IS NULL
WHERE t.slug = 'review-demo' AND r.key ~ '^(seller|journey_rep|scope)_[0-9a-z]{8}$'
UNION ALL
SELECT r.key, u.id, u.email, u."fullName", u.status, 'assigned'
FROM "Role" r JOIN "Tenant" t ON t.id = r."tenantId"
JOIN "MembershipRole" mr ON mr."roleId" = r.id AND mr."tenantId" = r."tenantId" AND mr.status = 'ACTIVE'
JOIN "WorkspaceMembership" wm ON wm.id = mr."membershipId"
JOIN "User" u ON u.id = wm."salesUserId"
ORDER BY 1, 2;
```

An address matching `journey-rep-<run>@example.com`, `scope-<tag>-<run>@example.com`
or `dtw-<run>@example.com` is the suite's own account. **Anything else is a real
person and must not be touched.**

## 3. What the workspace's legitimate roles look like, for contrast

```sql
SELECT key, name, rank, "isActive", "isSystem", "createdAt"
FROM "Role" r JOIN "Tenant" t ON t.id = r."tenantId"
WHERE t.slug = 'review-demo'
  AND r.key !~ '^(seller|journey_rep|scope)_[0-9a-z]{8}$'
ORDER BY rank;
```

Run this before anything else is decided. It is the check that the nine are the
anomaly rather than the pattern.

## 4. Which workspace the reporting phone actually uses

The nine are in `review-demo`. If the phone signs in to a different workspace,
they are not what the reporter saw and this is a second, separate problem.

```sql
SELECT t.slug, t."displayName", count(*) AS ios_devices, max(dt."lastSeenAt") AS newest_seen
FROM "DeviceToken" dt
JOIN "User" u ON u.id = dt."userId"
JOIN "Tenant" t ON t.id = u."tenantId"
WHERE dt.platform = 'ios'
GROUP BY t.slug, t."displayName"
ORDER BY newest_seen DESC;
```

`DeviceToken` is stamped on every re-registration, which the app does at each
launch, so `newest_seen` is when that phone last opened the app.

## 5. The remediation — for approval, not run here

**Deactivate. Do not delete.** `Role.isActive` is the product's own mechanism and
its schema says what it does: _"A deactivated role grants nothing and cannot be
assigned, but keeps its history."_ Specifically, `src/services/identity/roles.ts`:

- the **Add user** picker already filters `isActive: true`, so the dropdown
  entries the reporter saw disappear;
- the role, its permissions and every historical reference **stay**;
- an audit row is written — `PERMISSION_CHANGED`, with the before and after;
- **everyone holding the role is signed out**, so no live session keeps
  permissions it has just lost.

That last point is why §1 and §2 come first.

### If §1 shows zero holders — the expected case

Through the product, by a workspace administrator: **Administration → Roles**,
open each of the nine, turn off Active. Nothing is deleted, the audit trail
records who did it, and the pickers are clean on the next load.

If it has to be done in SQL, it is scoped to the workspace, matched on the
generator, and refuses to touch a system role or one with holders:

```sql
-- PRODUCTION. Review the SELECT in §1 first. Run inside a transaction.
BEGIN;
UPDATE "Role" r SET "isActive" = false, "updatedAt" = now()
FROM "Tenant" t
WHERE t.id = r."tenantId" AND t.slug = 'review-demo'
  AND r.key ~ '^(seller|journey_rep|scope)_[0-9a-z]{8}$'
  AND r."isSystem" = false
  AND r."isActive" = true
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."roleId" = r.id AND u."deletedAt" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "MembershipRole" mr WHERE mr."roleId" = r.id AND mr.status = 'ACTIVE');
-- Expect: UPDATE 9. Any other number means an assumption was wrong.
-- COMMIT;  ← only after the count matches
```

**Prefer the product.** The SQL writes no audit row; the screen does.

### If §1 shows any holder

Stop. Nobody is remapped to a broader role automatically — that is how a test
account becomes a real one with real access. Bring the specific ids and
addresses from §2 back for a decision, one at a time.

## What this does not do

Deleting these roles. Deletion loses the audit trail that says they existed, and
a role id may be referenced by history rows nothing here has enumerated.
Deactivation achieves what was asked — they leave the picker and grant
nothing — and is reversible.

## The other half

The generator is fixed (`RUN_TAG`, 9 November) so no new rows accumulate, and
`globalTeardown` removes what a run creates. **That does not touch these nine**,
which is what this document is for. CI runs the suite against the runner's own
throwaway database — `E2E_DEMO_SLUG=manath-homes`, destroyed with the runner —
so these nine came from a run pointed at this environment on 19–20 September,
not from CI.
