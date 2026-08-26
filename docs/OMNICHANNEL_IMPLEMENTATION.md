# Omnichannel Customer Engagement — Implementation State

Continuation document for a multi-session enterprise programme. **Read this before
touching the code.** It exists so a new session does not spend half its context
rediscovering the architecture (§29 of the work order).

Branch: `feat/omnichannel-conversation-spine` → PR #2 against `main`.
Last updated: 2026-08-15 (Phase 1 UI complete).

---

## 1. The one-paragraph architecture

Inbound events from Meta (Lead Ads, WhatsApp, Instagram) hit a **webhook receiver**
that authenticates them, **normalises** them into one internal vocabulary, stores
them idempotently, and hands them to a **queue worker** that writes CRM records.
Outbound messages go the other way through a **provider adapter**. Everything is
tenant-scoped by an `IntegrationConnection` row, and every table is protected by
Postgres RLS as well as an application-level tenant guard.

```
Provider → webhooks/meta/[key] → verify signature → normalise → WebhookEvent (idempotent)
                                                                      ↓
                                                              queue: webhook
                                                                      ↓
                                    applyMetaEvent → Lead | Conversation | delivery receipt
                                                                      ↓
                                              distribution + automation queues → notification
```

### Load-bearing pieces that already existed (do NOT rebuild)

| Concern | Where | Note |
|---|---|---|
| Provider registry | `src/lib/integrations/registry.ts` | `PROVIDERS[]` — credentials/settings split, capabilities, webhook flag. Adding a vendor is an adapter + an entry here. |
| Per-tenant credentials | `IntegrationConnection` | `@@unique([tenantId, provider])`, `webhookKey`, `status`, `scopes`, `expiresAt` |
| Secret encryption | `src/lib/integrations/connection.ts` | AES-256-GCM envelope per value; the **only** place credentials decrypt |
| Idempotency | `WebhookEvent` | `@@unique([tenantId, provider, externalId])` |
| RBAC row scoping | `src/lib/security/visibility.ts` | `visibilityWhere(ctx, module, action, opts)` — use this, never hand-roll |
| Duplicate detection | `src/services/leads/findDuplicates.ts` | Tenant-configurable via `DuplicateRule`, confidence-scored |
| Queues | `src/lib/queue.ts`, `src/workers/` | BullMQ; `webhook` queue = 5 attempts, exponential backoff |
| Audit | `src/lib/security/audit.ts` | Records method/path/recordId only — **never request bodies** |

### Added by this programme

| Thing | Where |
|---|---|
| `Conversation` model | `prisma/schema.prisma` + migration `20260814200000_conversation_spine` |
| Event normalisation | `src/lib/integrations/meta/events.ts` |
| Webhook receiver | `src/app/api/v1/webhooks/meta/[key]/route.ts` |
| Event → CRM | `src/services/meta/applyEvent.ts`, `src/workers/webhook.ts` |
| Conversation APIs | `src/app/api/v1/conversations/` |
| Template sync | `src/services/meta/templates.ts`, `src/app/api/v1/whatsapp/templates/route.ts` |
| Inbox UI | `src/components/communications/ConversationInbox.tsx` |

---

## 2. Completed phases

| Phase | Commit | What |
|---|---|---|
| 0 — Security fix | `3dc45c5` | Meta webhook signatures keyed with **app secret**, not verify token. Graph pinned `v26.0`. |
| 1 — Spine + dedupe | `f607402` `a54069d` `41f1f1f` | `Conversation` model (RLS forced, verified via `pg_class`); public form now runs `findDuplicates`; `FormSubmission.utm` populated |
| 2 — Receiver | `83299db` | Meta webhook GET handshake + POST signature verify + normalisation + idempotent store |
| 3 — Event → CRM | `aacaad3` | Lead Ads → Lead (Graph `field_data` retrieval), inbound WhatsApp → Conversation, ranked delivery receipts |
| 4 — Conversation APIs + Inbox | `738a371` `e802412` | List/thread/send APIs, 24h service window enforced server-side, 3-column inbox |
| 5 — Templates | `087e327` | Meta template sync, approval state verbatim, template send re-read server-side |
| CI | `1a012e2` (on `main`), `c66bbfd`, `efdcedf` | Format gate on main; E2E password locator; mojibake |
| **Phase 2A — Meta routing model + ingestion** | `8920781` | `MetaLeadFormRouting` (RLS forced), ingestion applies stage/priority/source/owner, 6 routing tests |
| **Phase 2B — Meta administration UI** | `a0e91c7` | `admin/integrations/meta`: connection, assets, capabilities, lead forms, routing drawer, webhook health, advanced |
| **UI 1 — Channel control centre** | `a586491` | `Settings → Integrations` channel overview: 4 cards, derived state, LIVE/SIMULATED/NOT CONFIGURED, setup checklist |

### Decisions worth not relitigating

- **`sent` ≠ `delivered`.** Meta accepting a message is not a handset receiving it.
- **Status idempotency key is `messageId:STATUS`** — one message emits sent/delivered/read against the same `wamid`.
- **The leadgen webhook carries no `campaign_id`** — only `ad_id`/`adgroup_id`. Campaign attribution needs a follow-up Graph call. A test pins this absence.
- **Attribution merges into `Lead.customData`**, never replaces it, and never rewrites `source` on an existing lead.
- **Templates are re-read from the DB at send time** — a client naming a template + body could otherwise send unreviewed content under an approved name.
- **No `ConversationParticipant` model** — every channel here is one business to one customer.

