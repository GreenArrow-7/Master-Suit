# Database audit — 2026-08-22

A pass over the database layer: row-level security, the tenant guard's model
registries, referential integrity, index coverage, schema/migration drift and
orphaned rows. Every finding below was produced by querying the live database or
diffing the datamodel, not by reading code and inferring.

Two defects found and fixed. Six checks came back clean and are recorded so the
next audit can tell "verified" from "never looked".

---

## Verified clean — no action

| Check | Method | Result |
|---|---|---|
| Forced RLS on tenant-scoped tables | `pg_class.relrowsecurity AND relforcerowsecurity` vs every table carrying `tenantId` | 179 forced. The 7 without it are all deliberate: `APIKey`, `IntegrationConnection`, `PasswordResetToken`, `WorkspaceInvitation` (bootstrap lookups by bearer secret, before any tenant is known), `PlatformAuditEvent`, `WorkspaceMembership` (control-plane, cross-tenant by design), `RateLimitCounter` (`tenantId` is nullable; buckets are keyed by a global `bucketKey`) |
| RLS enabled without a policy | `pg_policy` count per RLS table | 0. Such a table denies every row silently, so this is worth re-checking after any migration that touches RLS |
| Policy consistency | policy names across the schema | 180 tables, all exactly one `tenant_isolation` policy — no ad-hoc variants |
| `tenantId` referential integrity | `information_schema` FK lookup for every `tenantId` column | 100% have a real FK to `Tenant`. None are scalar-only |
| Schema ↔ migration drift | `prisma migrate diff --from-migrations --to-schema` against a shadow database | No difference. A fresh `migrate deploy` produces exactly the datamodel |
| Orphaned rows | existence scans across the documented scalar links (`Call.leadId`, `Call.contactId`, `FollowUpTask.callId`, `PracticeSession.objectionId`) | 0 orphans |

---

## Finding 1 — soft deletes the guard was not enforcing

**Severity: latent correctness. No live leak; the safety net was simply absent.**

`src/lib/db.ts` adds `deletedAt: null` to reads of models listed in
`SOFT_DELETE_MODELS`. **16 models declare `deletedAt` and 15 were not listed**,
so for those the filter was never applied and every caller had to remember it by
hand.

Unregistered: `AllocationRequest`, `Booking`, `ClientProfile`,
`ClientRequirement`, `CoachingNote`, `Contest`, `Listing`, `Nomination`,
`Objection`, `Owner`, `Post`, `Referral`, `ReferralCode`, `SiteVisit`,
`Testimonial`. (`Tenant` also carries `deletedAt` and is deliberately left out —
it is in `GLOBAL_MODELS`, which returns before the filter is reached.)

**How bad was it in practice?** Every current read was audited: all of them
filter correctly, several through shared helpers (`listingWhere`,
`listingsMatching`). So there is no bug visible in the product today. The defect
is that nothing enforced it — the code was correct because nobody had forgotten
yet, which is a coincidence rather than a property.

**Correction.** Registered all 15. One read deliberately wants deleted rows and
now says so explicitly: `coachingInsights.ts` resolves the *name* of a retired
playbook entry for calls analysed while it was live, and opts out via the
guard's existing `__includeDeleted` flag. Hiding it would relabel historical
findings "Deleted objection" and make past coaching unreadable.

**If left unclosed.** The next read of any of those 15 that omits the filter
returns deleted records — a retired listing back on the market, a removed
testimonial back on the public site, a cancelled booking back in revenue, a
soft-deleted `ClientProfile` back in a report. That failure is silent: the query
succeeds and the numbers are simply wrong. It is also the kind of mistake that
arrives with a new feature written by someone who reasonably assumed the guard
covered it — as it does for the other 36 models.

---

## Finding 2 — 86 foreign keys with no index

**Severity: performance, unbounded with data growth. Correctness unaffected.**

Postgres indexes the *referenced* side of a foreign key automatically and the
*referencing* side not at all. **86 FK columns had no index of any kind.**

Coverage before → after:

| | before | after |
|---|---|---|
| FK column leads an index | 218 | **304** |
| appears only in a composite | 111 | 111 |
| **no index at all** | **86** | **0** |

Composite indexes containing the column were *not* counted as coverage:
`@@index([tenantId, leadId])` cannot serve a lookup by `leadId` alone, which is
exactly the shape a cascade issues.

Worst clusters by parent table:

| Parent | Unindexed children | What it costs |
|---|---|---|
| `EmployeeProfile` | 21 | Deleting an employee sequentially scans 21 HR tables |
| `Account` | 6 | |
| `HrWorkLocation` | 5 | |
| `Tenant` | 2 | `LandingPageVersion` and one other scanned on **every workspace deletion** — which is also what the test suite does in teardown |

**Correction.** Migration `20260822120000_index_foreign_keys` adds 86
single-column indexes, with matching `@@index` entries in `schema.prisma` so the
two cannot drift. Verified: the generated diff contained **86 `CREATE INDEX` and
no other statement** — no drops, no alters — and after applying to a database
built from scratch, unindexed FKs are 0 and drift is still none.

**If left unclosed.** Each parent delete stays a full scan of every unindexed
child. It is invisible at current volumes (largest table ~9.7k rows) and becomes
a production incident later: deleting one workspace scans every unindexed table
end to end while holding locks. The cost grows with the data, and the day it
hurts is the day the tables are large enough that adding the index is itself a
long operation.

---

## Environment defect found while verifying

Not a database fault, but it presents as one and cost most of this session's
verification time.

Every suite began failing at once with `Server has closed the connection`
(Prisma) and `ECONNRESET` (ioredis), while the containers stayed healthy and
`docker exec psql` worked. Reproduced outside the test runner with a plain `pg`
client:

```
127.0.0.1  → OK
localhost  → read ECONNRESET
```

Node resolves `localhost` to `::1` first. Docker publishes on both stacks, but
its IPv6 listener stalls after long uptime, resetting every *new* connection
while established pools survive — which is why the running dev server kept
serving pages throughout.

`.env` / `.env.test` are gitignored, so the durable fix is in the templates:
`.env.example` and `.env.test.example` now pin `127.0.0.1` with the reasoning
inline. Restarting the containers does **not** clear it; only pinning IPv4 does.

**If left unclosed.** Recurs unpredictably and reads as database failure. Anyone
hitting it will debug Postgres, the pool size, or their own migration — the one
thing that looks innocent is the hostname.

---

## Verification

- All 52 migrations applied to a database created from scratch — clean
- Unindexed FKs after: **0**; RLS-without-policy after: **0**; drift after: **none**
- Applied to the development and test databases
- **Full suite: 1228 tests, 97 files, all passing** — which is what establishes
  that registering 15 models for soft-delete broke no query that was relying on
  reading deleted rows

## Not covered by this pass

Stated so the gaps are visible rather than implied:

- **Query plans.** Nothing was benchmarked; the index work is reasoned from
  cascade behaviour, not from `EXPLAIN` against production-sized data.
- **The 111 non-leading composite FKs.** Left alone. They serve the app's
  tenant-scoped reads correctly and adding 111 more single-column indexes would
  cost write throughput for a cascade path that is already narrowed by tenant.
- **Retention and archival.** `PlatformAuditEvent` (1.8k rows here) and
  `LeadStageHistory` grow without bound; no policy prunes them.
- **Orphan scan breadth.** Only the documented scalar links were checked, not
  every nullable id column in the schema.
