# Demo workspace

The seed builds a fully linked demo brokerage — **Manath Homes** — so every screen
has data: leads through accounts, contacts, opportunities, calls with transcripts,
AI analyses and scored audits, follow-ups, targets, notifications, events,
campaigns, communications, forms and landing pages.

## Starting everything after a reboot

Double-click **`start-demo.cmd`** in the repository root. It starts Docker
Desktop if needed, brings up the database containers, waits for PostgreSQL, and
serves the production build on <http://localhost:3000> (the first run builds it —
a few minutes; later starts take seconds). Keep the window open; closing it
stops the web app only. After changing source, rebuild with
`npm run start:local -- --build` from `apps/web`.

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

The exact list (plus the second, HRMS-only workspace `leadersfort` —
`admin@leadersfort.com`, same shared password) is printed by the seed after
every run.

## Platform owner (`owner@masterapp.local`)

The owner signs in with the password from `PLATFORM_OWNER_PASSWORD` in
`apps/web/.env` — **not** the shared demo password — and, like every privileged
platform role, must present a TOTP code. On a local install, get codes with:

```bash
node scripts/owner-mfa.mjs            # prints the current 6-digit code
node scripts/owner-mfa.mjs --enroll   # (re)sets the secret; also prints an otpauth:// URL
```

`--enroll` prints an `otpauth://` URL you can scan into a phone authenticator
once, after which the script is unnecessary. The script refuses to run when
`NODE_ENV=production`.

After signing in, the owner lands on `/platform`. Workspace data (leads, calls,
call audits) is reached by **entering** a workspace: Platform → Workspaces →
Enter on `manath-homes`. That explicit step is deliberate — support access to
tenant data is granted per session and audited.

## If a login is refused

Five wrong attempts on one account (or ten from one machine) within 15 minutes
locks login temporarily — wait it out, or on a local install clear the counters:

```bash
docker exec master-saas-redis-1 sh -c "redis-cli --scan --pattern 'rl:login:*' | xargs -r redis-cli del"
```

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
