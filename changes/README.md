# Changes

The project's working memory: what exists, what changed, why, and where. It
lets a new session learn the project by reading this folder rather than the
code and the git history, so it has to stay short and current.

## Read in this order

1. [`PROJECT.md`](PROJECT.md) — the current state: modules, the rules every
   change follows, where code lives, how to test, verify and release, and what
   waits on a decision.
2. The index below, newest first. Open an entry only when the task touches it.

## Adding an entry

One file per change, committed in the same PR as the change, named
`YYYY-MM-DD-short-name.md`. Keep each section to a few lines:

- **What** — the change, and its PR.
- **Why** — the requirement or the defect, and who decided.
- **Where** — the files that matter, one line each.
- **Behaviour** — what users or operators now see differently.
- **Verified** — the tests (say which fail on the old code) and any browser check.
- **Left open** — follow-ups and decisions still needed.

Then add a row to the index and correct `PROJECT.md` wherever it is now wrong.

## Index

| Date | Entry | PR | Area |
|---|---|---|---|
| 2026-10-18 | [Phone apps 1.3.0 with push (prepared; merge after the owner's keys)](2026-10-18-mobile-1-3-0-push.md) | #224 | Mobile, build |
| 2026-10-18 | [Every export also downloads as an Excel workbook](2026-10-18-xlsx-export.md) | #229 | Reports, Lead Eagle, HR, export, feature |
| 2026-10-18 | [Send an SMS from the lead, through the workspace's Twilio](2026-10-18-le-lead-sms.md) | #227 | Lead Eagle, messaging, telephony, feature |
| 2026-10-18 | [Meetings, follow-ups and site visits on the workspace's Microsoft 365 (Outlook) calendar, connected with Microsoft](2026-10-18-le-outlook-calendar.md) | #228 | Lead Eagle, follow-ups, integrations, feature |
| 2026-10-18 | [Next.js 16.4.2: the dev server no longer starts without its deepest routes](2026-10-18-next-16-4-2.md) | #226 | Platform, dependencies, CI |
| 2026-10-18 | [Browser tests no longer fail on a connection the dev server already closed](2026-10-18-e2e-socket-reuse.md) | #225 | Test, CI |
| 2026-10-18 | [One tap checks phone notifications end to end](2026-10-18-push-test-button.md) | #223 | Notifications, feature |
| 2026-10-18 | [Reminders ring fifteen minutes before](2026-10-18-reminders-t15.md) | #218 | Lead Eagle, follow-ups, notifications |
| 2026-10-18 | [A workspace keeps its audit log, attendance punches and AI events longer than the deployment, never shorter](2026-10-18-data-retention.md) | #220 | Admin, retention, feature |
| 2026-10-18 | [Meetings, follow-ups and site visits on the workspace's Google Calendar, connected with Google](2026-10-18-le-google-calendar.md) | #221 | Lead Eagle, follow-ups, integrations, feature |
| 2026-10-18 | [Lead Eagle has its own sign-in door: the same accounts and session under its name](2026-10-18-le-signin-branding.md) | #219 | Lead Eagle, sign-in, branding |
| 2026-10-18 | [Round 3 batch B review: reports read a visit's and a booking's own project, Call Report reads under the calls scope, call reports mail only to those who may see the calls](2026-10-18-round3-b-report-review.md) | #217 | Reports, Lead Eagle, fix |
| 2026-10-18 | [The board-filters test reads the board at the moment its data was made](2026-10-18-dashboard-filters-one-clock.md) | — | Test, CI |
| 2026-10-18 | [The Lead Eagle move tool counts every table it leaves behind and names every author it loses](2026-10-18-move-tool-every-table.md) | #208 | Lead Eagle, data migration, fix |
| 2026-10-18 | [A call's WhatsApp follow-up starts the thread with a template; a listing or project is shared from its own page and the share is on the lead's timeline](2026-10-18-le-comms.md) | #209 | Lead Eagle, calls, messaging |
| 2026-10-18 | [Reports filter by period, person, team, source and project; Lead Eagle loses the money reports; Rep Activity counts calls, moves and notes; attendance summary without HRMS](2026-10-18-reports-polish.md) | #210 | Reports, Lead Eagle, attendance |
| 2026-10-18 | [A morning summary email; lead hand-overs tell the new owner; an untouched lead escalates after any hand-over](2026-10-18-notify-digest.md) | #211 | Notifications, Lead Eagle, feature |
| 2026-10-18 | [The check-in screen shows today's target; absence and standing shifts feed assignment; Face Activity and the objection playbook in every workspace; Lead Eagle opens on its board](2026-10-18-le-attendance-ai.md) | #212 | Attendance, allocation, Lead Eagle, live calls |
| 2026-10-18 | [Lead settings: required custom fields on Add lead, the lead form layout, holidays in assignment, brand colours on the QR page, a paged Audit Log, and the OpenAPI document](2026-10-18-le-settings-api.md) | #214 | Lead Eagle, admin, allocation, audit, API |
| 2026-10-18 | [Project, site-visit and call reports; reports regroup by user, month, project or lead; any report can be emailed on a schedule](2026-10-18-reports-new.md) | #204 | Reports, Lead Eagle, feature |
| 2026-10-18 | [A provider's calls on the lead's timeline, a call report per agent, missed-call notices and tracking numbers](2026-10-18-le-calls.md) | #205 | Lead Eagle, calls, telephony |
| 2026-10-18 | [A manager sees their whole line; quotas, languages, availability and shares steer assignment; Lead Eagle writes its own automations](2026-10-18-assignment-followups.md) | #206 | Lead Eagle, allocation, automation, follow-ups |
| 2026-10-18 | [Projects and listings for every lead module: payment plans, uploads, units from the page, paging and views, permits, pocket listings, unit matches](2026-10-18-le-projects-listings.md) | #207 | Lead Eagle, projects, listings, feature |
| 2026-10-18 | [Offline follow-ups and cold calls on the phone; the call log estimates the call; every write is audited or says why not; an Arabic workspace reads right to left; the lead lists measured at 1,000,000 leads](2026-10-18-mobile-offline-rtl-audit.md) | #215 | Mobile, offline, audit, RTL, performance |
| 2026-10-17 | [The phone apps carry the push plugin](2026-10-17-native-push-plugin.md) | — | Mobile, build |
| 2026-10-17 | [Each person chooses phone and email copies of their notifications](2026-10-17-notification-prefs.md) | — | Notifications, feature |
| 2026-10-17 | [Automatic assignment can be switched on, and is on for new Lead Eagle workspaces](2026-10-17-assignment-rules.md) | #194 | Lead Eagle, allocation, feature |
| 2026-10-17 | [Teams can be created, with a manager and members](2026-10-17-teams.md) | — | Admin, scope, feature |
| 2026-10-17 | [An untouched lead at its SLA tells the manager, and can be handed on](2026-10-17-sla-escalation.md) | — | Lead Eagle, allocation, feature |
| 2026-10-17 | [Site visits coming up ring the bell](2026-10-17-visit-reminders.md) | — | Lead Eagle, site visits, feature |
| 2026-10-17 | [Assignment rules can route by source, city or project](2026-10-17-rule-conditions.md) | — | Lead Eagle, allocation, feature |
| 2026-10-17 | [Tasks can repeat](2026-10-17-recurring-tasks.md) | — | Tasks, feature |
| 2026-10-17 | [Follow-ups coming due ring the bell](2026-10-17-follow-up-reminders.md) | — | Lead Eagle, follow-ups, fix |
| 2026-10-17 | [A Lead-Eagle-only workspace can record an owner and create a listing](2026-10-17-le-listing-owner.md) | — | Lead Eagle, listings, fix |
| 2026-10-15 | [Phone app 1.2.0 (Android version code 11)](2026-10-15-mobile-1-2-0.md) | — | Mobile, build |
| 2026-10-15 | [Nothing in the iOS app sells, prices or points at buying the service](2026-10-15-ios-no-purchase-paths.md) | — | Mobile, App Store, fix |
| 2026-10-14 | [An assigned lead never commits with a WAITING triage episode, whatever path wrote the owner](2026-10-14-triage-episode-on-assign.md) | #189 | Sales, triage queue, fix |
| 2026-10-13 | [The dashboards read in one transaction; the Audit Log keeps the workspace's clock; a lead's delete is one row on the lead; the Undo toast and Cold Data on a phone](2026-10-13-fanout-audit-clock-ui.md) | #187 | Lead Eagle, performance, audit, cold data, UI |
| 2026-10-13 | [The Lead Eagle board filters by period, person, team, source and project, and every figure opens its list](2026-10-13-lead-eagle-dashboard-filters.md) | #188 | Lead Eagle, dashboard |
| 2026-10-13 | [Lead Eagle evidence fixes: chips at 390 px, the Calls clock and Today count, the pinned Call cell, Ctrl K, the calendar](2026-10-13-lead-eagle-evidence-defects.md) | #186 | Lead Eagle, leads, calls, calendar, fix |
| 2026-10-13 | [Send a WhatsApp or email template from the lead and to many leads; share a listing or project as a page that tells the agent when it is opened](2026-10-13-lead-send-share.md) | #182 | Lead Eagle, leads |
| 2026-10-13 | [The Lead Eagle board counts what its lists show: callbacks apart from other follow-ups, untouched and unassigned leads, meetings, conversion, sources, the funnel, calls and a leaderboard](2026-10-13-lead-eagle-dashboard-tiles.md) | #185 | Lead Eagle, dashboard |
| 2026-10-13 | [Two leads merge into one; a lead import can update the leads it matches, be checked first, and hand back its refused rows](2026-10-13-lead-merge-import.md) | #181 | Lead Eagle, leads, import |
| 2026-10-13 | [A listing with a live mandate can be published again; three more reads inside a transaction found nothing](2026-10-13-listing-mandate-tenant-read.md) | #184 | fix, Real Estate, HR, collections |
| 2026-10-13 | [The lead grid tags, deletes with Undo and moves leads to Cold Data in bulk; it pages by keyset, measured at 100,000 leads](2026-10-13-lead-bulk-tag-delete-move.md) | #183 | Lead Eagle, leads, cold data, performance |
| 2026-10-13 | [The lead page no longer asks for more database connections than the pool holds](2026-10-13-lead-page-transaction-pressure.md) | #180 | Lead Eagle, leads, fix |
| 2026-10-13 | [The lead list gets filter chips, saved views and a board; every lead module gets the calendar; a phone in any format finds its lead](2026-10-13-lead-views-kanban-calendar-search.md) | #179 | Lead Eagle, leads, calendar, search |
| 2026-10-13 | [One-step call log from the lead list; the lead's whole timeline, its done follow-ups and its matching stock](2026-10-13-lead-call-log-timeline.md) | #178 | Lead Eagle, leads |
| 2026-10-13 | [A new WhatsApp number or an unknown caller becomes a lead; the portals' lead emails come in through Portal emails](2026-10-13-intake-whatsapp-telephony-email.md) | #177 | Lead Eagle, lead intake |
| 2026-10-13 | [Lead sources get a Custom webhook, a field mapping and a Deliveries tab; the API honours Idempotency-Key](2026-10-12-intake-webhook-mapping-deliveries.md) | #173 | Lead Eagle, lead intake |
| 2026-10-13 | [A form or landing-page lead names its form again](2026-10-13-lead-source-detail-label.md) | #175 | Lead Eagle, fix |
| 2026-10-13 | [Site visits show their time on the workspace's clock](2026-10-13-site-visits-workspace-clock.md) | #176 | Lead Eagle, fix |
| 2026-10-13 | [A Lead Eagle workspace starts with its own pipeline; moving a lead to a visit or a meeting books it](2026-10-12-lead-eagle-pipeline-stages.md) | #174 | Lead Eagle, pipeline |
| 2026-10-13 | [Lead requirement, interest links, custom fields and scoring on the lead page](2026-10-12-lead-requirement-interest-fields.md) | #172 | Lead Eagle, leads |
| 2026-10-12 | [Cold data follows the lead scope; a cold call is a logged call that counts toward the daily target and the check-out gate](2026-10-12-cold-data-scope-calls.md) | #171 | Lead Eagle, cold data, targets |
| 2026-10-12 | [Lead Eagle gets website forms, landing pages, an embed snippet and a Referral source](2026-10-12-intake-forms-landing-embed.md) | #170 | Lead Eagle, lead intake |
| 2026-10-12 | [Lead record fields: WhatsApp on the main number, sources and sub-sources, nationality, a second owner, tags, a duplicate check on edit](2026-10-12-lead-record-fields.md) | #169 | Lead Eagle, leads |
| 2026-10-11 | [Admin > Roles showed no scopes; a screen outside the plan went to the dashboard without a word](2026-10-11-roles-scope-and-module-pages.md) | #168 | fix, roles, Lead Eagle |
| 2026-10-11 | [Team leads see their team's follow-ups and tasks](2026-10-11-team-follow-ups-tasks.md) | #167 | security, Lead Eagle |
| 2026-10-11 | [TEAM scope meant the whole workspace for calls and events; work could be handed to anyone](2026-10-11-record-scope-team.md) | #165 | security |
| 2026-10-11 | [Release f9c0c1a](2026-10-11-release-f9c0c1a.md) | #145, #163 | release |
| 2026-10-08 | [Records could name any contact, call or event in the workspace](2026-10-08-record-attach-scope.md) | #145 | security |
| 2026-10-11 | [Release 8370b22](2026-10-11-release-8370b22.md) | #157–#162 | release |
| 2026-10-11 | [Lead Eagle move tool: the report names the people and rows it drops](2026-10-11-move-tool-orphans.md) | #162 | Lead Eagle, platform |
| 2026-10-11 | [Deactivating or removing a member hands their open work on](2026-10-11-user-deactivate-hand-over.md) | #161 | users, Lead Eagle |
| 2026-10-11 | [A Lead Eagle workspace starts with five roles, not one](2026-10-11-lead-eagle-starter-roles.md) | #160 | Lead Eagle, roles, security |
| 2026-10-11 | [Report CSVs needed only VIEW and left no trace; machine writes to leads left no audit row](2026-10-11-report-export-audit.md) | #159 | security, Lead Eagle |
| 2026-10-11 | [A lead's main phone and email can be masked per role](2026-10-11-lead-contact-masking.md) | #158 | security, Lead Eagle |
| 2026-10-11 | [A workspace could bring back a suspended account; lead work, events and Sales lead routes reached past record scope](2026-10-11-identity-guard-and-record-scope.md) | #157 | security, Lead Eagle |
| 2026-10-10 | [Release b28d2b7](2026-10-10-release-b28d2b7.md) | #151–#155 | release |
| 2026-10-10 | [Lead writes outside your scope answered 'forbidden'; bulk assign ignored scope; Make lead opened a lead you cannot see](2026-10-10-lead-record-scope.md) | #155 | security, Lead Eagle |
| 2026-10-10 | [Cold data: assign one record; Make lead opens only what you may see; notes shown](2026-10-10-cold-data-assign-and-make-lead.md) | #155 | Lead Eagle |
| 2026-10-10 | [The lead grid said only how many bulk moves failed, never why](2026-10-10-lead-grid-bulk-reasons.md) | #155 | Lead Eagle |
| 2026-10-10 | [High-priority notifications now look and sort like it](2026-10-10-notification-priority.md) | #155 | Lead Eagle |
| 2026-10-10 | [A Lead-Eagle-only workspace no longer offers a shortlist it cannot send](2026-10-10-shortlist-lead-eagle.md) | #155 | Lead Eagle |
| 2026-10-10 | [The standalone move tool: bookings visible, orphans reported, source and stage history shown](2026-10-10-move-tool-gaps.md) | #155 | Lead Eagle |
| 2026-10-10 | [One date field everywhere: type it or pick it](2026-10-10-date-fields.md) | #154 | fix, all modules |
| 2026-10-10 | [Saving a workspace in the console cut off a paying customer's modules](2026-10-10-workspace-edit-entitlements.md) | #153 | fix, platform |
| 2026-10-10 | [Signing up could bring back a suspended account](2026-10-10-signup-suspended-identity.md) | #152 | security, Lead Eagle |
| 2026-10-10 | [Self-serve sign-up could not be opened from the console](2026-10-10-signup-setting-row.md) | #151 | fix, Lead Eagle |
| 2026-10-10 | [Release 1dddaf9](2026-10-10-release-1dddaf9.md) | #135, #138, #140, #142, #147, #148 | release |
| 2026-10-10 | [Creating a plan said "The server could not be reached." after creating it](2026-10-10-plan-form-reset.md) | #148 | fix, platform |
| 2026-10-10 | [Android com.youhan.one1 1.1.0 (10) for closed testing](2026-10-10-android-one1-vc10.md) | #147 | android |
| 2026-10-10 | [A lead's Tasks tab listed tasks the viewer may not see](2026-10-10-lead-task-scope.md) | #157 (was #149) | security |
| 2026-10-08 | [A task or follow-up could be changed by id anywhere in the workspace](2026-10-08-task-follow-up-scope.md) | #157 (was #146) | security |
| 2026-10-08 | [Event invitees could name any lead in the workspace](2026-10-08-event-invitee-scope.md) | #157 (was #144) | security |
| 2026-10-08 | [Reading a client profile by lead or contact reached any buyer in the workspace](2026-10-08-client-profile-read-scope.md) | #157 (was #143) | security |
| 2026-10-08 | [Release 6ebdb2e](2026-10-08-release-6ebdb2e.md) | #136, #137, #141 | release |
| 2026-10-08 | [Release c46624f](2026-10-08-release-c46624f.md) | #134, #139 | release |
| 2026-10-08 | [The image build stopped at /signup](2026-10-08-signup-image-build.md) | #139 | fix, release |
| 2026-10-08 | [Two more specs could fail when a limiter window turned mid-case](2026-10-08-limiter-window-specs.md) | #138 | tests |
| 2026-10-08 | [Records could name any lead in the workspace](2026-10-08-lead-attach-scope.md) | #140 | security |
| 2026-10-07 | [The fonts are committed, not fetched from Google](2026-10-07-self-hosted-fonts.md) | #137 | build |
| 2026-10-07 | [Logging an activity reached any lead in the workspace](2026-10-07-activity-lead-scope.md) | #136 | security |
| 2026-10-07 | [The rate-limit spec failed when a window turned mid-case](2026-10-07-ratelimit-window-flake.md) | #135 | tests |
| 2026-10-07 | [Lead Eagle, phase 6: self-serve sign-up (closed by default); offline actions on the phone](2026-10-07-lead-eagle-phase-6.md) | #134 | Lead Eagle |
| 2026-10-07 | [Lead Eagle, phase 4: assignment that explains itself and keeps hours; two reports](2026-10-07-lead-eagle-phase-4.md) | #133 | Lead Eagle |
| 2026-10-07 | [Lead Eagle, phase 5: moving a standalone Lead Eagle company in](2026-10-07-lead-eagle-phase-5.md) | #132 | Lead Eagle |
| 2026-10-07 | [Lead Eagle, phase 3: stage reasons, QR capture links, cold data](2026-10-07-lead-eagle-phase-3.md) | #131 | Lead Eagle |
| 2026-10-07 | [Lead Eagle, phase 2: leads from the portals and Google Ads; several numbers per lead](2026-10-07-lead-eagle-phase-2.md) | #130 | Lead Eagle |
| 2026-10-07 | [sharp 0.35.5 for a new advisory](2026-10-07-sharp-advisory.md) | #130 | dependencies |
| 2026-10-07 | [The phone-shell Columns test read focus a frame early](2026-10-07-mobile-shell-focus-race.md) | #130 | tests |
| 2026-10-06 | [Release f89ae61](2026-10-06-release-f89ae61.md) | #127, #128 | release |
| 2026-10-06 | [source-map-js 1.2.2 for a new advisory](2026-10-06-source-map-js-advisory.md) | #128 | dependencies |
| 2026-10-06 | [A Real-Estate-only workspace could not take a lead; the Visits tab had no icon](2026-10-06-lead-work-provisioning.md) | #128 | fix |
| 2026-10-05 | [Lead Eagle, phase 1: live in the platform portal](2026-10-05-lead-eagle-phase-1.md) | #128 | Lead Eagle |
| 2026-10-05 | [Lead Eagle inside YOUHAN ONE — plan](2026-10-05-lead-eagle-plan.md) | — | plan, approved |
| 2026-10-05 | [Release 0ae7e9d](2026-10-05-release-0ae7e9d.md) | #117, #124–#126 | release |
| 2026-10-05 | [Lead Eagle: build it inside YOUHAN ONE](2026-10-05-lead-eagle-decision.md) | — | decision |
| 2026-10-05 | [Attendance in every workspace](2026-10-05-attendance-every-workspace.md) | #117, #124 | attendance |
| 2026-10-05 | [Two specs that failed only in parallel](2026-10-05-parallel-flaky-specs.md) | #125 | tests |
| 2026-10-05 | [Release 9f7e89b](2026-10-05-release-9f7e89b.md) | #114–#122 | release |
