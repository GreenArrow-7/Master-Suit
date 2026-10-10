# Notifications: a high-priority row looks and sorts like one

**What.** The bell and the Inbox show a HIGH / URGENT badge beside the title
(brass for HIGH, vermillion for URGENT — the same `Badge` tones every other
priority in the app uses), and unread HIGH/URGENT rows are listed first:
within the newest 30 in the bell, the newest 100 in the Inbox. Everything
else keeps its recency order, and a row drops back once it is read.

**Why.** The Lead Eagle phase 2 entry promised the owner a high-priority bell
when a known lead enquires again. The row was written with priority HIGH
(`services/leads/intake.ts`), and so are lead assignments, missed calls,
follow-ups due and the HR escalations, but the feed ordered by `createdAt`
alone and neither screen read `priority`, so a HIGH row looked like every
other entry and sank under newer MEDIUM ones.

**Where.** New `apps/web/src/services/notifications/feed.ts` (`listFeed`),
the one reader both `api/v1/notifications/route.ts` and
`(workspace)/[workspaceSlug]/notifications/page.tsx` now use instead of two
copies of the query; the badge in `components/nav/TopBar.tsx` and the Inbox
page. Tests: `tests/tenant/notification-feed.spec.ts` (new) and
`tests/e2e/entity-navigation.spec.ts` (the seeded social enquiry is HIGH; the
bell and the Inbox badge it, the MEDIUM row shows nothing).

**Behaviour.** No schema, write-path or delivery change: the API response
already carried `priority`; only the order moves, and only for unread
HIGH/URGENT rows. `?unread=true`, PATCH mark-read and the unread count are
untouched. The lift is applied inside the fetched window, so an unread HIGH
older than the 30 newest stays outside the bell as it did before (the
upgrade path is noted in `feed.ts`). Marking a row read in the open panel
does not re-sort it; the next load does.

**Verified.** The new vitest spec fails on the old route — order
`['new medium', 'read urgent', 'old high']` where `['old high', …]` is
expected — and passes on this one, together with
`permission/notifications-self-service`, `security/self-service-api-key` and
`sales/lead-source-intake` (21 tests). Prettier and ESLint clean on every
file touched. E2E and typecheck are the lead's gate.

**Left open.** `sales/tasks/page.tsx` keeps its own `PRIORITY_TONE` with
URGENT → wine, so a task's URGENT and a notification's URGENT differ in
colour; swapping it for `toneFor` would align them. Not touched here.
