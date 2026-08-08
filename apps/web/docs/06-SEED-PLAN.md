# LeadFlow CRM — Seed Data Plan

Deterministic generator (`prisma/seed/`) seeded from a fixed PRNG so the same
`SEED_KEY` reproduces the same tenant. Run: `npm run db:seed`.

## 1. Demo tenant

**Meridian Property Group** — a UAE real-estate and mortgage advisory firm. The
domain gives us plausible names, sources, products and stage semantics without
inventing an industry from nothing.

| Object        | Count | Shape                                                                                                                                                                  |
| ------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant        | 1     | `meridian`, AED, Asia/Dubai, Sun–Thu working week                                                                                                                      |
| Regions       | 3     | Dubai · Abu Dhabi · Northern Emirates                                                                                                                                  |
| Branches      | 5     | Business Bay · JLT · Downtown · Al Reem · Sharjah                                                                                                                      |
| Departments   | 4     | Sales · Marketing · Client Services · Operations                                                                                                                       |
| Teams         | 8     | 2 per sales branch + Marketing + Service                                                                                                                               |
| Users         | 25    | 1 org admin, 1 director, 2 regional, 5 branch, 4 team managers, 8 reps, 2 field reps, 1 marketing manager, 2 marketing execs, 2 service agents, 1 analyst, 1 read-only |
| Roles         | 14    | the seeded defaults from `01-PERMISSIONS.md`                                                                                                                           |
| Permissions   | 214   | valid module × action pairs                                                                                                                                            |
| Leads         | 500   | see distribution below                                                                                                                                                 |
| Opportunities | 100   | 60 open across stages, 25 won, 15 lost with reasons                                                                                                                    |
| Accounts      | 50    | developers, brokerages, corporate clients                                                                                                                              |
| Contacts      | 100   | 1–4 per account, with decision roles                                                                                                                                   |
| Activities    | 1 000 | weighted to recent 90 days, clustered on active leads                                                                                                                  |
| Tasks         | 300   | 120 open, 60 overdue, 100 completed, 20 cancelled                                                                                                                      |
| Campaigns     | 10    | across 6 channels with spend and attribution                                                                                                                           |
| Automations   | 5     | with 200+ enrollments and real execution logs                                                                                                                          |
| Tickets       | 50    | 30 open across statuses, 12 breached SLA, 8 resolved with CSAT                                                                                                         |
| Products      | 20    | off-plan, ready, mortgage, valuation, property management                                                                                                              |
| Forms         | 6     | enquiry, viewing request, mortgage pre-approval, KYC, site-visit report, support                                                                                       |
| Landing pages | 3     | published, draft, archived                                                                                                                                             |
| Smart Views   | 12    | shipped defaults plus role-specific                                                                                                                                    |
| Dashboards    | 3     | sales, marketing, service                                                                                                                                              |
| Reports       | 12    | the standard library                                                                                                                                                   |

## 2. Realism rules

Names are drawn from a mixed Emirati, South Asian, Levantine, European and Filipino
name pool matching a Dubai brokerage. No `John Doe`, no `test@test.com`, no
`Company A`. Phone numbers are `+9715…` in the reserved test ranges; emails resolve
to `@example.com` so a misconfigured provider cannot reach a real inbox.

Timestamps follow a working-hours curve — Sunday to Thursday, 09:00–19:00 Gulf time,
with a lull at 13:00. Weekend activity exists but is sparse. This matters: dashboards
seeded with uniform random timestamps look obviously synthetic and hide real bugs in
business-hours SLA maths.

## 3. Lead distribution

| Stage               | Share | Notes                                                     |
| ------------------- | ----- | --------------------------------------------------------- |
| New                 | 18%   | 40 of them unassigned, to exercise the distribution queue |
| Attempted Contact   | 12%   |                                                           |
| Contacted           | 14%   |                                                           |
| Interested          | 10%   |                                                           |
| Qualified           | 9%    | most have an opportunity                                  |
| Application Started | 6%    |                                                           |
| Documents Pending   | 5%    | with pending and rejected documents                       |
| Proposal Sent       | 5%    |                                                           |
| Negotiation         | 4%    |                                                           |
| Converted           | 7%    | linked to won opportunities and accounts                  |
| Not Interested      | 5%    |                                                           |
| Disqualified        | 3%    |                                                           |
| Duplicate           | 1%    | pointing at a master record, to exercise merge            |
| Invalid             | 1%    |                                                           |

Sources: public form 24%, landing page 11%, portal marketplace 19%, referral 12%,
walk-in 8%, ad lead form 10%, telephony 9%, import 7%.

Scores are computed by replaying the seeded activity through the scoring rules
rather than assigned at random, so `LeadScoreHistory` reconciles with `Lead.score`.
Grades come from profile fit (budget, timeline, product interest).

## 4. States the seed must exercise

Every one of these is a screen or a code path that is easy to ship broken:

- 40 unassigned leads → distribution engine and the "Unassigned" Smart View
- 25 leads past first-contact SLA → warning, escalation, reassignment
- 60 overdue tasks across 6 owners → overdue badge, escalation, manager view
- 12 tickets with breached SLA, 6 at risk → SLA colouring and the service dashboard
- 8 duplicate clusters (email, phone, name+phone) → duplicate review and merge
- 15 lost opportunities with 5 distinct loss reasons → lost-reason analysis
- 3 stalled opportunities untouched for 45 days → stalled detection
- 200 automation enrollments including 6 failed executions with error detail
- 1 import job completed with errors, plus its downloadable error file
- 1 expired export link and 1 live one
- Documents in every status: uploaded, pending, verified, rejected, expired
- 2 users on leave and 1 suspended → distribution eligibility and login lockout
- 30 field visits with check-in/out, 2 flagged as suspect location
- Communications in every state including bounced, failed and suppressed

## 5. Load fixture

`npm run db:seed -- --scale=load` generates **1 000 000 leads**, 3 M activities and
600 k tasks for one tenant via `COPY` streaming, so the pagination, index and
dashboard-query claims in `02-DATA-MODEL.md` are measured rather than asserted.
Runs in roughly 6 minutes on a laptop-class Postgres.

## 6. Credentials

Printed once at the end of the seed, unique per run, never committed:

```
org admin        amina.rashid@example.com
sales director   dhruv.menon@example.com
branch manager   sofia.marchetti@example.com
sales rep        joel.fernandes@example.com
field rep        karim.haddad@example.com
service agent    liza.gonzales@example.com
read-only        auditor@example.com
```
