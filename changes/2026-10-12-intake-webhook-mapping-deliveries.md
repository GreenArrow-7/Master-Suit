# Lead sources get a Custom webhook, a field mapping and a Deliveries tab; the API honours Idempotency-Key

**What.** A **Custom webhook** lead source: any system without a connector of
its own posts signed JSON to the connection's URL, with a signing secret the
workspace issues on connecting and shows once. Every lead source gets its own
screen, **Admin → Integrations → Deliveries and field mapping**
(`/{ws}/admin/lead-sources/{source}`): the **Deliveries** tab lists each stored
delivery with what became of it and a **Replay** button, and the **Field
mapping** tab maps a sender's field names to the lead's. `Idempotency-Key`,
which `docs/03-API.md` §2 promised and nothing implemented, now works on every
JSON POST and PATCH through `route()`. Audit rows M6-08, M6-20, M6-21, M6-22.
Branch `feat/intake-webhook-mapping-deliveries`, stacked on #170.

**Why.** The Lead Eagle gap audit of 11 Oct: no generic signed endpoint for
senders without an adapter (a REST client posting leads with a personal API key
retried into a 409), no way to map a sender's fields without code, and failed
or misread deliveries were stored but invisible: BullMQ's failed set was the
only dead-letter view. The owner's brief of 12 Oct, M6 second half.

**Where** (under `apps/web/`)

- `src/lib/integrations/leadSources.ts`: `custom_webhook` (_Custom webhook_, source `WEBHOOK`) joins `LEAD_SOURCES`; `MAPPABLE_FIELDS` and `parseEnquiry(payload, fieldMap)`, which applies the map to the flattened payload before reading it; `source_detail` is read as the reference.
- `src/lib/integrations/registry.ts`: the Custom webhook entry, `issuesSecret`, no credential fields.
- `src/app/api/v1/integrations/[provider]/route.ts`: PUT issues the secret (32 random bytes, hex) when the provider issues one and none is stored, stored wrapped like any credential, returned once as `signingSecret`; new PATCH `{ fieldMap }` (lead sources only, `LEAD_MODULES`, `integrations:MANAGE_CONFIGURATION`, audited `INTEGRATION_MODIFIED`).
- `src/services/leads/intake.ts`: `applyEnquiry` reads the source's current field map before parsing, so a replay uses the map as it is now.
- `src/workers/webhook.ts`: a lead-source job stamps its `outcome` (created, attached, test, anonymous) and `leadId` on the stored event.
- `prisma/migrations/20261013090000_webhook_event_outcome`: `WebhookEvent.outcome`, `WebhookEvent.leadId` (nullable, additive).
- `src/services/leads/deliveries.ts`, `src/app/api/v1/integrations/[provider]/deliveries/route.ts`: GET lists a source's deliveries (newest first, 25 a page; `integrations:VIEW`); POST `{ id }` replays one (`integrations:MANAGE_CONFIGURATION`): resets it, audits `INTEGRATION_MODIFIED` / `delivery.replayed` in the same transaction, and queues `lead-source.enquiry` afresh. Both `LEAD_MODULES`; another workspace's delivery is 404.
- `src/app/(workspace)/[workspaceSlug]/admin/lead-sources/`: the screen (`[provider]/page.tsx`, `LeadSourceControls.tsx`) and its `NotInPlan` layout (any lead product); `IntegrationBoard.tsx` links a connected lead source to it and shows an issued secret once; `workspaceNav.ts` files it under Integrations.
- `src/lib/api/handler.ts`: `Idempotency-Key` on a JSON POST or PATCH, after authorization and validation, through the existing `IdempotentRequest` store (`services/idempotency.ts`): per workspace, method and path, by the same actor and body, 24 h, swept by the existing maintenance job.
- `docs/03-API.md`: §2's Idempotency row, the inbound lead-source contract under §6.
- `src/components/nav/TopBar.tsx`: the phone title reads an underscore as a space (_Custom webhook_, not _Custom_webhook_).

**Behaviour**

- Admin → Integrations → Lead sources has _Custom webhook_. **Connect** →
  **Save and verify** connects it and shows _Signing secret: copy it now, it is
  not shown again_ under the callback URL. A lost secret is replaced by
  removing the key and connecting again (a new URL too).
- A delivery to the URL, `X-Signature: sha256=<hex HMAC-SHA256 of the raw body>`,
  a JSON object read for `name` (or `first_name`/`last_name`), `phone`, `email`,
  `message` and `source_detail`: a lead with source _Webhook_ and detail
  `custom_webhook:<source_detail>`, the same intake as the portals (number
  normalised, duplicate by number or email attaches, audit, distribution). A
  retry under the same `Idempotency-Key` stores nothing and is answered 200; a
  wrong signature is 401.
- Each connected lead source (Property Finder, Bayut, Dubizzle, Google Ads,
  Custom webhook) has **Deliveries and field mapping**. Deliveries: received
  (workspace time zone), outcome (_Lead created_, _Added to an existing lead_,
  _Test delivery_, _Named nobody_, _Queued_, _Retrying_, _Failed: gave up_ after
  the queue's five attempts; _Processed_ for deliveries stored before this
  change), the lead (named and linked only when the viewer's leads scope
  reaches it), attempts, last error, and **Replay** for those who manage
  integrations. Field mapping: rows of sender field → lead field (name, first
  and last name, phone, email, message, reference, purpose, property type,
  area, bedrooms, budget); `parent.field` for a nested one; a mapped field wins
  over the parser's own guess.