---

## 3. Current state

### Local gate results (last full run)

| Gate | Result |
|---|---|
| Typecheck | PASS (0 source errors) |
| Lint | PASS (0 errors, 132 pre-existing `no-explicit-any` warnings) |
| Format | PASS on the 24 files this branch touches |
| Unit | **1086 / 1087** — see Known Issues |
| Server integration | PASS (2 files, 6 tests) |
| E2E | **FAIL — 6 of 32** — see Known Issues |
| Production build | PASS (73 pages) |
| **Remote CI** | **UNVERIFIED — `gh` unauthenticated, repo private** |

> `format:check` reports ~362 files locally. That is a Windows artefact: `core.autocrlf=true`
> gives the working tree CRLF while Prettier expects LF. Blobs are stored LF and CI is clean.
> Verify with `git show <ref>:<path>` — but note `git show` **re-applies the CRLF filter on
> output**, so pipe through `dos2unix` or use `git cat-file` before checking.

### Known issues (real defects, not classified as green)

1. **E2E: 6 specs fail at owner sign-in.** Symptom: reaches the MFA screen, then
   `"That email and password combination did not work."` for `owner@masterapp.local`.
   Ruled out: local seed state (reseeding changed nothing), a stale MFA factor (the only
   verified factor belongs to a leftover `e2e.owner.*` account, not the owner), CRLF.
   **Next probe:** `tests/e2e/helpers.ts:60` reads `PLATFORM_OWNER_PASSWORD`; the seed writes
   `process.env.PLATFORM_OWNER_PASSWORD ?? DEMO_PASSWORD`. They read the same variable and
   should agree. Establish why they don't — that is the whole bug.
   Note: an untracked `apps/web/scripts/owner-mfa-snapshot.mjs` appeared in the working tree
   from a concurrent session, apparently investigating the same thing.

2. **`tests/unit/environment-separation.spec.ts` times out** at 30s under full-suite
   parallelism; passes alone in 10s. It spawns the seed as a child process. **Do not just
   raise the timeout.** Measure first: instrument the spawn, check whether concurrent vitest
   workers contend on the same database or on process startup. This test protects demo/prod
   isolation and matters.

3. **The password-locator fix is only half done.** `getByLabel('Password')` matched both the
   input and a `Show password` eye button. Tests now pass `{ exact: true }` (measured: 10 → 6
   failures). Per §74 the **component semantics** still need review — the eye button's
   accessible name colliding with the field's label is a UX problem, not only a test problem.
   Consider `aria-label="Show password characters"` or moving it out of the label association.

---

## 4. Not started — the in-app configuration programme

**None of the admin UI in the work order exists yet.** This is the gap the customer named:
the backend is real, the administrator cannot see or operate it.

- [x] **Phase 1 — `Settings → Integrations` overview.** DONE (`a586491`). Four cards, state
      derived from `IntegrationConnection` / `WebhookEvent` / `MessageTemplate` /
      `Form`+`FormSubmission`, setup checklist, mode chip. **Extends** the existing vendor
      board on the same route — do not create a second Integrations destination.
      Files: `src/services/integrations/channelState.ts`,
      `src/components/workspace/ChannelOverview.tsx`, `.lf-channel*` / `.lf-setup*` in
      `globals.css`. **Outstanding: screenshot QA at 1440px and 390px (§33).**
      Cards currently link `Manage` to the same page; per-channel destinations arrive with
      Phases 2/3/5.
      **QA done 2026-08-16** at 1440px and 390px via Playwright (log in through the real
      form as `admin@manathhomes.ae` / `DEMO_PASSWORD`; cookie injection is blocked but a
      form login works). Desktop renders correctly. Two findings: LIVE copy said
      "Connected to the provider" on first-party channels (fixed), and 95px of horizontal
      overflow at 390px from the pre-existing IntegrationBoard health rows — a fixed 180px
      label in a non-wrapping flex row (fixed; re-measured at 0px overflow, 0 offenders).
      **Phase 1 acceptance met, desktop and mobile.**
- [ ] **Phase 2 — Meta configuration** + guided connect, page/IG selection, lead forms,
      lead routing, permissions, webhook health, reconnect.
- [ ] **Phase 3 — WhatsApp control centre** + setup wizard, templates screen, conversation
      routing, test connection.
- [ ] **Phase 4 — Inbox discoverability.** Nav entry is committed (`WorkspaceSidebar`, under
      ENGAGE) but the surrounding IA and channel filters are unfinished.
- [ ] **Phase 5 — Website admin.** Domains + verification, form embed, API keys (secret shown
      once), lead routing, attribution, recent submissions.
- [ ] **Phase 6 — Notifications.** Org config, personal preferences, quiet hours, web push,
      honest PWA-vs-native statement.
- [ ] **Phase 7 — Health + webhook operations** with safe metadata and idempotent retry.
- [ ] **Phase 8 — Communication routing.**
- [ ] **Phase 9 — Observability.**
- [ ] **Phase 10 — Full E2E, mobile, RBAC, tenant-isolation, load testing with p50/p95/p99.**

