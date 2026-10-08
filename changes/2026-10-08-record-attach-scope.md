# Records could name any contact, call or event in the workspace

**What.** The bodies #140 checked for their lead also name a contact, a call
or an event, and now check those too (#145). Calls, site visits,
requirements, referral codes, testimonial asks and client profiles take only
a contact the caller can see. A follow-up takes only a call they can see, and
a call only an event they can see.

**Why.** Those ids got a workspace check at most. #140's entry listed them,
and the owner asked for the audit on 8 Oct. An agent at OWN scope could:

- read a colleague's contact back: a call's follow-up email drafts to its
  name and address (and sends to it), a visit's page shows its name and
  number, the requirement list shows its name;
- take the one referral code (the 409 quoted it), open testimonial ask or
  client profile a contact may have;
- put a follow-up on a colleague's call page, or a meeting on an event's
  page. The meeting also held that number's place in the event's call queue.

**Where.**

- `lib/security/record-scope.ts`: `assertContactInScope` applies the
  contact page's own rule,
  `visibilityWhere(contacts, VIEW, includeUnassigned)`, and answers 404 like
  a missing contact.
- `api/v1/calls`, `site-visits`, `requirements`, `referrals` (ISSUE),
  `testimonials`, `client-profiles`: one contact check each. `calls` also
  checks `eventId` with `assertEventInScope`.
- `api/v1/follow-ups`: checks `callId` with `assertCallInScope`, before the
  transaction.

**Behaviour.** An out-of-scope contact, call or event answers 404 ("Contact
not found.", "Call not found.", "Event not found."), the same as a missing
one. `requirements` used to answer 422 for a missing contact. Each record
follows its own list:

- a contact the caller's contact list shows: an unassigned one only to
  people who may assign contacts;
- a call of their own below TEAM scope, any call from TEAM up;
- an event they host, created or are invited to, or any event from TEAM up.

Organisation scope sees no change. Of the app's screens, only the call page's
follow-up form sends one of these ids, and it sends its own call.

**Verified.** `tests/permission/record-attach-scope.spec.ts`, 19 tests:

- Each of the eight writes refuses a teammate's contact, call or event with
  the same 404 as a missing id, and takes the caller's own.
- Nothing lands on the teammate's records.
- A team manager names their team's contact, not another team's.
- An unassigned contact is refused to a rep and taken by a manager who may
  assign contacts.

On the old routes, 11 of the 19 fail with "expected 200 to be 404" (the
clean-up check finds a row in each of the eight places). Also green: 42
related files (1,313 tests), `tsc`, eslint and prettier.

**Left open.**

- Left as they are; #145 gives the reasons:
  - `campaignId` (calls, follow-ups): campaigns are workspace-wide, and the
    dialer names the campaign it works.
  - `projectId`, `listingId`, `unitInventoryId` (visits, sales): shared stock.
  - `scriptId` (calls), `accountId` (calls, sales), `contactId` (sales,
    shortlists) and `requirementId` (shortlists) are stored and read by
    nothing. Add the same line if a screen ever shows one.
- Found in passing, not fixed here:
  - The call, visit and event pages, and the events list, load by id and
    workspace only. Their API routes apply the record's scope.
  - `GET proposals` and the shortlists page list every shortlist in the
    workspace, and the default title names the client. The shortlist's own
    page applies the requirements scope.
- Contacts follow their list on unassigned records. Leads (#140) still let
  anyone holding the action name an unassigned lead.
