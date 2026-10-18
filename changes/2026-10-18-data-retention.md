# A workspace keeps its audit log, attendance punches and AI events longer than the deployment, never shorter

**What.** Audit row M18-11, PR #220. A per-workspace
retention window for three kinds of record, and a nightly retention job that
follows it.

**Why.** The owner's retention decision (18 Oct): the audit log is kept 7 years,
attendance punches 2 years and AI events 1 year, and a workspace may keep a
record longer than the deployment but never shorter.

**Where.**

- `apps/web/src/lib/jobs/retention.ts`: `WORKSPACE_RETENTION` (the three
  kinds and their deployment windows) and `workspaceRetention()` (the
  deployment's window, the workspace's and the one applied). The sweep and its
  dry run skip a row while its workspace's longer window still covers it.
- `apps/web/src/app/api/v1/workspaces/[workspaceSlug]/settings/[section]/route.ts`:
  new section `retention` (`settings:MANAGE_CONFIGURATION`). Stores the windows
  in `OrganizationSetting.retentionPolicy` and refuses (422) a window shorter
  than the deployment's. The save reads the stored windows under a row lock
  (`SELECT ... FOR UPDATE` in `withTx`), so two saves of different kinds at
  once both land instead of the later one dropping the other's window.
- `apps/web/src/app/(workspace)/[workspaceSlug]/admin/[section]/page.tsx`:
  `/admin/retention` (`settings:VIEW` to read). Shows each kind's deployment
  window, the workspace's own and how long it is kept.
- `apps/web/src/lib/nav/workspaceNav.ts`: the Data Retention tab under
  Administration → Settings.
- `SettingsForm.tsx`: a refused save now shows the field's message, not just
  "1 field failed validation".

**Behaviour.** An administrator can enter a number of days for each kind (at
least the deployment's window, and at least 30), or leave it empty to follow
the deployment. The nightly job deletes a row only once it is past both
windows. When the deployment keeps a kind for ever (its variable empty, the
default), nothing is deleted, whatever the workspace enters. A number stored
then still counts as the workspace's minimum if the operator later sets a
window. Attendance capture frames already had a per-workspace window
(HR policy `captureRetentionDays`) and are unchanged. `PlatformAuditEvent`
(our own staff's access) stays a deployment-only window.

**Decisions taken.**

- Lengthen only. The job applies the longer of the deployment's window and the
  workspace's, so a workspace value can never delete a row early, even one
  stored before the deployment chose a longer window. The API also refuses a
  value below the deployment's window (422).
- Deployment defaults are unchanged. Today's default for all three is empty,
  which keeps everything. The owner's 2555, 730 and 365 days are all shorter
  than that, and lowering a default would delete existing rows on the next
  sweep. The operator sets them in each environment's `.env` when ready.
- Stored in the existing `OrganizationSetting.retentionPolicy` JSON column,
  which has been in the baseline since August and was never read. No
  migration.
- The workspace window may be set while the deployment keeps everything. It
  then acts as that workspace's minimum for when a deployment window is set.
  Once that window is set, the stored value is not refused when the form sends
  it back unchanged; only a changed value below the deployment gets 422.
- Leads get no window. The owner named none, and leads are business records,
  not logs.

**Verified.** `tests/tenant/audit-retention.spec.ts` (9): a workspace keeping
500 days keeps its 400-day-old audit row while the other workspace's row is
deleted under a 90-day deployment window, and the dry run counts 1 without
deleting (fails on the old code: 2). A 30-day workspace value under a
500-day deployment window deletes nothing. `tests/permission/admin-editors.spec.ts`
(17): a longer window is stored and the applied window reported; a shorter one
gets 422 and is not stored; emptying clears it; a settings viewer gets 403; a
value stored before the deployment set a longer window comes back unchanged
with another kind's change and the save succeeds; three saves of different
kinds sent at once all stay stored (both failed on the first version: 422, and
one window lost).
Nav, permission-catalogue and OpenAPI unit specs pass (839 in 9 files). The E2E
navigation spec opens `/admin/retention` as an administrator. tsc clean.

**Left open.**

- Staging and production: set `AUDIT_LOG_RETENTION_DAYS=2555`,
  `ATTENDANCE_PUNCH_RETENTION_DAYS=730` and `AI_EVENT_RETENTION_DAYS=365` once
  the owner confirms deletion should start. Deletion is permanent.
- A lead retention window, if one is ever wanted.