### Where the data for Phase 1 already lives

Everything the overview needs exists — no new tables required:

- Status/mode → `IntegrationConnection.status`, and whether credentials resolve to a real
  provider or the mock (`getWhatsAppProvider` falls back to `MockWhatsAppProvider`).
- Last event → `WebhookEvent` ordered by `createdAt` per `provider`.
- Webhook health → `WebhookEvent.processed` / `errorMessage` / `attempts`.
- Templates count → `MessageTemplate` where `channel='WHATSAPP'`.
- Website → `Form`, `FormSubmission` (has `utm`, `referrerUrl`), plus `Domain` work not yet built.
- Notifications → `Notification`, `CommunicationProvider.quietHours`.

**Permission to gate on:** `integrations` / `MANAGE_CONFIGURATION` for writes,
`integrations` / `VIEW` for the overview. Both already exist in `prisma/seed/roles.ts`.

---

## 5. External blockers (cannot be cleared from code)

- Meta App Review for `leads_retrieval`, `ads_management`, `pages_read_engagement`,
  `pages_manage_metadata`, plus **Business Verification**.
- WhatsApp Business Account, registered number, and **template approval**.
- Instagram professional account linked to the Page.
- VAPID keypair for web push. FCM/APNs only if a native app exists — **no evidence one does**;
  document PWA honestly rather than claiming native push.
- `wabaId` must be added per tenant in the integrations UI; it is **not** the phone number id.

---

## 6. Verification constraints in this environment

- **Remote CI is unreadable** — `gh` unauthenticated, repo private. Run the gates locally in
  CI's order instead: typecheck → lint → format:check → test → test:server → e2e → build.
- **The in-app browser pane stalls streamed RSC pages.** It reports blank/"Loading" for pages
  that the server rendered correctly in ~200ms. Do not diagnose from it.
- **Playwright's context blocks cookies**, so it cannot reach authenticated routes by injecting
  a session. Use the E2E helpers' real login flow instead.
- Consequence: **no screenshot of an authenticated screen has been captured this session.**
  §33 screenshot QA is outstanding for every UI phase.

---

## 7. Next recommended task

**Phase 2C — Social Comment Leads.** This is now the highest priority, ahead of WhatsApp.

## PRODUCT DIRECTION CHANGED (2026-08-16)

The primary objective of the Meta integration is **capturing sales leads from Facebook and
Instagram comments**, not account connection. Connection settings are plumbing; the product
is: a prospect comments on a post/reel/ad → Master Suite captures it → qualifies intent →
routes it to a salesperson → they reply → it converts to a CRM Lead.

**The load-bearing design decision — two layers.** A social post gets `Beautiful 🔥`, `Nice`,
`😂`. Those must never reach the CRM Leads table.

    Layer 1  SocialComment / social enquiry   ← every captured comment lands here
    Layer 2  CRM Lead                          ← only on qualification, policy, or a human
                                                 pressing "Convert to Lead"

Getting this wrong pollutes the customer's CRM permanently, so it is the first thing to get
right and the last thing to compromise on.

**Build order (from the work order §76):**
1. SocialComment model + normalized webhook pipeline  ← START HERE
2. Social Leads UI (navigation: ENGAGE → Social Leads; not under Integrations settings)
3. AI intent/qualification, with visible explainability — never a bare score
4. Comment Capture configuration (Meta settings gains tabs; Lead Forms becomes one source among several)
5. Reply / private reply, gated by a provider capability layer
6. CRM Lead conversion + identity linking
7. Attribution analytics ("which post produced pipeline?")

**Hard prerequisite before writing the adapter (§8).** Verify against *current* official Meta
documentation, not memory: Graph version, comment webhook fields for `feed` (Facebook) and
`comments` (Instagram), required permissions, Page/IG-professional requirements, App Review
requirements, private-reply mechanism and its window, and rate limits. **Facebook and
Instagram differ materially** — payload shape, identity fields, private-reply behaviour — so
build provider-specific adapters behind one shared model. This programme has already shipped
one bug from trusting remembered Meta behaviour (the app-secret signature fix, `3dc45c5`);
do not repeat it.

**What already exists and must be reused, not rebuilt:**
- `webhooks/meta/[key]` receiver — signature verification, tenant resolution from the
  connection, `WebhookEvent` idempotency, queue handoff. Comments are a new `field` in the
  same envelope; extend `lib/integrations/meta/events.ts`, do not write a second receiver.
- `findDuplicates` for identity matching, `DistributionRule` for assignment, existing SLA,
  `Notification`, `Activity`, and Manath AI's authorization/context framework.
- `MetaLeadFormRouting` stays. Lead Forms becomes one acquisition source alongside FB and IG
  comments — a shared social-acquisition architecture, not a replacement.

**Schema sketch for the new model** (design against existing conventions; tenant-scoped, RLS
FORCED, `@@unique([tenantId, providerCommentId])` as the idempotency key):
tenantId, integrationConnectionId, provider, providerCommentId, providerAuthorId, authorName,
commentText, commentCreatedAt, mediaId/mediaType/permalink, parentCommentId, campaign/ad
attribution where actually supplied, intent, score, status, ownerId, teamId, linkedLeadId,
linkedContactId, repliedAt, providerReplyId.
**Store only what Meta actually supplies — never invent a phone, email or legal name.**

