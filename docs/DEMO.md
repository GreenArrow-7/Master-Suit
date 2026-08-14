# Demo workspace

The seed builds a fully linked demo brokerage — **Manath Homes** — so every screen
has data: leads through accounts, contacts, opportunities, calls with transcripts,
AI analyses and scored audits, follow-ups, targets, notifications, events,
campaigns, communications, forms and landing pages.

## Signing in

1. Open `/login`.
2. Workspace: `manath-homes`.
3. Email: `demo@manathhomes.com` (Demo Presenter, org admin, employee code MH-032).
4. Password: printed by the seed in its closing summary box. It is generated per
   run and never committed; to pin a stable one for a demo install, set the
   `DEMO_PASSWORD` environment variable before seeding.

All demo accounts share the same password.

## Role logins

| Role             | Email                          |
| ---------------- | ------------------------------ |
| org_admin        | amina.alrashid@example.com     |
| sales_director   | dhruv.menon@example.com        |
| branch_manager   | sofia.marchetti@example.com    |
| team_manager     | rashid.alsuwaidi@example.com   |
| sales_rep        | joel.fernandes@example.com     |
| field_rep        | karim.haddad@example.com       |
| service_agent    | liza.gonzales@example.com      |
| analyst          | reem.silva@example.com         |
| read_only        | auditor@example.com            |

The exact list (plus the second, HRMS-only workspace `leadersfort`) is printed by
the seed after every run.

## Re-seeding

From `apps/web`:

```bash
ALLOW_DEMO_SEED=yes npm run db:seed             # top-up: keeps existing records
ALLOW_DEMO_SEED=yes npm run db:seed -- --reset  # drop the demo tenant and rebuild
```

The seed is idempotent: users and configuration are upserted, lead generation is
skipped if leads exist, and the CRM chain is skipped if accounts exist. A top-up
run over an already-seeded database therefore only fills in whatever layer is
missing (and always rotates the printed password unless `DEMO_PASSWORD` is set).