- Any `/api/v1` JSON POST or PATCH with `Idempotency-Key`: a retry with the same
  body gets the first 2xx response back and nothing runs or is audited again;
  the same key with another body, or from another person, is 409; another
  workspace's key of the same name is its own. Without the header nothing
  changes.

**Decisions taken**

The brief's defaults, accepted by the owner:

- M6-08: a `custom_webhook` lead-source kind with a per-connection HMAC secret
  generated on connecting, shown once, stored encrypted; `Idempotency-Key`
  honoured on the receiver and implemented in `route()` as `docs/03-API.md:35`
  promised.
- M6-20: `fieldMap {senderKey: leadField}` on the connection, an editor on the
  connection's page, applied before parsing; a replay uses the current map.
- M6-21/M6-22: a Deliveries tab per lead-source connection with outcome,
  attempts, error, the lead (linked when in scope), paged newest first, and an
  audited Replay; dead-lettered failures visible.

Taken while building (design choices, not owner decisions):

- The key store is the existing `IdempotentRequest` table, not Redis: Redis
  holds configuration only (`docs/00-ARCHITECTURE.md` §6) and a replayed body
  is record data. Only 2xx JSON answers are kept; a refusal is not, so a fixed
  retry runs. There is no in-flight claim: two concurrent first attempts under
  one key both run, and the later keeps no record (`ponytail:` note in
  `handler.ts`).
- A replay resets the delivery's attempt count, so it gets the queue's full
  five attempts; the counts before the replay are in its audit row.
- Deliveries are listed by source, not by connection id, so a source removed
  and connected again keeps its history; a replay reads the map of the source's
  current connection.
- The screen is `/admin/lead-sources/{source}` rather than under
  `/admin/integrations/`, so the plan page names it "Lead sources" for a
  workspace without a lead product.
- The default shape's reference key is `source_detail`, read last among the
  reference keys, so no portal's parsing changes.

**Verified.** Every new test fails on the base's source
(`origin/feat/intake-forms-landing-embed-referral`, 31a2d239: the branch's
`src/` stashed, its tests kept) and passes on the branch, except one guard: a
wrong signature is 401 on the base too (no such source).
`tests/sales/custom-webhook.spec.ts` (4; on the base: PUT 404, deliveries 401):
connecting issues a 64-hex secret once, stored wrapped, never in the board's
response; a signed `{ name, phone, email, message, source_detail }` becomes a
`WEBHOOK` lead with `custom_webhook:spring-campaign` and the note; a retry and
a changed body under one `Idempotency-Key` store one event and one lead (200
each); a wrong signature or none is 401 and stores nothing.
`tests/sales/idempotency-key.spec.ts` (5; on the base: the retried POST is a
409 duplicate, the changed body under the key makes a second lead, the retried
PATCH writes again): POST and PATCH replay the first answer and run nothing; a
different body under the key is 409; another workspace's key of the same name
is its own (a guard); no header, no change (a guard).
`tests/sales/field-map.spec.ts` (3) and `tests/sales/deliveries.spec.ts` (6)
fail to load on the base (no deliveries route). The parser reads mapped and
nested fields over its own guess; PATCH saves the map, audited, 422 for a field
it cannot map to, 404 for a non-source or an unconnected one; a delivery read
as _anonymous_ becomes the right lead on replay once mapped (with the map
lookup removed from `applyEnquiry`, no lead: the case fails). Deliveries lists
newest first with status, attempts, error and the lead; an OWN-scope viewer
gets no lead name; 25 a page; a replay of a dead-lettered delivery resets it,
writes `delivery.replayed` with the previous counts, queues `fresh` and then
works; 403 without `integrations:VIEW` (list) or `MANAGE_CONFIGURATION`
(replay), 404 for another workspace's delivery and for a non-source; the screen
shows _Lead created_, the lead's name and its `/sales/leads/` link. With the
worker's outcome stamping removed, four Deliveries cases fail.
`tests/sales/lead-source-intake.spec.ts` (+1: the registry entry) and
`tests/permission/module-entitlement.spec.ts` (+1: _Lead sources is part of
Sales, Real Estate or Lead Eagle._ without a lead product, the screen with one).
E2E `tests/e2e/lead-source-deliveries.spec.ts` (2, with the worker running as
in CI): connect from Integrations and read the secret off the card, two signed
deliveries under one key make one lead, Deliveries shows it once with its lead,
Replay turns it into _Added to an existing lead_ with one audit row, the field
map saves from its tab; both tabs at 390 px in the dark theme with no sideways
scroll (screenshots checked, and the board and Deliveries on desktop).

Runs on the rig (its own database, 103 migrations): the new and touched specs
with `workspace-nav`, `lead-eagle-routes`, `forms-lead-eagle`, `meta-oauth`
and `credential-purge` 11 files, 560/560; the broad run (`tests/` permission,
sales, tenant, unit, security, platform, integration, identity, hr, ai; the
retention specs apart) 263 files, 4083 passed, 29 skipped, 3 failed under load
("Unable to start a transaction in the given time") in five files, which pass
alone 350/350; `retention`, `audit-retention`, `document-purge` one at a time
4/4, 7/7, 1/1; `tsc --noEmit` clean; eslint no errors (one warning, the
existing `any` on the line of `queue.ts` that now exports `RETRY`); prettier
clean; E2E `lead-source-deliveries.spec.ts` 2/2.

**Left open**

- A Custom webhook's secret cannot be rotated in place: removing the key and
  connecting again issues a new secret and a new URL.
- The Deliveries tab does not show a delivery's raw body; replay is the way to
  re-read it.
- `Idempotency-Key` covers JSON bodies only; a multipart upload under a key is
  not replayed.