## VERIFIED META COMMENT CONTRACT (checked 2026-08-16, not recalled)

Sources: `developers.facebook.com/docs/graph-api/webhooks/reference/page` (feed) and
`.../reference/instagram` (comments). Graph pinned **v26.0**.

|                   | Facebook                          | Instagram                          |
|-------------------|-----------------------------------|------------------------------------|
| webhook field     | `feed`                            | `comments`                         |
| discriminator     | `value.item === 'comment'`        | the field itself                   |
| comment id        | `value.comment_id`                | `value.id`                         |
| text              | `value.message`                   | `value.text`                       |
| author            | `from.{id, name}`                 | `from.{id, username}`              |
| author id scope   | page-scoped                       | Instagram-scoped (`self_ig_scoped_id`) |
| content           | `value.post_id`                   | `value.media.{id, media_product_type}` |
| ad attribution    | not supplied                      | `value.media.{ad_id, ad_title}`    |
| edit/delete       | `value.verb` (add/edit/edited/delete/remove/…) | **not delivered**     |
| permission noted  | `pages_manage_metadata`, page admin with MODERATE | (not stated in that reference) |

**Consequences already encoded:** `feed` also carries posts/likes/shares, so non-comment
items are dropped; `verb` is Facebook-only and must stay undefined for Instagram; ad
attribution is Instagram-only; ids live in separate spaces, so the idempotency key includes
`provider`.

**Still unverified — do this before going LIVE:** exact permission set for each field,
Instagram professional-account requirements, App Review requirements, and the private-reply
mechanism and its window. The reference pages consulted did not state them. §41/§45 (reply
UI and deadline) must not be built until they are, because inventing a reply window is
exactly the class of bug this section exists to prevent.

## Phase 2C progress

**DONE (`d1187e1`) — ingestion foundation.**
- `SocialComment` model + migration `20260816180000_social_comment`, RLS FORCED (verified
  via `pg_class`), indexes for queue / owner / media-attribution / returning-commenter.
- `@@unique([tenantId, provider, providerCommentId])` idempotency key.
- `lib/integrations/meta/comments.ts` — `normalizeFacebookComment`, `normalizeInstagramComment`,
  `normalizeSocialComment(field, value)`. Never throws.
- `services/social/qualify.ts` — deterministic, no Gemini dependency, explainable reasons.
- 16 tests (`tests/sales/social-comments.spec.ts`), 34 with the Meta suite.

**DONE (`f745b6f`) — receiver wiring + worker.**
- `normalizeMetaWebhook` now emits `SOCIAL_COMMENT_RECEIVED` for `feed` and `comments`.
  **The route required no change** — it already stores + enqueues whatever the normaliser
  returns, which is why extending the shared walk was the whole job.
- Event id `comment:<provider>:<commentId>`; existing `WebhookEvent` uniqueness dedupes.
- `services/social/applySocialComment.ts` — idempotent persist, qualification, identity
  match on stable provider id (never username), assignment for HIGH/MEDIUM only,
  best-effort notification with `actionUrl` deep link.
- Facebook edit/delete verbs honoured; Instagram delivers neither, so unreachable there.
- 19 social tests; 513 across tests/sales + tests/security. tsc 0, lint 0, build green.

**Known gaps in this slice (deliberate, not oversights):**
- Assignment currently only inherits the linked lead's owner. **`DistributionRule`
  fallthrough for unknown commenters is not wired** — an unmatched HIGH enquiry lands
  unassigned in the queue. Next task after the UI.
- No realtime publish yet; the queue is read on page load.
- No Activity record on link — deliberate, to avoid flooding CRM history with unlinked
  comments (§27 leaves this to product judgment).

**DONE (`f180e44`) — Social Leads workspace.**
- Route `sales/social-leads`, nav entry under ENGAGE. Server-rendered, link-based tabs
  (shareable URLs), scoped by `visibilityWhere` with unassigned included.
- `components/workspace/SocialLeadList.tsx` — queue rows + detail drawer. Score always shown
  with its reasons. No provider ids on the row.
- **Verified through the real pipeline**, not by inserting rows: IG high→HIGH 80,
  IG praise→LOW 5, FB high→HIGH 70, a `like` dropped, redelivery deduped, **0 CRM Leads**.
- QA'd 1440px + 390px: 0 overflow, drawer full-width.
- Convert/Reply not built; the drawer says so rather than showing dead buttons.

**DONE (`84df82b`) — Convert to Lead.**
- `POST /api/v1/social-leads/[id]/convert`, drawer panel. Name required only; phone/email
  blank until collected. `findDuplicates` first — a match links and merges attribution
  without rewriting the existing `source`.
- Attribution survives: `source=CHAT`, `sourceDetail='Instagram Comment'`, and
  `customData.socialEnquiry` carrying comment text, ad id/title, media id, provider ids,
  timestamps. **This is what makes "which post produced pipeline?" answerable later.**
