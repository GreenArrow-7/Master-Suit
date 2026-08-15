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

## Role logins — the demonstration cast

All share the demo password. Each lands in Manath Homes with genuinely
different server-enforced scope; log out and back in to show "what the
manager sees" vs "what a rep sees".

| Persona (say this in the demo)  | Email                            | Sees                                                |
| ------------------------------- | -------------------------------- | --------------------------------------------------- |
| Organization Administrator      | `admin@manathhomes.ae`           | Everything: org pipeline, users & roles, settings    |
| Sales Manager (Omar Hassan)     | `sales.manager@manathhomes.ae`   | The team's leads/deals; assigns; no admin area       |
| Sales Rep (Sara Khan)           | `sales.rep@manathhomes.ae`       | Only her ~11 leads, follow-ups, target, calls        |
| SDR (Rayan Malik)               | `sdr@manathhomes.ae`             | A 24-lead qualification queue (new/contacted stages) |
| Account Manager (Nadia Ahmed)   | `account.manager@manathhomes.ae` | Her book of 8 accounts + their contacts              |
| Call QA Manager (Daniel Joseph) | `qa.manager@manathhomes.ae`      | All calls, transcripts & audits — read-only records  |
| Executive (Khalid Mansour)      | `executive@manathhomes.ae`       | Org-wide read-only; no + Create, no edits            |

Every login also gets **My role & access** (sidebar → Administration) — a
plain-language page of responsibilities and visible data, derived live from
the role's actual grants.

Legacy `@example.com` logins (same password): amina.alrashid, dhruv.menon,
sofia.marchetti, rashid.alsuwaidi, joel.fernandes, karim.haddad,
liza.gonzales, reem.silva, auditor.

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

**Use the console, not the database.** Sign in as the platform owner and open
**Platform → Platform users**. Search the address the customer typed; the drawer
opens on a verdict — *sign-in permitted* or *sign-in refused, and why* — because
the login form itself deliberately answers every credential failure with one
vague message so nobody can enumerate accounts. That vagueness is owed to the
public, not to you.

From the same drawer:

| Symptom | Action |
| --- | --- |
| Locked after repeated attempts | **Unlock account** — clears the lock, the failed counter and the per-account sign-in throttle together |
| Forgotten password, real customer | **Generate temporary password** — shown once, and they must set their own at next login |
| Forgotten password, demo workspace | Type the password, clear *require a password change*, **Reset password** |
| Lost authenticator | **Reset MFA** — the secret and recovery codes die; enrolment restarts at next sign-in |
| "No active workspace" | **Activate membership** — repairs the membership *and* the workspace user behind it |
| Leaver | **Deactivate user** — authentication stops, their records and history stay |

Every one of these writes an audit event naming you, the target and the result.
Passwords are never logged, never stored in readable form, and a generated one
is returned exactly once to the browser that asked for it.

Three separate things can refuse a sign-in and they are easy to confuse. The
drawer shows all three: the **account lock** (after `MAX_FAILED_LOGINS` wrong
passwords — configured per environment, **10** on the demo install), the
**per-account throttle** (5 attempts per 15 minutes), and the **per-IP throttle**
(10 per 15 minutes from one machine). In practice the per-account throttle (5)
trips before the lock (10). Unlocking clears the first two for that
account. The per-IP limit is global and deliberately not clearable from the
console; on a local install:

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
