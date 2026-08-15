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

1. Open `/login` (local install: <http://localhost:3000/login>).
2. Email: **`demo@manathhomes.ae`** — the customer-facing demo login
   (`admin@manathhomes.ae` and `demo@manathhomes.com` work identically).
3. Password: printed by the seed in its closing summary box. It is generated per
   run and never committed; to pin a stable one for a demo install, set the
   `DEMO_PASSWORD` environment variable before seeding.
4. No authentication code: the demo accounts are ordinary workspace users, so
   the mandatory-MFA rule for platform staff does not apply to them.

All demo accounts share the same password and land in the `manath-homes`
workspace as org admins with their own populated queues (owned leads,
follow-ups, a target, today's calls, notifications).

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
platform role, must present a TOTP code. The account ships in the
**enrolment-pending** state: the first correct password login opens the
in-app authenticator setup (QR / setup key → first code → recovery codes),
after which sign-in is password + the six-digit code from your app. Keep the
recovery codes — each signs you in once if the authenticator is lost.

If the authenticator is ever unrecoverable on a local install:

```bash
node scripts/owner-mfa.mjs --reset    # back to enrolment-pending; next login shows setup again
node scripts/owner-mfa.mjs            # or: print codes for a script-enrolled secret
```

The script refuses to run when `NODE_ENV=production`.

## Login smoke test

```bash
node scripts/demo-smoke.mjs           # verifies demo login + session against DEMO_URL (default :3000)
```

Credentials come from the environment (`DEMO_URL`, `DEMO_EMAIL`,
`DEMO_PASSWORD` — the latter read from `.env`); nothing secret is hardcoded.
The login page footer shows the running **build id** so you can always confirm
which build you are testing.

After signing in, the owner lands on `/platform`. Workspace data (leads, calls,
call audits) is reached by **entering** a workspace: Platform → Workspaces →
Enter on `manath-homes`. That explicit step is deliberate — support access to
tenant data is granted per session and audited.

## Manath AI (in-app assistant)

The ✦ button at the bottom right of every workspace page opens **Manath AI**,
the CRM copilot. It answers from the signed-in user's own data only — every
lookup runs through the same permission scoping as the pages — and cites the
records it used as clickable chips. Record-changing requests ("create a
follow-up for tomorrow…") are prepared and shown with a Confirm button; nothing
is written until the user confirms.

Good demo prompts:

- "What should I focus on today?"
- "Which leads have breached SLA?" · "Show my hottest leads"
- "Summarize Northbay Logistics" · "Find Priya Karim"
- "Prepare me for a call with Tariq Haddad"
- "Summarize the latest recorded call."
- "Create a follow-up for tomorrow to send the payment plan"
- On a lead page: "Summarize this client" / "What happened recently?"

Without `GEMINI_API_KEY` the assistant runs in **template mode**: a keyword
router drives the same permission-scoped tools and renders real records through
fixed phrasing. With the key set, Gemini plans the tool calls and writes the
answers (function calling); the data path and permissions are identical.

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