- Consent is `UNKNOWN`, not `IMPLIED` — a public comment is not a submitted form.
- Re-converting returns 409.
- Verified live end to end: seed → convert → 409 on repeat → attribution read back from
  the database. Demo data cleaned up.
- **Three more bare-`id` writes** were caught by the tenant guard (same class as Phase 2B).
  Rule for future work: any Prisma write addressed by `id` alone will be refused.

**DONE (`6339c82`) — distribution fallthrough.**
- `nextDistributionOwner(tenantId)` in `services/distribution/assignLead.ts` — reads the
  tenant's active ROUND_ROBIN rule, advances the pointer, refuses suspended/deleted users.
  Extracted, not copied. `assignLead` keeps its transactional variant on purpose (it must
  not advance the pointer for an already-assigned lead) — see the ponytail comment.
- **Priority order:** linked customer's owner → rotation → unassigned queue.
  No fake Lead is created to make distribution run.
- Only HIGH/MEDIUM consume capacity. Idempotent by construction — the duplicate check
  returns before assignment, so retries preserve the owner and send no second notification.
- Proven live: `dr-4 → Amina Al Rashid`, `dr-5 → Dhruv Menon` (rotation advanced),
  `dr-6 LOW → unassigned`, 2 notifications not 3. Probe data cleaned up.

**DONE (`aa27c0f`) — assignment history + non-assignment reasons.**
- `SocialAssignmentHistory` + `SocialAssignmentSource` enum, migration
  `20260817090000_social_assignment_history`, RLS FORCED and verified.
  Separate from `LeadAssignmentHistory` because its `leadId` is non-null — reusing it would
  mean creating the CRM record the two-layer design withholds.
- `SocialComment.assignmentSource` / `assignedAt` / `assignmentNote`.
  **`MANUAL` is the value a retry must never overwrite** when reassignment UI lands.
- `nextDistributionOwner` returns a reason and walks the pool past inactive users rather
  than giving up on the first one.
- Verified all four paths: no rule / no eligible members / assigned / low-intent, plus a
  replay that preserved the owner and sent 1 notification not 2.

**DONE (`190ddbb`) — unassigned queue.** Tab + count, HIGH/MEDIUM only, reason rendered
inline. Verified live: `UNASSIGNED 1` with "No matching distribution rule."

**DONE (`2b94386`) — manual assignment and reassignment.**
- `services/social/assignSocialLead.ts` owns authorization, eligibility, the write, the
  history row and the notification, so a later caller (bulk assign, an automation) gets the
  same guarantees without reimplementing them. `POST /api/v1/social-leads/[id]/assign` is thin.
- **Claiming for yourself needs only VIEW; handing it to anyone else or to a team needs
  ASSIGN.** Verified against a real `marketing_manager` session (VIEW=ORGANIZATION, no
  ASSIGN): hand-to-person 403, hand-to-team 403, claim-for-self 200. The Reassign button is
  absent for that role, so the UI and the API agree.
- A team is a destination, not a person — `nextDistributionOwner` picks who inside it takes
  it rather than a second rotation competing with the first.
- **The manual guard is explicit in `applySocialComment`, not a side effect of the duplicate
  early-return.** Proven by replaying the original provider event: owner survives,
  `assignmentSource` stays MANUAL, `assignedAt` untouched, no extra history row, no extra
  notification, no duplicate enquiry, no CRM Lead.
- Permanent check: `tests/tenant/social-assignment.spec.ts` (3 tests) — distribution assigns,
  redelivery preserves a manual owner, no Lead is ever created. Runs with `npm test`,
  needs Postgres only.
- Refusals verified at the API: suspended user 404, unknown user 404, both person and team
  422, neither 422.
- **UI bug found and fixed in the same pass:** the drawer held a copy of the row, so a
  reassignment refreshed the queue behind a drawer still showing the old owner. It keeps the
  id now and derives the row from the fresh list.
- QA'd live at 1440px and 390px: 0 overflow, full history trail reads
  `Amina → Sara · assigned by hand by Manath Admin · reason`. Probe data cleaned up.

**DONE (`40d4c61`) — response SLA + escalation.**
- Migration `20260817140000_social_sla`: `SocialComment.slaDueAt` + `slaEscalatedAt`, index
  `(tenantId, slaDueAt)`. **Two columns only — the SLA *state* is derived, not stored.** A
  stored state needs a job to keep it true, and a late or lost job leaves a row lying about
  itself; a deadline and the clock cannot disagree. It also means the Overdue tab's SQL, the
  count and the badge are one rule instead of three that drift.
- `services/social/sla.ts` — `socialSlaTarget()` and the pure `socialSlaState()`.
  **Clock runs from `commentCreatedAt`**, which the normaliser already defaults to ingestion
  time when Meta omits a timestamp (`comments.ts` `at()`), so the fallback was already there.
- **Targets reuse the tenant's existing `SLA` rows** — `firstResponseMins` is literally this
  question and `warningThresholdPct` is where AT_RISK comes from. Both were dead schema
  before this. Defaults HIGH 10m / MEDIUM 30m; LOW and non-enquiries get no clock at all.
  No new policy model.
