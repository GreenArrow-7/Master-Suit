# Site visits and client meetings (M6)

A register of who took which client to see what, whether a leader agreed to it
beforehand, and whether anybody believes it happened.

## One table, not two

The spec names `SiteVisit` and `Meeting` separately. They are one model here,
with a `kind`, because they share a lifecycle, a geo check-in and one leader
verification queue. Two tables would be two copies of the same state machine and
two lists a manager has to remember to open; `kind` distinguishes them in the one
place they actually differ, which is whether the destination is a property or an
address.

It is also deliberately **not** `FieldVisit`, which already exists. That records
a rep calling on a lead: no approval, no client in the car, no property. A site
visit costs a car, a set of keys and often a developer's time, which is why it
is requested rather than simply booked.

## The acceptance criterion

> The state machine rejects illegal transitions; a completed visit cannot be
> edited without an audit entry.

**Transitions.** `REQUESTED → APPROVED | REJECTED | CANCELLED`,
`APPROVED → CHECKED_IN | CANCELLED | NO_SHOW`, `CHECKED_IN → COMPLETED`.
Everything else is refused with a sentence rather than a constraint name. Two
rules beyond the graph: approving your own visit is refused even for a leader —
signing off your own trip is a formality with a name on it, not a decision — and
`CHECKED_IN` is unreachable by editing. It is reached by punching, or not at all.

**Amendment.** A completed visit is evidence: of a trip claimed, a client met,
and often a commission that follows. So it is not edited, it is amended. The
reason is mandatory, the before and after both go to the audit log, and the row
carries who changed it and when. Three things make that unavoidable rather than
merely usual:

1. `PATCH … action: 'edit'` refuses outright once the status is `COMPLETED`.
2. `amendCompleted` writes the audit row **inside the same transaction** as the
   change. Two separate writes is exactly how one lands without the other.
3. A `CHECK` constraint requires `amendReason` whenever `amendedAt` is set, so a
   correction made by a direct `UPDATE` — the one nobody would otherwise see —
   fails at the database.

An amendment also returns the visit to the verification queue: the record changed
after it was signed off, so the sign-off no longer covers it.

## What the web can and cannot know about location

Per the platform constraints, there is no background tracking and no mock-GPS
detection — the browser has neither, and any "I am really here" flag a page could
send is a boolean the page could also set. So the punch is browser geolocation at
an explicit checkpoint while the tab is open, and everything else is measured
server-side after the fact:

| Check | What it catches |
|---|---|
| Distance to the destination | A check-in from the office |
| Travel speed since the agent's previous punch | Two viewings 120 km apart, five minutes apart |
| Coordinates identical to the last punch | A phone replaying a stored fix |
| GPS accuracy above 500 m | A reading too coarse to place anybody |

**All of them flag. None of them blocks.** A genuine viewing reached from a
passenger seat on a motorway looks exactly like a fast one, and an agent locked
out of their own check-in at a client's door will simply stop using the register —
which costs more than the fraud it prevents. A punch outside every fence is
recorded, flagged, and shown in red, which is the same answer M8 gives for
attendance.

The radius (250 m) and the speed ceiling (160 km/h) are workspace settings. A
tower has a car park, a gate and a sales centre, so the fence is wider than an
office door — and how much wider is a workspace's call.

## Permissions

`visits` is its own module, because booking a viewing, approving one and
verifying it happened are three authorities.

| Action | Default | What it is |
|---|---|---|
| `VIEW` / `CREATE` / `EDIT` / `DELETE` | whoever holds the same on `activities` | Book and run your own visits |
| `APPROVE` | whoever holds `leads:REASSIGN` | The decision queue |
| `MANAGE_USERS` | whoever holds `leads:REASSIGN` | The verification queue |

Reads are owner-scoped through `visibilityWhere`, like leads — a leader sees
their subtree, which is what makes both queues a list of their own people rather
than of strangers.

## A bug the tests caught

`destinationOf` originally queried the project's coordinates through the global
Prisma client from inside `withTx`. Under row-level security that lands on a
different pooled connection with no `app.tenant_id`, so the lookup returned
nothing — and the symptom was not an error. It was `geofenceOk: null` on every
punch, silently, with every visit looking unverifiable. The codebase already
documents this failure mode in `lib/security/visibility.ts`; it is worth reading
before writing any service that queries inside a transaction.

## What was deliberately left out

**An embedded map.** The detail page links to Google Maps rather than rendering
it — twice, once for the property and once for wherever the check-in actually
came from, which is the comparison a leader is making. A rendered map needs a
JavaScript API key and a billing account, and answers the same question. Swap the
link for the embed when a key exists.

**A map-based location picker.** Same reason. A meeting takes a typed address
today; coordinates come from the project or listing when there is one.

**Google Calendar and Meet on visits.** The integration exists and events already
use it, but wiring it here means deciding who the calendar belongs to and what
happens when a visit is rescheduled twice — a design conversation, not an
afternoon.

**Route planning between visits.** A day with six viewings in it should be
ordered by geography. That needs a directions API and an optimiser, and it is a
feature nobody asked for yet.

**Client-side offline capture.** The platform is online-first and queues no
writes. An agent in a basement car park cannot check in, and will have to do it
when they surface.
