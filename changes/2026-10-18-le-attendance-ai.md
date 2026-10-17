# The check-in screen shows today's target; absence and standing shifts feed assignment; Face Activity and the objection playbook in every workspace; Lead Eagle opens on its board

**18 Oct 2026** · feature, fix · Attendance, allocation, Lead Eagle, live calls (audit OWN-05, OWN-06.2, M15-05, OWN-02.2, OWN-03.3, M21-01)

## What

PR #212 (lane attendance-ai): the lane's seven rows of the 11 Oct requirements audit, each re-checked on current `main` first (M15-01 waits on the owner, under Left open):

- **OWN-05** — the quota and its check-out gate already worked in a Lead-Eagle-only workspace (#171). Missing was the phone half: the check-in screen now shows "Today's target: N of M leads called" with a bar, from the server's count, on load and on every location read; the check-out hint no longer calls a target shortfall "untouched leads".
- **OWN-06.2** — already done: `POST /api/v1/targets` takes `targetValue` as a whole number above zero (`z.number().int().positive()`) under `LEAD_MODULES`. A test now pins the 422 for 0, 2.5 and -5.
- **M15-05** — automatic assignment passes over someone **not checked in** once the workspace's cut-off has passed (new setting `assignmentCheckInBy`, "HH:MM", blank = off), and reads a **standing shift** (`HrEmployeeShift`: hours and working days) where no roster entry names the day.
- **OWN-02.2** — a work location with people actively assigned cannot be retired, by Archive (DELETE) or by setting its status to RETIRED (409 naming how many).
- **OWN-03.3** — Face Activity (refused and flagged punches, the consent register) works without HRMS: re-exported at `/{slug}/attendance/face-activity`, the page admits any module (permission `employee:VIEW` and the HR-admin check unchanged), a Home menu entry where People is not licensed, and times on the workspace's clock.
- **M21-01** — the objection playbook (cards and buyer-type playbooks) and its APIs admit every lead module; Real Estate and Lead Eagle get the Playbook screen and menu entry. The live call's hints cite the workspace's cards: the demo stream shows a card when the customer says one of its trigger phrases (each card once per call), and the Handle objection button answers with the matching card's wording before any model or built-in text. The hint is labelled "Your playbook".
- **Landing (owner default, from the lane brief)** — a workspace whose only usable product is Lead Eagle opens on `/{slug}/lead-eagle/dashboard` after sign-in and from `/`; every other workspace still opens on its summary.

## Why

The owner's attendance and live-call requirements (19 Sep list, re-audited 11 Oct) and the owner-approved defaults of 18 Oct (Lead-Eagle-only workspaces land on the Lead Eagle board).

## Where

- `src/services/targets/dailyBoard.ts` — `dailyTargetProgress` (one seller's row only: an administrator's check-out no longer computes the whole board); `dailyTargetShortfall` derives from it.
- `src/services/hr/attendance.ts` — `preflight` returns `dailyTarget`; `check-in/page.tsx`, `CheckInConsole.tsx`, `globals.css` (`.lf-checkin__target`).
- `src/services/distribution/eligibility.ts` — `offShiftNow`: standing shift, check-in cut-off; `src/services/hr/settings.ts` — `assignmentCheckInBy`, settable without HRMS (`CHECKOUT_RULE_KEYS`), shown under "Check-in and check-out rules" on Work locations.
- `src/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route.ts` — `assertNobodyAssigned`.
- `src/app/(workspace)/[workspaceSlug]/attendance/face-activity/page.tsx`, `people/face-activity/page.tsx`, `src/lib/nav/workspaceNav.ts`, `src/lib/nav/realtyShared.ts` (`OUTSIDE_PEOPLE`).
- `src/app/api/v1/objections/**`, `src/app/api/v1/sales-playbooks/**`, `sales/playbook/page.tsx`, `realty/playbook/page.tsx`, `lead-eagle/playbook/page.tsx`, `playbook` in both shared-root lists; `src/lib/ai/liveCoach.ts` (`playbookHint`), `api/v1/calls/[id]/coach` and `/live`, `services/shared/callIntelligence.ts` (`activeObjections`).
- `src/lib/security/entitlements.ts` (`workspaceLanding`), `api/v1/auth/login/route.ts`, `src/app/page.tsx`, `src/lib/security/redirect.ts` (`signInLanding` accepts the board as an ordinary landing).

## Behaviour

- An agent with a daily calling target sees it and their progress on Check-in before checking out.
- An administrator sets "Automatic assignment passes over anyone not checked in by" (Administration → Work locations, or People → Settings); after that time an employee with no check-in today is skipped by rules that respect working hours, and the assignment's note names them ("passed over … (not checked in)"). Someone without an employee record is never judged absent.
- Retiring a location with people on it answers "N people are still assigned to this location. Revoke their assignments first."
- A Lead-Eagle-only administrator opens Home → Face Activity and Lead Eagle → Leads → Playbook.

## Decisions taken

- Lead-Eagle-only workspaces land on `/lead-eagle/dashboard` after sign-in (owner default). Decided by the plan, not the role: a role without `leads` in such a workspace meets the board's refusal and uses the menu.
- The absence cut-off is one workspace setting beside the check-out rules, not a field on each rule: no migration, and it settles the open scope question ("should morning leads wait until people check in?") per workspace — blank keeps today's behaviour. Ceiling marked `ponytail:` in `eligibility.ts`.
- A playbook card wins over the model for Handle objection: it is the workspace's approved wording. So writing a card or a buyer playbook (create, edit, delete) takes `calls` at ORGANIZATION (`assertPlaybookEditor`, `src/lib/security/record-scope.ts`), and the Playbook screen shows the editor only then: a seller's `calls` grant is copied from `leads` at OWN, and without this a seller could put wording into every colleague's live calls. This also tightens Sales, where an OWN-scope seller could write cards before.
- Handle objection and the live stream read only the customer's latest line: an objection raised earlier, and likely answered, no longer answers for the one just raised; when the latest line names no card the model (or the built-in text) answers.
- Moving the check-in cut-off needs `distribution:MANAGE_CONFIGURATION` at ORGANIZATION as well as HR policy rights: it decides who automatic assignment passes over. An unchanged cut-off in the posted form does not block HR's other settings.

## Verified

- New or extended, failing on the old code: `tests/hr/bulk-location-assign.spec.ts` (409 on retire), `tests/hr/checkout-work-gate.spec.ts` (`dailyTargetProgress`, `preflight.dailyTarget`), `tests/sales/assignment-working-hours.spec.ts` (cut-off, standing shift), `tests/unit/self-check-in-reachable.spec.ts` (Face Activity re-export, gate, menu), `tests/unit/live-coach.spec.ts` (`playbookHint`), `tests/sales/playbook-lead-eagle.spec.ts` (LE-only admin adds and edits a card; Handle objection cites it), `tests/security/workspace-landing.spec.ts`, `tests/unit/sign-in-landing.spec.ts`, `tests/unit/workspace-nav.spec.ts`. Pinned, passing on the old code: `tests/sales/cold-call-activity.spec.ts` (422 for 0, 2.5, -5).
- Review round (same PR): failing first, then passing — `tests/permission/conversation-intelligence.spec.ts` (an OWN-scope rep is refused card and buyer-playbook writes, 403), `tests/unit/live-coach.spec.ts` and `tests/sales/playbook-lead-eagle.spec.ts` (the latest customer line picks the card; an earlier answered one does not), `tests/sales/assignment-working-hours.spec.ts` (Australia/Sydney: a check-in at 08:45 local, filed under the previous UTC date, counts; an overnight 22:00–06:00 standing shift counts on the day it starts), `tests/security/hr-action-authority.spec.ts` (HR alone cannot move the cut-off). 37 spec files, 1290 tests passed on the rig; `tsc` clean.
- 41 spec files, 1797 tests passed on the rig, including the existing HR, triage, allocation, daily-board, conversation-intelligence, navigation, page-access and sign-in suites; `tsc` clean; eslint clean on the touched files.
- Not checked in a browser on the rig (shared ports); the new UI is a text line and a native `<progress>` on existing `lf-*` tokens, a menu entry and a hint label.

## Left open

- **M15-01** (owner): a supervised enrolment and one check-in/check-out on an Android phone (com.youhan.one1) and an iPhone (TestFlight) against staging with real staff, recorded in IOS-FEATURE-CHECKLIST row 30; and one run of `tests/e2e/face-attendance.spec.ts` with the face sidecar and frames in `tests/faces-local/` (Playwright, not run on the shared rigs).
- Face Activity shows each refused punch's evidence but not its kept frame: no route serves the encrypted capture today in any product; showing biometric frames on screen is a privacy decision for the owner.
- "Closing the shift freezes the counts" (OWN-05): the day's count is fixed by the calls' own timestamps; calls logged after check-out still count for that day.
- The live-mic and vendor-stream paths do not cite cards yet (the vendor path waits on telephony streams).