- `escalateSocialSla` on the existing `sla` queue (job `social-enquiry-response`, armed at
  ingestion for the deadline). Owner's `managerId` → team's `managerId` → nobody; the
  `sla.warning` automation event fires either way. **HIGH only** — escalating MEDIUM teaches
  managers to ignore the alert. Deduplicated on `slaEscalatedAt`.
- UI: chip on the row, line in the drawer, Overdue tab + count. Ordering is
  `repliedAt` nulls-first → `convertedAt` nulls-first → `slaDueAt` — **the two nulls-first
  keys are load-bearing**, without them answered enquiries have older deadlines and float
  to the top of the queue.
- Checks: `tests/sales/social-sla.spec.ts` (9, pure, no DB) + 3 more in
  `tests/tenant/social-assignment.spec.ts`. 1134 unit tests green, tsc 0, lint 0, build green.
- Proven live through the real pipeline: fresh → ON_TRACK 10 min left, 9-min-old → AT_RISK,
  40-min-old → BREACHED 30 min late; escalation notified the manager once and returned
  `already-escalated` on the retry; a reply flipped it to MET. Overdue tab and count agreed
  (2 and 2). 1440px and 390px both 0 overflow. Probe data cleaned up.

**Gotcha worth remembering:** `.env.test` points at a **separate database**
(`master_saas_test`). A migration applied only to `leadflow` leaves every DB-touching spec
failing with "column does not exist". Run `prisma migrate deploy` against both.

Second gotcha: a script that calls `enqueue` keeps a BullMQ Redis connection open, so node
never exits and buffered stdout never flushes — a probe script looks like it hung when it
actually finished. End such scripts with `process.exit(0)`.

**DONE (`bd39c67`) — Meta reply contract verified, and encoded.**

**The contract, checked against live official docs on 2026-08-17. Not recalled.**

| | Facebook | Instagram |
|---|---|---|
| public reply | `POST /v26.0/{comment-id}/comments` `{message}` | `POST /{ig-comment-id}/replies` `{message}` |
| public perms | `pages_manage_engagement` + MODERATE task | `instagram_basic`+`instagram_manage_comments` (FB login) **or** `instagram_business_manage_comments` (IG login) |
| public window | none documented | none, but **top-level comments only**, and **never on live video** |
| private reply | `POST /{page-id}/messages` `{recipient:{comment_id}, message}` | same endpoint and shape |
| private perms | `pages_messaging` + MESSAGING task | `instagram_manage_comments` + `pages_messaging` |
| private window | **7 days** from the comment | **7 days**, or **only during the broadcast** on a Live |
| how many | **exactly one, ever** | **exactly one, ever** |

Continuing after that first message needs the customer to answer, which opens the standard
24-hour messaging window — that belongs to the Conversation spine, not to comments.
**App Review gates all of it** for accounts the app does not own; Advanced Access also needs
Business Verification. A green panel does not mean a call will succeed.

**Every row of that table differs between the two providers**, which is exactly why they had
to be checked separately rather than assumed identical.

- `lib/integrations/meta/replyCapability.ts` — pure, no API calls: `canPublicReply`,
  `canPrivateReply`, `replyExpiresAt`, `reasonUnavailable`. Consults the connection's stored
  `scopes` when it has them; an **unknown scope list is treated as no objection**, since
  absence of evidence is not evidence of absence and the call is the real check.
- Rendered in the drawer with a ✓/× mark and a sentence. Sending is not built and the panel
  says so, rather than showing a button that fails after someone has typed an answer.
- `tests/sales/meta-reply-capability.spec.ts` (8) pins the contract: **if Meta changes a
  rule, that file is where it should first be felt.**
- Verified live across three seeded cases: fresh → both allowed, 8-day-old → public allowed
  and private closed, LIVE → both refused with the right reason. Also verified with the
  scopes withheld (both refused) and granted. Probe rows and scopes restored afterwards.

**Also fixed:** overdue rows read "11511 min late". Units now scale to hours and days.

**DONE (`df147ed`) — the reply workflow.**
- `SocialReply` + `SocialReplyKind` (PUBLIC / PRIVATE / EXTERNAL), migration
  `20260817160000_social_reply`, RLS FORCED. Append-only, alongside `SocialComment.repliedAt`
  rather than replacing it: that field is the *first* response, which is what the SLA measures.
- `lib/integrations/meta/send.ts` — the two endpoints from the verified contract. Errors are
  **returned, not thrown**: a refusal from Meta is something a salesperson reads, and it is
  shown in Meta's own words (`(#10) Application does not have permission…` beats "reply failed").
- `services/social/replyToComment.ts` — authorization (`leads` EDIT), a **re-check of the
  capability at send time** (a tab left open overnight can outlive the window), the call, the
  trail, the status move to CONTACTED and the clock stopping, in one transaction.
- **Nothing is written when Meta refuses.** A row claiming we answered would stop the SLA and
  tell a manager the enquiry was handled. Demo mode records replies as `delivered: false`.
- `services/social/draftReply.ts` + `POST …/draft` — returns text, writes nothing, and **cannot
  import the sender**. `tests/sales/social-reply.spec.ts` asserts that on the module graph,
  because "AI must never auto-send" is a structural property, not a promise about a code path.
  The prompt forbids inventing prices, dates or contact details; the template fallback has none.
