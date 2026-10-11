# Self-serve sign-up could not be opened from the console

**What.** Platform → Settings gains the row phase 6 promised and never added:
**Self-serve sign-up (trial days)**. Its third column says whether sign-up is
actually open — "Open at /signup, on the <plan> plan", "Closed: no active plan
includes Lead Eagle", or "Closed".

**Why.** On 10 Oct the owner went to open sign-up with a 14-day trial as the
phase 6 entry described ("Platform console → Settings → Self-serve sign-up
(trial days)"), saved 14, and `/signup` stayed a 404. Phase 6 added the setting
to `EDITABLE_SETTINGS` (so the API accepted it) and to the services that read
it, but not to the page; its browser check opened sign-up through the database,
so the missing row was never noticed. The 14 went into one of the five
settings that were there.

**Where.** `apps/web/src/app/(platform)/platform/settings/page.tsx`; a browser
test, `apps/web/tests/e2e/platform-signup-setting.spec.ts`.

**Behaviour.** The owner sets the trial length in the console; 0 closes
sign-up. Open needs an active plan that includes Lead Eagle, as before, and the
row now says which plan new workspaces go on.

**Verified.** The new E2E spec (platform owner: makes a Lead Eagle plan through
the form, sets 14 days in the console, expects "Open at /signup", `/signup`
offering 14 days, then closes it again) fails on the old page — no row to edit
— and passes on this one. Typecheck, lint and format clean.

**Left open.** Whatever setting the owner's 14 landed in needs setting back:
the audit log's `PLATFORM_SETTING_CHANGED` entry has the value before.
