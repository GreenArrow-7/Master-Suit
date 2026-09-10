# Demo workspace

The workspace is **YOUHAN ONE Demo** — the official product demonstration.
It was called "Manath Homes" until 2026-09-09; that name is kept in the
governance history, which records what was actually there at the time, and
nowhere a client can see.

The seed builds a fully linked demo brokerage — **YOUHAN ONE Demo** — so every screen
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
2. Email: **`demo@youhan.in`** — the single client-facing login. See
   "The client login" below; it is the only address a client is given.
   For local work `demo@example.com`, `admin@example.com` and
   `demo.presenter@example.com` are internal and work identically.
3. Password: printed by the seed in its closing summary box. It is generated per
   run and never committed; to pin a stable one for a demo install, set the
   `DEMO_PASSWORD` environment variable before seeding.
4. No authentication code: the demo accounts are ordinary workspace users, so
   the mandatory-MFA rule for platform staff does not apply to them.

All demo accounts share the same password and land in the `youhan-one-demo`
workspace as org admins with their own populated queues (owned leads,
follow-ups, a target, today's calls, notifications).

## Role logins — the demonstration cast

All share the demo password. Each lands in YOUHAN ONE Demo with genuinely
different server-enforced scope; log out and back in to show "what the
manager sees" vs "what a rep sees".

| Persona (say this in the demo)  | Email                            | Sees                                                |
| ------------------------------- | -------------------------------- | --------------------------------------------------- |
| Organization Administrator      | `admin@example.com`           | Everything: org pipeline, users & roles, settings    |
| Sales Manager (Omar Hassan)     | `sales.manager@example.com`   | The team's leads/deals; assigns; no admin area       |
| Sales Rep (Sara Khan)           | `sales.rep@example.com`       | Only her ~11 leads, follow-ups, target, calls        |
| SDR (Rayan Malik)               | `sdr@example.com`             | A 24-lead qualification queue (new/contacted stages) |
| Account Manager (Nadia Ahmed)   | `account.manager@example.com` | Her book of 8 accounts + their contacts              |
| Call QA Manager (Daniel Joseph) | `qa.manager@example.com`      | All calls, transcripts & audits — read-only records  |
| Executive (Khalid Mansour)      | `executive@example.com`       | Org-wide read-only; no + Create, no edits            |

Every login also gets **My role & access** (sidebar → Administration) — a
plain-language page of responsibilities and visible data, derived live from
the role's actual grants.

Legacy `@example.com` logins (same password): amina.alrashid, dhruv.menon,
sofia.marchetti, rashid.alsuwaidi, joel.fernandes, karim.haddad,
liza.gonzales, reem.silva, auditor.

The exact list (plus the second, HRMS-only workspace `leadersfort` —
`admin@leadersfort.example.com`, same shared password) is printed by the seed after
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
Enter on `youhan-one-demo`. That explicit step is deliberate — support access to
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

---

# Client demonstration: Sales and HRMS

Added by `SPEC-0007`. Everything above describes the demo workspace as it was
before the People module had any data; this section is the current runbook.

## What the demonstration covers

Sales and HRMS, in one workspace (`youhan-one-demo`), with three logins whose
scope genuinely differs. Nothing here is a mock-up: the screens are the
product, the permissions are the product's, and the data is synthetic.

## Preparing the database

The demonstration data belongs in a disposable database whose name carries the
`demo` marker, so the boot cross-check and the seed guards both recognise it.

```bash
docker exec master-saas-postgres-1 psql -U leadflow -d postgres -c "CREATE DATABASE master_saas_demo OWNER leadflow;"
```

Point `DATABASE_URL` and `MIGRATION_DATABASE_URL` at it, set `APP_ENV=demo`,
then apply the schema:

```bash
npx prisma migrate deploy
```

## Seeding

```bash
ALLOW_DEMO_SEED=yes npm run db:seed
```

Set `DEMO_PASSWORD` before seeding to pin a credential for the run; leave it
unset and the seed generates one and prints it once. **The password is never
written to a file, a log or this document.**

The seed reports what it built. The HR half is:

```text
5 departments · 8 designations · 2 shifts · 6 holidays · 4 leave types
41 employees profiled (5 managers) · 164 leave balances
leave: 9 approved · 5 pending · 4 rejected
1845 attendance records over 45 working days
```

41 of the 42 profiles are active — one login is deliberately suspended, to
demonstrate that a suspended account is not an active employee. Attendance is
generated for every active employee, so 41 × 45 = 1845. The figures move when
a persona is added — `CHG-001` made the population an invariant with a floor
rather than a fixed number, so the suite does not encode a ceiling.

## The client login — one account, both modules

`demo@youhan.in` is the **single client-facing login**. It is the only address
a client is ever given; every other account in this document is internal.

A client is given **one** credential. It signs in once and reaches Sales and
HRMS in the same session, in the same workspace, with no sign-out and no
workspace switch.

| | |
| --- | --- |
| Login | `demo@youhan.in` |
| Role | `org_admin` |
| Platform role | `USER` — **not** a platform administrator |
| Workspace | `youhan-one-demo`, entitled to both SALES and HRMS |

This works because the workspace carries both module entitlements and both
datasets. It is the safest tenant-scoped role that reaches everything a
demonstration needs: a wildcard *inside one workspace* is not platform
authority, and the account is refused the platform console. `E2E-006` asserts
the whole of that — one session across both modules, the session cookie
unchanged throughout, and the platform API still refused.

`demo@youhan.in` is the one address in this seed that is not on a reserved
domain. That is deliberate and governed: `CHG-004` records the amendment to
`DATA-005`, on the grounds that an organisation-controlled mailbox is the thing
`DATA-005` was protecting against reaching — an *uncontrolled* one. Every
generated address — employees, contacts, leads, and the internal logins below
— stays on `example.com` under `CL-007`.

### Internal logins, not for clients

These are **internal** test personas. They are not client credentials.

| Persona | Login | Role | Why it exists |
| --- | --- | --- | --- |
| Sales | `sales.rep@example.com` | `sales_rep` | Proves scope: this login sees its own book, not the company's |
| HR | `hr.manager@example.com` | `hr_admin` | Proves the HR side of the same boundary |
| Management | `admin@example.com` | `org_admin` | The former client login; kept as an internal fixture |

**Do not give these to a client.** They exist so the security suite can prove
role isolation at all — `ST-003` and `ST-004` need two differently-scoped
accounts, and deleting them would delete the evidence. They are also useful
internally for showing "what a rep sees" against "what a manager sees".

## The walkthrough

**Management** — dashboard, Sales leads and opportunities organisation-wide, HR
employees and attendance, workspace users. Then sign out.

**Sales** — dashboard, leads, accounts, contacts, opportunities, activities,
tasks, and one lead opened in detail. The list is deliberately smaller than the
Management view; that difference is the point.

**HR** — employee directory, one employee in detail, departments, attendance,
leave (with approved, pending and rejected requests in the queue), shifts,
holidays.

## Resetting

```bash
ALLOW_DEMO_SEED=yes npm run db:seed -- --reset
```

This drops the demo tenant and rebuilds it. Every tenant-scoped record goes
with it through the database cascade — Sales and HR alike — and the workspace
comes back to the same baseline, deterministically: the same employees, the
same attendance, the same leave queue. A demonstration that made a mess is
one command from clean.

`PlatformAuditEvent` deliberately survives, so the record of what was done to
the workspace outlives the workspace.

## Safety

The seed refuses to run unless the target is disposable. Four independent
gates, each of which alone is enough to stop it:

| Gate | Refuses when |
| --- | --- |
| Build declaration | `NODE_ENV=production` |
| Deployment declaration | `APP_ENV` is `production` or `staging` |
| Database name | the target is named `*_prod`, `*_production`, `*_staging` or `*_stage` |
| Operator intent | `ALLOW_DEMO_SEED=yes` is not set |

Every refusal happens **before** the first destructive statement, and a test
asserts that the row counts are unchanged after each one.

## Deliberate exclusions

Say these out loud in a demonstration rather than being caught by them:

- **Payroll is out of scope.** No compensation, payslip, salary, bank account,
  IBAN or wage-protection record is seeded. The payroll screens open and are
  empty, and that is intentional, not broken.
- **No biometrics.** No face template, no biometric consent, no attendance
  capture image. Face-based check-in cannot be demonstrated from this dataset.
- **No real data.** No real person's name, address, telephone number or
  employee identifier, and nothing copied or derived from production.
- **Nothing leaves the machine.** The demo environment selects the mock mail,
  messaging and antivirus providers and holds no vendor credential, so a
  follow-up email or an invitation is recorded and discarded rather than sent.
  The workspace holds no integration connection, so no callback can reach it
  either.

## Credentials

Provisioned through the normal account process and handed over out of band.
Never committed, never written into evidence, never printed into a log. For a
deployed demonstration environment this is `SPEC-0008`'s responsibility; the
local seed's one-time printout is a development convenience and is not the
deployed path.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Too many sign-in attempts` | The per-IP throttle. Expected: it is the same protection real accounts get. Clear the `rl:` keys in Redis on a local install |
| A screen is empty | Check whether it is on the exclusions list above before treating it as a defect |
| The seed refuses | Read which of the four gates it named. It is telling you the target is not disposable |
| Employee counts differ after a re-seed | A re-seed is deterministic; a *top-up* over an existing database only fills gaps. Use `--reset` for a known baseline |
