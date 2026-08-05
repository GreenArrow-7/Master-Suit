# LeadFlow CRM — Data Model

79 models · 25 enums · 119 declared indexes. `prisma/schema.prisma` is the source of
truth; this document explains the decisions behind it.

## 1. Entity relationship overview

```
Tenant ──1:1── OrganizationSetting
  ├── Region ──< Branch ──< Team ──< UserTeam >── User
  │                          └── Department
  ├── Territory
  └── Role ──< RolePermission >── Permission
             └── FieldPermission

User ──< Session
User ──< Notification

LEAD CLUSTER
  LeadStage ──< Lead >── User (owner)
                 ├──< LeadCustomFieldValue >── LeadCustomFieldDefinition
                 ├──< LeadStageHistory
                 ├──< LeadAssignmentHistory
                 ├──< LeadScoreHistory
                 ├──< Activity ──> ActivityType
                 ├──< Task ──> TaskType
                 ├──< Communication
                 ├──< Document
                 ├──< FormSubmission
                 └──< Opportunity

SALES CLUSTER
  OpportunityType ──< Pipeline ──< PipelineStage ──< Opportunity
  Opportunity ──< OpportunityProduct >── Product
              ──< OpportunityStageHistory
              ──< OpportunityCollaborator
              ──> LossReason
  Account ──< Contact
          ──< Opportunity, Lead, Ticket, Activity, Task, Document
          ──> Account (parent, self-referential)

MARKETING CLUSTER
  Campaign ──< EmailCampaign ──> MessageTemplate
           ──< Lead, Opportunity              (attribution)
  MarketingList ──< MarketingListMember
  Form ──< FormField ──< FormSubmission
  LandingPage ──< LandingPageVersion

AUTOMATION CLUSTER
  Automation ──< AutomationVersion ──< AutomationEnrollment ──< AutomationExecution
  DistributionRule
  ScoringRule · DuplicateRule

SERVICE CLUSTER
  TicketCategory (self-referential) ──< Ticket ──< TicketComment
  SLA ──< Ticket ; HolidayCalendar ; CannedResponse

OPERATIONS
  FieldVisit · FieldAttendance
  Document (self-referential version chain)
  ImportJob · ExportJob · Integration · APIKey · Webhook ──< WebhookDelivery
  SmartView · SavedFilter · Dashboard ──< DashboardWidget · Report
  AuditLog (append-only, partitioned)
```

## 2. Custom fields: why a hybrid model

The brief names `LeadCustomFieldDefinition` and `LeadCustomFieldValue`, and pure EAV
is correct for integrity, uniqueness and reporting. It is wrong for a grid that
filters 1M rows on three custom fields — that becomes three self-joins.

So: the value tables remain the **source of truth**, and `Lead.customData jsonb` is a
**projection** maintained in the same transaction as the value write.

```sql
CREATE INDEX lead_customdata_gin ON "Lead" USING GIN ("customData" jsonb_path_ops);
```

Reads and filters hit the GIN index. Writes, uniqueness checks, formula recomputation
and reporting joins use the normalized tables. A nightly maintenance job reconciles
the projection and reports drift; drift has never been acceptable, so a non-zero
count pages.

## 3. Indexing strategy

Every index leads with `tenantId`. A composite index that does not is a cross-tenant
sequential scan waiting to happen.

| Access pattern | Index |
|---|---|
| Lead grid, default sort | `(tenantId, stageId, updatedAt DESC)` |
| "My leads" by stage | `(tenantId, ownerId, stageId)` |
| Duplicate check on email | `(tenantId, email)` |
| Duplicate check on phone | `(tenantId, phoneNormalized)` — E.164 normalised on write |
| Follow-up queue | `(tenantId, nextFollowUpAt)` |
| SLA sweeper | `(tenantId, slaState, slaDueAt)` |
| High-score triage | `(tenantId, score DESC)` |
| Kanban column load | `(tenantId, pipelineId, stageId)` |
| Forecast | `(tenantId, expectedCloseDate)` and `(tenantId, status, actualCloseDate)` |
| Timeline | `(tenantId, leadId, occurredAt DESC)` |
| Task inbox | `(tenantId, ownerId, status, dueAt)` |
| Ticket queue | `(tenantId, status, priority)` and `(tenantId, slaState, resolutionDueAt)` |
| Audit lookup | `(tenantId, objectType, recordId, occurredAt DESC)` |

