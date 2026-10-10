# Saving a workspace in the console cut off a paying customer's modules

**What.** The platform console's workspace PATCH sets a module's end date from
the trial end only while the workspace is on trial, and only when the save
changes the trial end. Otherwise the modules' end dates are left as they are.

**Why.** Found 10 Oct by a catalogue of every date field in the app. The edit
form sends `trialEndsAt` (prefilled with the stored date) and `enabledModules`
on every save, and the route wrote that trial end into every enabled module's
`endsAt`. For a customer who started on a trial and now pays, the old trial
end is in the past — so fixing anything on their workspace page, the company
phone say, refused every module from the next request. On a live trial, the
time of day of a sign-up trial's end was also cut back to midnight UTC.

**Where.** `apps/web/src/app/api/v1/platform/workspaces/[workspaceId]/route.ts`;
`apps/web/tests/platform/workspace-edit-entitlements.spec.ts` (new — the PATCH
had no test).

**Behaviour.** A save that does not change the trial end leaves module access
alone. Changing the trial end of a workspace on trial moves its modules' end
with it. A module newly switched on gets the trial end on a trial, no end
otherwise.

**Verified.** The new spec fails on the old route (the paying customer's module
end became 2026-01-01; the trial's exact end was cut to midnight) and passes on
the fix; with the platform admin spec, 13 of 13; the platform specs; typecheck.

**Left open.** The trial end is still read as UTC midnight of the chosen day,
not the end of that day in the workspace's time zone — part of the date fixes
that follow. Changing "Trial ends" on the Subscriptions page still does not move
module access.