- `EXTERNAL` covers §36: a person recording that they phoned or messaged the customer, with the
  channel from a fixed list. It stops the clock because the customer really was answered.

**Two things earlier in this session were wrong, and are corrected here:**
1. **Converting was stopping the SLA clock.** §35 is explicit and was right: creating a CRM
   record is filing, not answering. An enquiry converted in silence is exactly the one that
   should stay red. Only a reply stops the clock now, and the Overdue tab counts converted
   rows too.
2. **The queue was ordered purely by deadline**, which put a lukewarm enquiry twenty minutes
   late above a hot one two minutes from target. `queueRank()` now puts intent before lateness.
   ponytail ceiling: the ranking is applied to the fetched page, since derived state cannot be
   sorted in SQL — store the state if a workspace ever runs a backlog deeper than `take`.

**Found during QA:** a *public* reply was being treated as spending Meta's single *private*
reply, so the drawer said the direct route was closed while it was open. Only a private reply
spends it now. Also: after sending, the selected option could become disabled with nothing
checked — the form falls back to an allowed one.

Verified live: draft filled the box and sent nothing; Send recorded the reply, labelled it
`not delivered (demo)`, and flipped SLA to Answered; the 9-day-old enquiry offered public reply
and refused private with Meta's reason; EXTERNAL/WhatsApp recorded and dropped Overdue 1→0
without a refresh; API refusals 409/422 across five malformed bodies. 1440px and 390px both
0 overflow. 1153 unit tests green. Probe data and scopes restored.

**DONE (`28cc1e6`) — the OAuth connect flow.** The connection was a hand-written database row
until now, which meant no customer could adopt any of this without an engineer.
- `services/meta/oauth.ts` — dialog URL, code exchange, long-lived exchange, `/me/accounts`,
  `/me/permissions`. Contract checked against live docs 2026-08-17, recorded in the file header.
- **`state` is a random handle to a Redis record**, not a signed blob: bound to workspace +
  actor, 10-minute TTL, spent with **GETDEL** so a replayed callback cannot also succeed. It
  proves the redirect belongs to a flow this server started; **identity still comes from the
  session**, and a state minted in one workspace is refused when the session is in another.
- **The app secret never reaches the browser.** A test asserts the authorize URL contains
  neither the secret, the tenant id nor the actor id.
- **The Page token is stored, not the user token** — Page tokens from a long-lived user token
  do not expire on a timer, so capture does not silently stop after 60 days.
- Two things that only appear with real accounts: the Page chosen is the first that can
  actually be *used* (a role of only ANALYZE authenticates fine and refuses every write), and
  **granted scopes are read back from `/me/permissions`** rather than assumed from what was
  requested, because a person can untick permissions on the consent screen. `replyCapability`
  already reads that field.
- `META_APP_ID` / `META_APP_SECRET` unset → button disabled, screen explains what an operator
  must configure. Documented in `.env.example` along with the callback URL to register.
- `tests/sales/meta-oauth.spec.ts` (10). 1163 unit tests green, tsc 0, lint 0, build green.

**Verified over the live devtunnel** (`https://w3ksqsxm-3000.asse.devtunnels.ms`), which is what
a real Meta callback would hit: unconfigured → button disabled with the explanation; configured
→ authorize URL correct (`/v26.0/dialog/oauth`, right scopes, no secret, opaque 43-char state);
callback cancel → "Connection cancelled — nothing was changed"; unknown state, absent state and
**both replay attempts** refused; a valid state with a fake code reached Facebook and surfaced
**Meta's own error**, and the connection row and audit log were **untouched** by the failure.

**Still not proven, and worth being blunt about:** no real Meta app exists here, so the
successful branch of the exchange — real code → real Page token → stored connection — has never
run. Everything up to and after it has. That is the one remaining unknown in the flow.

**DONE (`85ab3d0`) — Gemini connected per workspace, and actually used.**
- **The bug this exposed:** the screen said Gemini CONNECTED while every AI feature read
  `process.env.GEMINI_API_KEY`, which is unset on this deployment. Analysis, audits, live
  coaching and reply drafts were all running simulated behind a green badge, while the
  workspace's own key sat encrypted in its connection row with nothing reading it.
- Gemini is a **registry provider** now (`lib/integrations/registry.ts`), so the existing
  Configure form, encrypted save and health row cover it — no second form, no second list.
- `lib/ai/gemini.ts` — `geminiKey()` / `geminiModel()`: **workspace key first, deployment key
  second.** A tenant with its own key is buying its own quota, billing and data boundary.
  **Every call site moved onto it** (analysis, audit, liveCoach, assistant, draftReply) — a
  resolver half the callers ignore reproduces the same green-badge-over-simulation bug.
- **`gemini-2.0-flash` has been retired by Google.** It was the hardcoded default, so every
  request 404'd. Default is now the `gemini-flash-latest` alias; the model is editable per
  workspace. `verifyConnection` **names a usable model** instead of counting them, because
  when an id retires the useful fact is what to type instead.
- Drafting had no retry while analysis and audits did — now on the same `withRetry`/
  `isTransient` pair. Output budget 400 → 1500: current flash models spend output tokens
  thinking, and the first real draft came back cut off mid-sentence.
