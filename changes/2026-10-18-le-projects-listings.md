# Projects and listings for every lead module: payment plans, uploads, units from the page, paging and views, permits, pocket listings, unit matches

**18 Oct 2026** · PR #207 · feature · Lead Eagle, projects, listings (audit rows M11-01, M11-02, M11-03, M11-04, M11-07, M11-08, M11-09, M12-02, M12-04, M12-05, M12-06, M12-09)

**What.**

- **Payment plans (M11-02).** `PaymentPlan` (name, milestones `[{ label, percent }]` summing to 100). `GET/POST/DELETE /api/v1/projects/{id}/payment-plans` (LEAD_MODULES; EDIT to write). The project page lists them and adds one ("20 On booking, 80 Post-handover"). The move tool carries the standalone's plans.
- **Uploads (M11-03, M12-02).** `POST /api/v1/projects/{id}/media/upload` and `/listings/{id}/media/upload`: multipart, recognised by bytes (photo: JPEG/PNG/WebP; floor plan, brochure, creative: also PDF), malware-scanned, stored under `inventory/t-{tenant}/`, served by the existing `media/{mediaId}/file`. "Add photo or file" on both pages. A listing outside an OWN agent's reach answers 404. The JSON media routes now accept only a key under that prefix (before, a registered key could point at any object in the bucket, a receipt or another workspace's file, and the file route would serve it).
- **Developer, community, amenities by name (M11-01).** The project form (and the listing form, for the community) takes them typed; each is found or created, so the catalogue's filters work in a wizard-made workspace. The catalogue gains an Amenity filter.
- **Units from the project page (M11-04).** Add unit plan and Add units (floor range) call the existing routes, which now take the form's numbers as typed; the counts and the unit board follow.
- **Catalogue and book (M11-08, M12-05).** Both page past 50 rows (Pager). The catalogue's filters show their counts (`catalogueFacets`, shared with `/projects/facets`). Each person saves views of either list (`/api/v1/projects/views`, `/listings/views`; `SmartView` objectType `PROJECT_LIST`/`LISTING_LIST`). Listings filter by beds up to and price from.
- **Listing status and permit (M12-04, M12-09).** The listing page sets its status (Active needs a live mandate, as the API already said) and its Trakheesi permit and expiry; the new-listing form takes them too. Administration → Company stores the ORN. An Active listing never sent to a portal is a pocket listing: it matches and shares.
- **Unit matches on the lead page (M12-06).** Matching stock lists AVAILABLE units of projects the requirement fits (community, beds, area, budget, handover) beside the listings.
- **Lead grid by project (M11-07).** Filters → "Interested in" picks a project; the chip names it. (The link, its picker, the project page's interested leads and the move were #172.)
- **Move tool (M11-09).** A unit keeps its type and bedrooms on a unit plan per (project, type, bedrooms); payment plans move; a moved project's unit counters and types are counted (they were 0), its price band kept (`recalculateProjectRollups(..., { countsOnly: true })`); media stays behind, reported.

One migration (`20261018100000_project_payment_plans`, additive: one table under forced row-level security).

**Decisions taken.**

- Media is not moved: its files are in the standalone's bucket; the report counts the rows left.
- Unit matches do not filter on property type (a plan's type is free text) and carry no score: `demand.ts` keeps its rule against invented weights.
- A typed community with no city is Dubai, the standalone's default.
- BOOKED stays off the unit board: booking names the buyer and belongs to Bookings (Real Estate); a Lead-Eagle-only workspace holds units.
- Paging is OFFSET (marked `ponytail:`); a keyset like the lead grid's when a catalogue passes ~10,000 rows.

**Where.** `src/lib/inventory/paymentPlans.ts`, `media.ts`; `src/services/inventory/media.ts`, `reference.ts`, `views.ts`, `facets.ts`, `demand.ts`; `src/app/api/v1/projects/[id]/payment-plans`, `.../media/upload`, `projects/views`, `listings/views`; the project, listing, catalogue, book, new-project, new-listing and lead pages; `src/components/workspace/MediaUpload.tsx`, `InventoryViews.tsx`; `src/services/platform/leadEagleMove.ts`, `scripts/move-lead-eagle.ts`.

**Verified.** `tests/sales/projects-listings-le.spec.ts` (new, 14 cases, a Lead-Eagle-only workspace): fails on main at import (no payment-plan, upload or views routes) and, case by case, on the form's string numbers (422), the missing `units` on Matching stock, the missing permit fields. `tests/platform/lead-eagle-move.spec.ts` asserts a moved unit's plan (4 bed Villa), the project's counters with its price band kept, and the payment plan (20/80). `tests/permission/admin-editors.spec.ts` stores and clears the ORN. With the specs of every touched area: 24 files, 1227 tests pass; tsc clean; drift and RLS checks clean.

**Left open.**

- No real standalone company exists to move (PROJECT.md); the reader's new columns are proven against the standalone schema only.
- Bulk actions on the catalogue and book; an Add photo browser test (CI E2E).