Raw-SQL additions Prisma cannot express (in `migrations/*/`):

```sql
-- soft delete must not consume the unique slot
CREATE UNIQUE INDEX lead_ref_live ON "Lead"("tenantId","reference") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX user_email_live ON "User"("tenantId","email")  WHERE "deletedAt" IS NULL;

-- hot-path partial indexes: open records are a small slice of a large table
CREATE INDEX lead_open_followup ON "Lead"("tenantId","nextFollowUpAt")
  WHERE "deletedAt" IS NULL AND "convertedAt" IS NULL;
CREATE INDEX task_open_due ON "Task"("tenantId","ownerId","dueAt")
  WHERE "status" IN ('OPEN','IN_PROGRESS') AND "deletedAt" IS NULL;

-- full-text search
ALTER TABLE "Lead" ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("fullName",'')||' '||coalesce(email,'')||' '||
      coalesce(phone,'')||' '||coalesce(company,'')||' '||coalesce(reference,''))
  ) STORED;
CREATE INDEX lead_search_tsv ON "Lead" USING GIN (search_tsv);

-- trigram for "contains" search on names
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX lead_name_trgm ON "Lead" USING GIN ("fullName" gin_trgm_ops);
```

## 4. Partitioning

Three tables grow without bound and are append-heavy. All are range-partitioned
monthly on their time column, with partitions created a month ahead by the
`maintenance` queue and detached to cold storage per the tenant retention policy.

| Table | Partition key | Retention default |
|---|---|---|
| `Activity` | `occurredAt` | 36 months hot |
| `AuditLog` | `occurredAt` | 24 months hot, then WORM archive |
| `Communication` | `createdAt` | 24 months hot |

`AutomationExecution` and `WebhookDelivery` are pruned rather than partitioned —
90-day rolling delete.

## 5. Designing for 1M leads per tenant

- **Cursor pagination** on every list. Keyset on `(updatedAt, id)`, never `OFFSET`.
  Page 40 000 of an offset query costs the same as a table scan.
- **No `SELECT *`.** List endpoints project only the columns the requested grid
  configuration needs.
- **Counts are estimates.** Exact `COUNT(*)` over a filtered million rows is not
  free; the grid shows `~48,300` from `pg_class.reltuples` scaled by selectivity, and
  offers an exact count on demand.
- **Aggregates are precomputed.** Dashboard widgets read from
  `mv_lead_daily_rollup` and `mv_opportunity_daily_rollup`, refreshed concurrently
  every 5 minutes. Drill-down goes to live tables.
- **Reports run on the replica** when `DATABASE_REPLICA_URL` is set.
- **Bulk operations are queued**, never inline. A "bulk assign 50 000 leads" click
  creates a job and returns immediately; the grid shows progress.
- **Imports write in 5 000-row chunks** with `ON CONFLICT DO NOTHING` on the natural
  key, keeping lock windows short.
- **Timelines are windowed**, 50 events at a time with a cursor. A ten-year lead
  history never loads at once.

## 6. Soft delete

`deletedAt` on every user-facing business table. The Prisma extension appends
`deletedAt: null` to reads automatically; passing `includeDeleted: true` requires
`<module>:DELETE`. Hard deletion is a retention-policy job, not a user action, and
it writes an audit row before removing the record.

## 7. Referential integrity

`createdById` / `updatedById` are scalar columns without a Prisma relation — adding
120 inverse relations to `User` would make the model unreadable and every `User`
query a footgun. FK constraints are added in raw SQL with `ON DELETE SET NULL`:

```sql
ALTER TABLE "Lead" ADD CONSTRAINT lead_created_by_fk
  FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE SET NULL;
```

## 8. Row-level security as the last line

Application code always filters by tenant. RLS makes a mistake fail closed rather
than leak:

```sql
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_tenant_isolation ON "Lead"
  USING ("tenantId" = current_setting('app.tenant_id', true));
```

The connection sets `app.tenant_id` from the `Ctx` at transaction start. Migrations
and the seed run as a role with `BYPASSRLS`; the application role never has it.
