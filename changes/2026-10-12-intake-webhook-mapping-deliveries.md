# Lead sources get a Custom webhook, a field mapping and a Deliveries tab; the API honours Idempotency-Key

**What.** A **Custom webhook** lead source: any system without a connector of
its own posts signed JSON to the connection's URL, with a signing secret the
workspace issues on connecting and shows once. Every lead source gets its own
screen, **Admin → Integrations → Deliveries and field mapping**
(`/{ws}/admin/lead-sources/{source}`): the **Deliveries** tab lists each stored
delivery with what became of it and a **Replay** button, and the **Field
mapping** tab maps a sender's field names to the lead's. `Idempotency-Key`,
which `docs/03-API.md` §2 promised and nothing implemented, now works on JSON
POST and PATCH through `route()`, except where the answer is a credential.
Audit rows M6-08, M6-20, M6-21, M6-22. Branch
`feat/intake-webhook-mapping-deliveries`, stacked on #170.

**Why.** The Lead Eagle gap audit of 11 Oct: no generic signed endpoint for
senders without an adapter (a REST client posting leads with a personal API key
retried into a 409), no way to map a sender's fields without code, and failed
or misread deliveries were stored but invisible: BullMQ's failed set was the
only dead-letter view. The owner's brief of 12 Oct, M6 second half. Review
round 1 (13 Oct) found credentials kept by the replay store, the store never
swept, replays posing as repeat enquiries, and mapped fields that did not win.

**Where** (under `apps/web/`)

- `src/lib/integrations/leadSources.ts`: `custom_webhook` (_Custom webhook_, source `WEBHOOK`) joins `LEAD_SOURCES`; `MAPPABLE_FIELDS` and `parseEnquiry(payload, fieldMap)`, which applies the map before reading; a mapped name or phone is the only one read; `source_detail` is read as the reference.
- `src/lib/integrations/registry.ts`: the Custom webhook entry, `issuesSecret`, no credential fields.
- `src/app/api/v1/integrations/[provider]/route.ts`: PUT issues the secret (32 random bytes, hex) when the provider issues one and none is stored, stored wrapped like any credential, returned once as `signingSecret`; new PATCH `{ fieldMap }` (lead sources only, `LEAD_MODULES`, `integrations:MANAGE_CONFIGURATION`), audited with the map before and after.
- `src/app/api/v1/webhooks/leads/[key]/route.ts`: an `Idempotency-Key` reused for another body is 409; a body already stored is the same delivery under any key.
- `src/services/leads/intake.ts`: `applyEnquiry` reads the source's current field map before parsing; a replay that finds the lead the delivery already made changes nothing (`EnquiryOrigin.reached`).
- `src/workers/webhook.ts`: a lead-source job stamps its `outcome` (created, attached, test, anonymous) and `leadId` on the stored event.
- `prisma/migrations/20261013090000_webhook_event_outcome`: `WebhookEvent.outcome`, `WebhookEvent.leadId` (nullable, additive).
- `src/services/leads/deliveries.ts`, `src/app/api/v1/integrations/[provider]/deliveries/route.ts`: GET lists a source's deliveries (newest first, 25 a page by `?cursor=`; `integrations:VIEW`); POST `{ id }` replays one the queue is done with (`integrations:MANAGE_CONFIGURATION`), 409 while it is queued or retrying. Both `LEAD_MODULES`; another workspace's delivery is 404.
- `src/app/(workspace)/[workspaceSlug]/admin/lead-sources/`: the screen (`[provider]/page.tsx`, `LeadSourceControls.tsx`) and its `NotInPlan` layout (any lead product); `IntegrationBoard.tsx` links a connected lead source to it and shows an issued secret once; `workspaceNav.ts` files it under Integrations.
- `src/lib/api/handler.ts`: `Idempotency-Key` on a JSON POST or PATCH, after the route's permission and validation, through the existing `IdempotentRequest` store (`services/idempotency.ts`): per workspace, method and path, by the same actor and body, 24 h. `RouteSpec.idempotent: false` and every `selfService` route ignore it; `identity/[action]` declares it.
- `src/lib/jobs/retention.ts`: the nightly sweep removes `IdempotentRequest` rows past their 24 h (`sweepExpiredIdempotency`, which nothing called).
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
  retry under the same `Idempotency-Key` stores nothing and is answered 200;
  the key with a different body is 409; the same body under a new key is the
  delivery already stored; a wrong signature is 401.
