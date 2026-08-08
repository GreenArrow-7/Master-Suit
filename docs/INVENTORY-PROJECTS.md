# Inventory: projects (M4)

The first real-estate-specific module in this codebase. Leads, opportunities,
calls, campaigns and events were already here; what a property salesperson
pitches *from* was not.

## What shipped

**Eight tables.** `Developer`, `Micromarket`, `Amenity`, `Project`,
`ProjectMedia`, `UnitPlan`, `UnitInventory`, `ProjectFavourite` — migration
`20260808210000_realestate_inventory_projects`, with RLS, FORCE and a
`tenant_isolation` policy on all eight, and a `projects` permission module
backfilled from whatever each role already held on `products`.

**A catalogue that meets its performance budget.** Faceted by micromarket,
developer, status, possession, unit type, amenity, price band, availability,
priority and personal favourites, keyset-paginated, with facet counts computed
from the same `where` the list uses so the numbers and the rows agree.

**Project detail**: media gallery, brochures and creatives, video and VR embeds,
unit plans, amenities, RERA registration, live availability, and a comparative
market analysis against the project's own micromarket.

**Live inventory.** `UnitInventory` with a state machine —
available → held → booked → sold, plus blocked — a row lock so two salespeople
cannot hold the same flat, holds that expire on their own, and denormalised
counters recomputed in the same transaction as the unit that moved.

**Twelve API handlers** across `/api/v1/projects`, all through the API kernel,
so every one is authenticated, entitlement-checked, permission-checked,
rate-limited, Zod-validated and audited without saying so.

## The performance requirement, and what it cost

> Seeded with 100k rows, every list route responds under 400 ms. Use Postgres
> indexes, not a search engine.

Measured, against the application role with RLS in the plan:

```
$ node scripts/bench-projects.mjs --rows 100000

PASS  catalogue, no filter                   p50    85.6 ms   p95   118.2 ms
PASS  filtered by micromarket                p50     6.3 ms   p95     7.9 ms
PASS  filtered by budget                     p50    69.4 ms   p95    96.5 ms
PASS  name search (trigram)                  p50   110.7 ms   p95   153.6 ms
PASS  amenity facet (GIN)                    p50    78.6 ms   p95    93.6 ms
PASS  available only                         p50   112.8 ms   p95   221.5 ms
PASS  facet counts by micromarket            p50   225.4 ms   p95   309.7 ms
```

Three design decisions follow from that budget, and they are the ones to
understand before changing anything here:

- **The price band, area band and unit counts are denormalised onto `Project`.**
  A correlated aggregate per row is what makes a catalogue slow. The cost is
  drift, so `recalculateProjectRollups` runs in the same transaction as every
  writer of a `UnitPlan` or `UnitInventory` row — never afterwards, never on a
  schedule. A catalogue showing stale availability is a salesperson pitching a
  sold flat.
- **Multi-select facets are arrays with GIN indexes, not join tables.** Every
  query here is "has any of these" over a small set; a join would be a second
  index scan per facet.
- **Name search is a `pg_trgm` GIN index.** `name ILIKE '%marina%'` cannot use a
  btree at all, and it is the first thing anybody types.

`tests/sales/inventory.spec.ts` asserts the indexes exist rather than timing
them, because what regresses is someone adding a filter without its index. The
timed run stays in the script.

## What was deliberately left out

**Byte upload for brochures and creatives.** `POST /projects/[id]/media`
registers an object key or an external URL; it does not receive a file. The API
kernel parses every body as JSON, so multipart needs a hand-rolled handler that
reproduces the kernel's security order — the shape to copy is
`api/v1/workspaces/[slug]/hr/documents/upload/route.ts`. Add it when someone
needs to drag a PDF in rather than have an importer place it. Video and VR need
nothing: they are the developer's URL, deliberately not copied.

**A full project edit screen.** Priority and pitchable are toggles on the detail
page, because those are the two fields the floor changes daily. Everything else
is `PATCH /api/v1/projects/[id]`, which is complete. Add a form when someone is
routinely editing RERA dates through curl.

**A `Creative` table.** The spec named one; `ProjectMedia` with
`kind = CREATIVE` is the same thing with one fewer table to keep in step.

**A join table for amenities.** `Project.amenityKeys` is a string array against
`Amenity.key`, so there is no referential integrity — renaming an amenity's
`key` orphans references. The admin UI picks from the list, so nothing else
writes them today. Add the join table if an importer ever writes amenities
directly.

**CSV export.** The platform rule says every list is exportable and this one is
not yet. The `ExportJob` model and its worker already exist; wiring the
catalogue into them is the same shape as leads.

**A hold-expiry job.** Expired holds are released when someone opens the project
or lists its units, not by a sweeper. A repeatable job over every tenant's
inventory to change nothing most of the time is work nobody asked for — add it
when a hold expiring needs to *notify* somebody rather than just stop blocking
the unit.

**Map view and geocoding.** `latitude`/`longitude` are stored and nothing
renders them. The spec puts Google Maps in M6 with site visits, which is where
the map earns its API key.

## What this module deliberately does *not* do

**It does not scope reads by owner.** Inventory is reference data: every RM must
see the whole catalogue to pitch it, so there is no `ownerId` on a project and
no `visibilityWhere` in the list route. That is a departure from Lead and
Opportunity and the reason `projects` is its own permission module rather than a
reuse of `products` — browsing is for everyone, editing is for ops.

**It does not book anything.** A unit can reach `BOOKED`, and it refuses to do
so without naming the lead, but there is no `Booking` record — that is M9, and
M9 needs the commission slab rules signed off by finance before any of it is
written. Nothing returns from `SOLD` for the same reason: reversing a completed
sale is a decision with money attached, not a dropdown.

## Where the module sits against the spec

M4 is complete except for the exclusions above. It has no dependency on M3
(client profiling), which does not exist yet — M5's demand check is the thing
that needs both, and M5 is the next module in the MVP set.