- **Also fixed:** the callback URL block forced this page 291px sideways at 390px. A URL is
  one unbreakable token, so `overflowX: auto` never got to scroll — the element widened its
  grid. Invisible while APP_URL was `localhost:3000`.
- `tests/tenant/gemini-key.spec.ts` (7) — including that one workspace's key never serves
  another's, and that a DISCONNECTED row stops being used. 1170 unit tests green.

**Proven live over the tunnel:** verify returned `28 models available, e.g.
gemini-flash-latest` against the stored key; a reply draft came back `source: "gemini"`.
Repeat calls then returned **429 — that key's quota is spent**, which is Google's limit, not
our code. The 1500-token budget fix is therefore **not yet visually confirmed**; it is a
reasoned fix for an observed truncation, not a verified one.

**NOT DONE — next tasks in order:**
1. **A real Meta connection has never been exercised.** Everything is proven through the
   simulated path, unit tests and the devtunnel. `sendMetaReply` has not made one live Graph
   call, and no real App ID has been through the consent screen. Register a Meta app, set
   `META_APP_ID`/`META_APP_SECRET`, add `{APP_URL}/api/v1/integrations/meta/callback` to its
   Valid OAuth Redirect URIs, and walk the flow once. That is now the biggest remaining gap.
2. **Bulk assignment** (§20) — deliberately not started; single assignment had to be right first.
3. **Previous-owner notification** (§18) — judged not worth it for every reassignment; revisit
   if managers ask.
4. **SLA history/analytics** (§38) — `SocialReply` now carries first-response data, so
   time-to-response reporting is possible but not built. — the capability layer is ready and the contract is known, so this
   is now unblocked. Public reply first (no window, simpler permissions); private reply
   second, and only where `canPrivateReply` says so. Record `providerReplyId` and `repliedAt`
   on success — the SLA and the capability layer both already read them. **AI drafts must
   never auto-send.**
2. Comment Capture settings tab; AI enrichment on the deterministic score (must degrade);
   simulated-comment admin action (§25) through the real receiver, never a direct insert;
   social analytics.

**`environment-separation` timeout — FIXED (`30c16c2`).** Not flaky code: `seedWith` allows
each child subprocess 120s while vitest's default killed the test at 30s, so a loaded
parallel run cut off a test still legitimately waiting on a child it had authorised.
Measured first, as asked: 9.9s for the whole file in isolation, ~2.5s per spawn, failing
only inside the full 85-file run. The timeout is aligned with the child deadline the file
already declares, not inflated until the symptom stopped.

**Long-standing defects, still open:** E2E owner sign-in (6 specs), password-locator
component semantics.

---

**After Phase 2C: Phase 3 — WhatsApp administration.** Phases 1 and 2 are closed.

Phase 2 delivered, both halves:
- `2A` (`8920781`) — `MetaLeadFormRouting`, migration `20260816120000_meta_lead_form_routing`,
  RLS forced, ingestion honours stage/priority/source/user/team with fallthrough to the
  existing DistributionRule engine. No new assignment-strategy enum.
- `2B` (`a0e91c7`) — route `admin/integrations/meta`, API `POST /api/v1/integrations/meta`
  (`sync` | `routing` | `disconnect`), `services/meta/config.ts`,
  `components/workspace/MetaConfiguration.tsx`, `.lf-meta*` / `.lf-drawer*` CSS.
  QA'd on the running app: sync returned 3 demo forms, a rule saved and survived a full
  reload, 390px has 0 overflow with the drawer full-width and Save reachable.

**Defect the tenant guard caught during Phase 2B QA, now fixed:** two writes used a bare
`id` filter and `lib/db.ts` refused them ("issued without a tenantId filter"). Both use the
tenant-scoped composite key now. Worth remembering: that guard is load-bearing, and any new
write addressed by `id` alone will fail the same way.

**Phase 2 gaps, honestly:** there is no OAuth connect flow — the connection is created
outside the UI and the page shows/manages it. `Reconnect` is not built (Disconnect is).
Meta E2E specs are not written. Both are the first items for whoever continues Meta.

Phase 1 was closed earlier: built, QA'd at both breakpoints, both
findings fixed.

Visual QA is unblocked and this is how (nobody had this working before 2026-08-16):
Playwright cannot inject cookies, but it *can* drive the real login form — set `#email` and
`#password` through the native value setter, `form.requestSubmit()`, then navigate. Log in as
`admin@manathhomes.ae` with `DEMO_PASSWORD` from `.env`. Screenshots and DOM measurement both
work from there. Use it on every phase.

Concretely, in order:

1. Read `tests/e2e/helpers.ts` around line 60 and `prisma/seed/index.ts` around line 606.
   Determine why `PLATFORM_OWNER_PASSWORD` is rejected. Check whether the owner is being
   forced through MFA enrolment that the helper does not complete.
2. Measure the `environment-separation` timeout before changing it.
3. Build Phase 2, Meta configuration, at
   `admin/integrations/meta/`. Reuse `channelCards()` for the header state and the same
   `.lf-channel*` primitives. Lead-form routing needs new tenant-scoped storage — there is
   no model for form→pipeline mapping yet, so it needs a migration.

Commit per phase. Update this document at the end of every session.