- Each connected lead source (Property Finder, Bayut, Dubizzle, Google Ads,
  Custom webhook) has **Deliveries and field mapping**. Deliveries: received
  (workspace time zone), outcome (_Lead created_, _Added to an existing lead_,
  _Test delivery_, _Named nobody_, _Queued_, _Retrying_, _Failed: gave up_ after
  the queue's five attempts; _Processed_ for deliveries stored before this
  change), the lead (named and linked only when the viewer's leads scope
  reaches it), attempts, last error, **Older**/**Newest**, and **Replay** for
  those who manage integrations on every delivery the queue is done with. A
  replay that finds the lead it made adds no note, sends no _enquired again_
  and keeps its outcome; if the queue cannot take it, the delivery stays as it
  was. Field mapping: rows of sender field → lead field (name, first and last
  name, phone, email, message, reference, purpose, property type, area,
  bedrooms, budget); `parent.field` for a nested one.
- Any `/api/v1` JSON POST or PATCH with `Idempotency-Key`: a retry with the same
  body gets the first 2xx response back and nothing runs or is audited again;
  the same key with another body, or from another person, is 409; another
  workspace's key of the same name is its own. Ignored by `identity/self`
  (password, two-factor) and `identity/{action}` (password reset, account
  creation). Without the header nothing changes.

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
  is record data. Only 2xx JSON answers are kept (no multipart); a refusal is
  not, so a fixed retry runs. A reused key with another body, or by another
  person, is 409, as `services/idempotency.ts` already answered. There is no
  in-flight claim: two concurrent first attempts under one key both run, and
  the later keeps no record (`ponytail:` note in `handler.ts`).
- Credential routes opt out (`idempotent: false`, and every `selfService`
  route) rather than routes opting in, so the API keeps the §2 promise
  everywhere else. A replay re-runs the route's permission, not checks made
  inside the handler, for the same caller only.
- Replay is offered once the queue is done with a delivery. It resets the
  attempt count, so it gets the queue's full five; the counts before are in its
  audit row, and a queue outage puts the delivery back and audits
  `delivery.replay_failed`.
- The receiver takes a body once whatever key it comes under, so a captured
  delivery cannot be resent under fresh keys; no timestamp is signed.
- A mapped name (full, or first and last) or phone sets every other guess
  aside; a sender key deeper than `parent.field` is read by its last two names,
  the way the payload is flattened.
- Deliveries are listed by source, not by connection id, so a source removed
  and connected again keeps its history; a replay reads the map of the source's
  current connection. Paged by cursor, as §2 says.
- The screen is `/admin/lead-sources/{source}` rather than under
  `/admin/integrations/`, so the plan page names it "Lead sources" for a
  workspace without a lead product.
- The default shape's reference key is `source_detail`, read last among the
  reference keys, so no portal's parsing changes.

**Verified.** Each fix's tests fail on the source before it and pass after.
First round, against the base (`origin/feat/intake-forms-landing-embed-referral`,
31a2d239, the branch's `src/` stashed): `custom-webhook.spec.ts` (PUT 404,
deliveries 401), `idempotency-key.spec.ts` (the retried POST a 409 duplicate,
the changed body a second lead, the retried PATCH written again; another
workspace's key and no header are guards), `field-map.spec.ts` and
`deliveries.spec.ts` (no deliveries route), `lead-source-intake.spec.ts` (+1:
the registry entry), `module-entitlement.spec.ts` (+1: _Lead sources is part of
Sales, Real Estate or Lead Eagle._). Review round, against the branch before it
(efa367ba): 13 cases fail there and pass now — two-factor-begin and
password-reset under a key run again and keep no row; a reused key with another
body is 409 and a body resent under new keys stores nothing; mapped first/last
name and phone set the guesses aside, `data.customer.contact_mail` is read (a
mutation of each fails the case); Deliveries pages by cursor, refuses a queued
or retrying replay (409), puts a delivery back when the queue is down, audits
`delivery.replay_failed`, and a replay of a delivery that made its lead adds no
note or notification; the field map's audit row carries the map before and
after — and `retention.spec.ts` (+1: expired `IdempotentRequest` rows gone in
both tenants, live ones kept). Guards added beside them: another person's key
409, a 422 then a fixed retry runs, a 256-character key 422, no second audit
on a replay, first/last name, a retry before the worker, an HR-only workspace
403 and VIEW-only 403 on the map, an OWN viewer sees their own lead, received
in the workspace's time zone (New York), no Replay for a viewer. E2E
`tests/e2e/lead-source-deliveries.spec.ts` (with the worker running as in CI):
connect from Integrations and read the secret off the card, the card at 390 px
dark with no sideways scroll, two signed deliveries under one key make one
lead, Deliveries shows it once with its lead, Replay leaves it _Lead created_
with one note and no notification, the field map saves from its tab, both tabs
at 390 px in the dark theme.

Runs on the rig (its own database, 103 migrations), review round: the new
and touched specs with `lead-source-intake`, `module-entitlement`,
`workspace-nav`, `lead-eagle-routes`, `forms-lead-eagle`, `meta-oauth`,
`mfa-reauth`, `guard-exemptions`, `secret-egress` and `triage-completion` 14
files, 617/617; the broad run (`tests/` permission, sales, tenant, unit,
security, platform, integration, identity, hr, ai; the retention specs apart)
263 files, 4124 passed, 2 skipped, 1 failed under load ("Unable to start a
transaction in the given time", `lead-triage`), which passes alone 34/34;
`retention`, `audit-retention`, `document-purge` one at a time 5/5, 7/7,
1/1; `tsc --noEmit` clean; eslint and prettier clean on the touched files; E2E
`lead-source-deliveries.spec.ts` 2/2, screenshots checked.

**Left open**

- A Custom webhook's secret cannot be rotated in place: removing the key and
  connecting again issues a new secret and a new URL.
- The Deliveries tab does not show a delivery's raw body; replay is the way to
  re-read it.
- A replay does not correct a lead the delivery already made (a name misread
  before the map was fixed); that lead is corrected on the lead. A delivery
  stored before this change has no `leadId`, so its replay still reads as a
  repeat enquiry if it finds a lead (they age out with the 30-day webhook
  retention).
- A delivery stored while the queue was down stays _Queued_ until its sender
  retries; Replay is not offered while a job may still be behind it.
- The field map's save and a Configure on the same card both rewrite the
  connection's settings; two at the same moment can lose one.

**Merge-up with main (round 1), 13 Oct.** Main brought #169 (the lead source
catalogue), #171 (cold data) and #170 squashed (bbe0c2fc: the tree this branch
was stacked on, 31a2d239, plus #170's merge-ups with #169 and #171). Every file
this branch had not changed since 31a2d239 takes main's version; `LeadForm.tsx`,
`public/forms/route.ts`, `reports.ts`, `realtyShared.ts`, the #170 entry and
four of #170's specs conflicted only because #170 was squashed. The real
conflicts:

- `services/leads/intake.ts`: `applyEnquiry` keeps both sides: this branch's
  field map, read before parsing, and `reached`, and #169's `sourceId` from the
  connection's kind. A portal or Google Ads lead lands on its entry whatever
  the map says. The ten defaults have no entry for a Custom webhook, so its
  leads carry none until an administrator adds "Custom webhook" under Sources
  (key `custom_webhook`), and land on it from then on (a new case in
  `custom-webhook.spec.ts`).
- `admin/lead-sources/layout.tsx`: both sides added the same `NotInPlan` gate.
  One layout now covers #169's Sources catalogue (`/admin/lead-sources`) and
  this branch's `/admin/lead-sources/{source}`.
- `changes/README.md` keeps every row, newest first. `PROJECT.md` keeps both
  texts; the screen counts stay 75, 32, 40 and 29, the `page.tsx` counts.

One file merged without a marker but was wrong. In `workspaceNav.ts`, the
Integrations tab's alias `/admin/lead-sources` now also matched #169's Sources
tab, and at `/admin/lead-sources/bayut` the Sources tab won (the first of two
equal matches). The alias is now one page per lead source
(`/admin/lead-sources/{key}`), so the catalogue reads Sources and each source's
Deliveries reads Integrations (a new case in `workspace-nav.spec.ts`).

On the merged tree (105 migrations):

- `tsc --noEmit` is clean. eslint and prettier are clean on the files this
  merge touched.
- This branch's specs, #170's, `lead-record-fields` and `module-entitlement`:
  13 files, 810 passed. Two failed under load with "Unable to start a
  transaction in the given time" and pass alone: `idempotency-key` 10/10 and
  `lead-record-fields` 16/16.
- `tests/` permission, sales, tenant and unit: 165 files, 2955 passed, 2
  skipped. One failed under load (`audit-retention`, a transaction timeout).
  The three retention specs one at a time: 5/5, 7/7, 1/1.
- E2E on a fresh `.next`, with the worker: `lead-source-deliveries.spec.ts`
  2/2 and `embed-form.spec.ts` 4/4. `lead-eagle-workspace.spec.ts` failed
  twice at #168's soft-navigation step, then passed 1/1 on the warm server.
  That step calls `router.push` before the page has hydrated; the browser
  logged "Can't perform a React state update on a component that hasn't
  mounted yet". Every file on that path is identical to main.
