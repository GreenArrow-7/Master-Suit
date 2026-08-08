# Inventory: listings (M5), and one table from M3

M4 catalogued developer inventory — stock the agency sells on behalf of the
people who built it. This is the other half of the book: property owned by
somebody else, marketed under an agreement with an end date.

That agreement is the whole difference between the two modules, and it is why
`Mandate` is a table rather than three columns on `Listing`.

## What shipped

**Five tables.** `Owner`, `Listing`, `ListingMedia`, `Mandate`,
`ClientRequirement` — migration
`20260808220000_realestate_listings_and_requirements`, with RLS, FORCE and a
`tenant_isolation` policy on all five, and two new permission modules
(`listings`, `requirements`) backfilled from what each role already held on
`projects` and `leads`.

**The listing book**: sale and rental stock, faceted by type, property type,
micromarket, status, furnishing, bedrooms, price and mandate type, with a
"marketable only" filter that means *live mandate and on the market*, and a
30-day mandate-expiry chase list on the page header.

**Mandates**: exclusive, non-exclusive and open, each with a required end date,
a commission percentage, and the signed agreement's object key. A partial unique
index enforces at most one `ACTIVE` mandate per listing.

**Requirements and the demand check**, both directions: what can I show this
client, and who wanted this property.

**Owner contact masking**: a landlord's phone and email come back masked unless
the caller holds `listings:VIEW_SENSITIVE_FIELDS`.

## The rules worth knowing before changing anything

**A listing may only be ACTIVE while an ACTIVE mandate covers it.** Publishing
checks for one (`assertMarketable`). Terminating one takes the listing off the
market *in the same transaction* — not with a warning banner, because without a
live agreement there is no permission to advertise. Lapsed mandates are expired
when somebody next reads the book, the same lazy pattern unit holds use.

**Nothing returns from EXPIRED or TERMINATED.** A lapsed agreement is replaced,
not revived: the owner signs again and that is a *new* mandate. Reviving the old
row would erase the gap in which the agency had no right to market the property,
which is exactly the history this table exists to keep.

**In the demand check, an unstated criterion means "any", not "none".** A client
who has said only "I want to buy" sees everything. The trap this avoids is a
naive builder emitting `propertyType IN ()`, which returns nothing and looks
like there is no stock.

**Budget is applied strictly; everything else leniently.** A listing whose
bedrooms were never recorded still matches a three-bed search — "unknown" is not
"wrong", and excluding it hides stock over a field nobody filled in. But nothing
above the stated ceiling is ever shown, because that is how an agent loses a
client.

**Stock is shared, demand is not.** Listings are readable by the whole floor
(`listings:VIEW`, no owner scoping) because a shared book is the point of a
book. Requirements go through `visibilityWhere` like leads, because a
requirement is somebody's client and the buyer list is what an agent leaving
takes with them. `/listings/[id]/demand` is gated on `requirements:VIEW` for the
same reason: browsing the book does not entitle you to other people's buyers.

## The M3 question

M5's demand check is specified as matching listings "against open client
requirements from M3", and M3 does not exist. Rather than ship the module
without the feature that makes it more than a spreadsheet, `ClientRequirement`
is built — the one table the matching needs.

The rest of M3 is **not** built: no `ClientProfile`, no profession, income band,
education, employment, languages or purchase intent, no testimonial flow, no
referral codes. Matching stock to demand does not need to know where a buyer went
to university, and inventing those columns now would be guessing at a module
nobody has specified in detail. When M3 is built properly, `ClientRequirement`
is already where it belongs.

## What was deliberately left out

**Byte upload for photographs and brochures.** `POST /listings/[id]/media`
registers an object key or an external URL, exactly as project media does; the
multipart handler is still the gap. Copy
`hr/documents/upload/route.ts` when somebody needs to drag a photo in. Video and
VR need nothing — they are the owner's URL, deliberately not copied.

**A requirement capture form.** Requirements are created through
`POST /api/v1/requirements`; the UI lists them and shows their matches but does
not yet create one. It belongs on the lead and contact detail pages — "what are
they looking for" is a question asked while looking at the person, not from a
separate screen — and those pages are M2's.

**Owner edit and merge.** Owners are created and listed. The duplicate check
refuses a second record for a known phone number rather than merging, because
merging silently reassigns whoever was there first; a real merge needs somebody
to choose which relationship survives.

**Portal syndication.** Nothing here publishes to Bayut, Property Finder or
Rightmove. That is an integration, and it belongs behind the provider factory
pattern the telephony vendors use.

**CSV export**, same as M4 — the `ExportJob` model and worker exist, wiring the
book into them is the same shape as leads.

## A drift fix that came with this

`prisma migrate diff` proposed dropping all three of M4's hand-written GIN and
trigram indexes the moment this module was added: an index the datamodel cannot
see is one Prisma believes should not exist. Dropping them would have turned a
110 ms catalogue into a sequential scan with nothing failing to say so. They are
now declared in `schema.prisma` with `type: Gin` and `ops: raw("gin_trgm_ops")`,
so the drift is closed and the next module will not re-propose it. `Listing` gets
the same two from the start.

## Where this leaves the spec

M1, M2, M4 and M5 — the minimum useful product named in §9 — are now present,
with M5's demand check resting on one table borrowed from M3. M7 (calling) is
the next highest value and most of it already exists from the telephony work.
M9 still needs the commission slab rules signed off by finance before any of it
is written.
