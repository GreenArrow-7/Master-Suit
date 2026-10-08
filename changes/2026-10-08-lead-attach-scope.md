# Records could name any lead in the workspace

**What.** Thirteen create and update handlers now check the lead a record
names (#140, after #136): calls, follow-ups and tasks (new and moved), site
visits, requirements, shortlists, bookings, referral codes and credits,
testimonial asks, client profiles.

**Why.** The body's `leadId` got at most a workspace check. An agent at OWN
scope could put any of these on a colleague's lead, then read its name (and
number) on their own screens, stamp it as worked, move its follow-up date,
notify its owner, or take the one code, ask or profile a lead may have.
#136's entry listed these routes as unaudited; the owner asked for the audit
on 8 Oct.

**Where.**

- `lib/security/record-scope.ts`: `assertLeadInScope` (the lead's own rule,
  404 like a missing lead) and `assertLeadCallable` (that, or a lead on a
  calling queue).
- The thirteen handlers under `api/v1/`, one check each. `activities/route.ts`
  uses the same helper now.

**Behaviour.** A lead outside the caller's scope answers 404 "Lead not
found.", the same as a missing one. Before, `requirements` and the task and
follow-up moves answered 422 for a missing lead. Tasks and follow-ups need
the lead's EDIT scope; the rest need its VIEW scope. Unassigned leads still
pass, as they do for the lead PATCH. Calls, visits, requirements and
shortlists also take a lead queued on a calling campaign when the caller
holds `dialer:VIEW`, because the floor works a campaign's queue whoever owns
each lead. Organisation scope sees no change.

**Verified.** `tests/permission/lead-attach-scope.spec.ts`, 29 tests:

- Each write refuses a teammate's lead with the same 404 as a missing id,
  and takes the caller's own.
- Nothing lands on the teammate's lead: no new row, no stamp, no follow-up date.
- A team manager reaches their own team's lead, not another team's.
- The dialer may call a queued lead and book a visit on it, but not a sale.

On the old routes, 16 of the 29 fail ("expected 200 to be 404"). One existing
spec changed: `bookings-route.spec`'s Seller role gained `leads:VIEW`. Also
green: 22 related files (618 tests), `tsc`, eslint and prettier.

**Left open.**

- Left as they are; #140 gives the reasons:
  - `opportunities` and unit `BOOKED` store a lead that nothing reads.
  - `allocation` ROUTE follows its own module: `allocation:APPROVE` is a
    workspace-wide grant. Whether a team leader may route other teams'
    leads is the owner's decision.
- Found in passing, not fixed here:
  - `leads/assign` ignores the ASSIGN scope.
  - Event invitees take lead ids unchecked.
  - `tasks/{id}` checks no record scope, and `follow-ups/{id}` treats TEAM as
    the whole workspace.
  - `GET client-profiles?leadId=` applies no scope.
  - `contactId`, `callId`, `requirementId` and `accountId` on these routes
    get a tenant check at most.
- `assertRecordVisible` lets anyone who holds the action reach an unassigned
  lead, but `docs/01-PERMISSIONS.md` §2 shows unassigned leads only to people
  who may assign them.
