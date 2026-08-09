# End-to-end tests

§7 asks for one Playwright happy-path flow per module. `tests/e2e/modules.spec.ts`
is that flow: a workspace created through the platform wizard, then every sales
module opened and used as its administrator.

```
npm run test:e2e                          # the whole suite, 28 tests
npx playwright test tests/e2e/modules.spec.ts
```

## Why this kind of test earns its keep

Everything else in this repo verifies a module from the inside. Unit tests call
services directly; driving the API by hand proves the API. Neither notices a
page that renders 401, a link that omits the workspace slug, or a permission
that was never granted — and all three have happened here.

**The first run of this file failed immediately**, and the reason was a real
defect rather than a test problem.

## What it found

Workspace provisioning granted its administrator a **hardcoded list** of
permission modules:

```
employee, leave, attendance, hr_documents, departments, overtime, shifts,
holidays, work_locations, hr_reports, hrms, leads, opportunities, accounts,
contacts, activities, tasks, calls, campaigns, reports, users, roles,
settings, auditlogs, integrations
```

That is 25 of the 61 modules in the catalogue. **The other 36 were unreachable
in any newly created workspace** — not only the recent ones:

> allocation, apikeys, automation, bookings, clientprofiles, commissions,
> commissionslabs, communications, contests, dashboards, dialer, distribution,
> documents, employees, events, exports, fieldsales, forms, imports,
> landingpages, listings, lists, payouts, payroll, performance, posts, products,
> projects, recruitment, referrals, requirements, sla, smartviews, testimonials,
> tickets, visits

Each module's migration backfills grants by deriving from rows already in
`RolePermission`, so those backfills only ever helped workspaces that **already
existed** when the migration ran. A workspace created afterwards got the
hardcoded list and nothing else — so roughly 40% of the product was invisible in
every new tenant, and had been since M4.

The fix is one query. The list stays as a floor that guarantees the baseline
permissions exist in a fresh database; the *grant* now takes the whole
catalogue, which is what the role's own description — "Full administration
inside this workspace only" — already claims, and which cannot drift again the
next time a module ships.

## Fixing the workspaces that already exist

The provisioning fix only applies when a workspace is created. Every workspace
created before it still carries the narrow grant, so there is a one-off script:

```
node scripts/backfill-admin-permissions.mjs            # dry run
node scripts/backfill-admin-permissions.mjs --apply    # write
```

**The part that matters is what it refuses to do.** Revoking a permission
*deletes* its `RolePermission` row (see `services/identity/roles.ts`), so a
missing row is ambiguous — it can mean "never granted" or "an administrator
deliberately took this away". Restoring both would silently undo every
deliberate revocation in the database, which is a worse bug than the one being
fixed.

The old hardcoded list is the discriminator, and it is exact:

| Missing permission | Meaning | Action |
|---|---|---|
| In the old list | Provisioning granted it, so somebody removed it | **Left alone** |
| Not in the old list | Never offered — the bug | **Granted** |

Nothing is revoked, downgraded or re-scoped, and an existing row is never
touched, including one sitting at `granted = false`. It targets only the
`company_admin` / `org_admin` roles that provisioning creates; roles an
administrator made themselves are not touched.

Sessions are not revoked: `resolveCtx` reads role permissions from the database
on every request, so the grants take effect on the next one.

On the development database it granted 121,891 permissions across the older
workspaces, left 2,880 apparent deliberate revocations alone, and reported
"already complete" for every workspace the e2e suite had created since the
provisioning fix — which is the fix confirming itself. A second run grants zero.

## What the flow covers

| Step | Module | What it does |
|---|---|---|
| 1 | Platform | Creates a workspace through the five-step wizard, signs its admin in |
| 2 | M4 | Opens the project catalogue |
| 3 | M5 | Opens listings |
| 4 | M3 | Opens Clients, records a profile, sees it on the page |
| 5 | M6 | Opens the site-visit register |
| 6 | M7 | Opens Calls and Allocation, asks for leads, sees the request queued |
| 7 | M9 | Opens Commissions, confirms it ships with no rates, drafts a slab and sees it *awaiting finance* |
| 8 | M10 | Opens the leader dashboard and checks the funnel reports arrivals separately |
| 9 | M10 | Opens three reports by their menu links and downloads the CSV |
| 10 | M11 | Posts to the feed and reacts to it, both through the UI |

Where a module's UI is read-only and its data is created by API — commissions,
allocation, profiles — the step uses `page.request`, which shares the browser's
session. That is not a shortcut around the test: it proves the API and the page
agree about the same tenant and the same permissions, which is the class of bug
that has actually occurred here.

## House rules inherited from the existing suite

- **One worker, no parallelism.** Every spec drives the same Postgres database.
- **No retries, in CI either.** A retry turns an intermittent failure into a
  green run with a note nobody reads.
- **`RUN_TAG`.** Every workspace and account the suite creates carries a marker
  unique to the run, and `globalTeardown` deletes exactly those.
- Locate by role and label. `[name=...]` is for setup code only, where the thing
  being located is not the thing under test.

## Not covered

- **HR module flows.** `acceptance.spec.ts` covers the employee invitation path;
  leave, attendance, payroll and recruitment have no happy path of their own.
- **The public pages.** The RSVP and testimonial links are driven by unit tests
  and by hand, not by a browser.
- **Mobile viewports.** One project, Desktop Chrome.
- **The dialer's actual calling.** No vendor has ever placed a real call from
  this codebase; that remains true and is noted in `TELEPHONY-PROVIDERS.md`.
